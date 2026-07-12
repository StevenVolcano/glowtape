// Shared helpers for Glow Tape hooks.
//
// IMPORTANT: PocketBase executes every hook handler in an isolated JS VM —
// top-level functions in *.pb.js files are NOT visible inside handlers.
// Shared code lives here, and each handler loads it with:
//   const lib = require(`${__hooks}/glowtape_lib.js`)
// (This file does not end in .pb.js on purpose, so PocketBase doesn't try
// to load it as a hooks entrypoint.)

// --- generic ------------------------------------------------------------------

function pbNow(offsetMs) {
  return new Date(Date.now() + (offsetMs || 0)).toISOString().replace("T", " ");
}

// Multi-relation values from record.get() are VM-wrapped; copy into a plain
// JS array before using array methods.
function toIdArray(value) {
  const out = [];
  if (value) {
    for (const v of value) out.push(String(v));
  }
  return out;
}

// --- email --------------------------------------------------------------------

function recipients(app, productionId, calledMemberIds) {
  const calledIds = toIdArray(calledMemberIds);
  const members = app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
    p: productionId,
  });
  const out = [];
  for (const m of members) {
    if (
      calledIds.length > 0 &&
      !calledIds.includes(m.id) &&
      !calledIds.includes(String(m.get("claimedFrom") || ""))
    )
      continue;
    try {
      const u = app.findRecordById("users", m.get("user"));
      out.push({ address: u.email(), name: u.get("name") });
    } catch {
      /* skip broken member rows */
    }
  }
  return out;
}

function sendMail(app, to, subject, html) {
  if (to.length === 0) return;
  const settings = app.settings();
  const message = new MailerMessage({
    from: { address: settings.meta.senderAddress, name: settings.meta.senderName },
    bcc: to,
    subject: subject,
    html: html,
  });
  app.newMailClient().send(message);
}

// --- sms ----------------------------------------------------------------------

function smsConfigured() {
  const p = $os.getenv("GLOWTAPE_SMS_PROVIDER");
  return p === "twilio" || p === "telnyx";
}

function sendSms(app, to, body) {
  const provider = $os.getenv("GLOWTAPE_SMS_PROVIDER");
  if (!smsConfigured()) {
    app.logger().info("glowtape sms (dormant, not sent)", "to", to, "body", body);
    return false;
  }
  try {
    if (provider === "twilio") {
      const sid = $os.getenv("TWILIO_ACCOUNT_SID");
      const token = $os.getenv("TWILIO_AUTH_TOKEN");
      const from = $os.getenv("TWILIO_FROM");
      const auth = $security.base64Encode(sid + ":" + token);
      const form =
        "To=" + encodeURIComponent(to) +
        "&From=" + encodeURIComponent(from) +
        "&Body=" + encodeURIComponent(body);
      const res = $http.send({
        url: "https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + auth,
        },
        body: form,
        timeout: 15,
      });
      if (res.statusCode >= 300) {
        app.logger().error("glowtape sms: twilio error", "status", res.statusCode, "body", res.raw);
        return false;
      }
      return true;
    }
    if (provider === "telnyx") {
      const res = $http.send({
        url: "https://api.telnyx.com/v2/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + $os.getenv("TELNYX_API_KEY"),
        },
        body: JSON.stringify({ from: $os.getenv("TELNYX_FROM"), to: to, text: body }),
        timeout: 15,
      });
      if (res.statusCode >= 300) {
        app.logger().error("glowtape sms: telnyx error", "status", res.statusCode, "body", res.raw);
        return false;
      }
      return true;
    }
  } catch (err) {
    app.logger().error("glowtape sms: send failed", "error", String(err));
  }
  return false;
}

// US numbers only -> +1XXXXXXXXXX, or null.
function normalizeUsPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return null;
}

function hashCode(phone, code) {
  return $security.sha256(phone + ":" + code);
}

function assertRateLimit(app, phone, ip) {
  const hourAgo = pbNow(-60 * 60 * 1000);
  const byPhone = app.findRecordsByFilter(
    "phone_codes",
    "phone = {:phone} && created >= {:t}",
    "",
    10,
    0,
    { phone, t: hourAgo },
  );
  if (byPhone.length >= 3) {
    throw new BadRequestError("Too many codes requested for this number. Try again in an hour.");
  }
  if (ip) {
    const byIp = app.findRecordsByFilter("phone_codes", "ip = {:ip} && created >= {:t}", "", 20, 0, {
      ip,
      t: hourAgo,
    });
    if (byIp.length >= 10) {
      throw new BadRequestError("Too many codes requested. Try again in an hour.");
    }
  }
}

function createAndSendCode(app, phone, purpose, userId, ip) {
  const code = $security.randomStringWithAlphabet(6, "0123456789");
  const col = app.findCollectionByNameOrId("phone_codes");
  const rec = new Record(col);
  rec.set("phone", phone);
  rec.set("codeHash", hashCode(phone, code));
  rec.set("purpose", purpose);
  if (userId) rec.set("user", userId);
  rec.set("ip", ip || "");
  rec.set("expires", pbNow(10 * 60 * 1000));
  rec.set("attempts", 0);
  app.save(rec);
  sendSms(app, phone, "Glow Tape code: " + code + ". It expires in 10 minutes.");
}

function consumeCode(app, phone, purpose, code) {
  const candidates = app.findRecordsByFilter(
    "phone_codes",
    "phone = {:phone} && purpose = {:purpose} && expires >= {:now}",
    "-created",
    1,
    0,
    { phone, purpose, now: pbNow(0) },
  );
  if (candidates.length === 0) {
    throw new BadRequestError("That code expired. Request a new one.");
  }
  const rec = candidates[0];
  const attempts = (rec.getInt("attempts") || 0) + 1;
  if (attempts > 5) {
    app.delete(rec);
    throw new BadRequestError("Too many tries. Request a new code.");
  }
  if (rec.get("codeHash") !== hashCode(phone, String(code || "").trim())) {
    rec.set("attempts", attempts);
    app.save(rec);
    throw new BadRequestError("That code didn't match.");
  }
  const userId = rec.get("user");
  app.delete(rec);
  return userId;
}

// Format a UTC datetime for Grays Harbor (America/Los_Angeles) without Intl,
// which the JSVM lacks. DST: second Sunday of March to first Sunday of November.
function formatPacific(value) {
  const utc = new Date(String(value).replace(" ", "T"));

  const nthSunday = (year, month, n) => {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (7 - first.getUTCDay()) % 7;
    return 1 + offset + (n - 1) * 7;
  };
  const y = utc.getUTCFullYear();
  const dstStart = Date.UTC(y, 2, nthSunday(y, 2, 2), 10); // 2am PT = 10:00 UTC
  const dstEnd = Date.UTC(y, 10, nthSunday(y, 10, 1), 9); // 2am PDT = 09:00 UTC
  const t = utc.getTime();
  const offsetHours = t >= dstStart && t < dstEnd ? 7 : 8;

  const local = new Date(t - offsetHours * 3600e3);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = local.getUTCHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  const min = String(local.getUTCMinutes()).padStart(2, "0");
  return (
    days[local.getUTCDay()] + " " + months[local.getUTCMonth()] + " " + local.getUTCDate() +
    ", " + h + ":" + min + ampm
  );
}

// --- calendar (ics) -------------------------------------------------------------

function icsEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// "2026-07-15 19:00:00.000Z" -> "20260715T190000Z"
function icsDate(value) {
  const d = String(value);
  return (
    d.slice(0, 4) + d.slice(5, 7) + d.slice(8, 10) +
    "T" + d.slice(11, 13) + d.slice(14, 16) + d.slice(17, 19) + "Z"
  );
}

function icsDateFromMs(ms) {
  return icsDate(new Date(ms).toISOString().replace("T", " "));
}

module.exports = {
  pbNow,
  toIdArray,
  recipients,
  sendMail,
  smsConfigured,
  sendSms,
  normalizeUsPhone,
  hashCode,
  assertRateLimit,
  createAndSendCode,
  consumeCode,
  formatPacific,
  icsEscape,
  icsDate,
  icsDateFromMs,
};
