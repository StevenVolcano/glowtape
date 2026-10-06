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

// A user can manage a production if they're on its managers list — or if
// they're the app operator (the "Glow Tape Stagehand"), who can step into any
// production for setup and troubleshooting. Route-level twin of the
// `|| @request.auth.operator = true` clause in the API rules
// (migration 1757400000).
function canManage(production, auth) {
  if (!auth) return false;
  if (auth.get("operator")) return true;
  return toIdArray(production.get("managers")).includes(auth.id);
}

// Archived shows are read-only. The record API is guarded in archive.pb.js;
// custom routes that write content through app.save() call this so they're
// blocked too. Pass the resolved production record.
function assertNotArchived(production) {
  if (production && production.get("archived")) {
    throw new BadRequestError(
      "This show is archived, so it's read-only. Unarchive it in Manage to make changes.",
    );
  }
}

// Owning production id for a record in a guarded content collection (see
// archive.pb.js's list). Most carry a direct `production` relation; a few
// resolve through a parent. Community rows (production = '') and missing
// parents resolve to "" — never blocked.
function ownerProductionId(app, name, record) {
  try {
    if (name === "acks" || name === "attendance") {
      return String(app.findRecordById("events", record.get("event")).get("production") || "");
    }
    if (name === "announcement_acks") {
      return String(app.findRecordById("announcements", record.get("announcement")).get("production") || "");
    }
    if (name === "messages") {
      return String(app.findRecordById("channels", record.get("channel")).get("production") || "");
    }
    if (name === "reactions") {
      const msg = app.findRecordById("messages", record.get("message"));
      return String(app.findRecordById("channels", msg.get("channel")).get("production") || "");
    }
    return String(record.get("production") || "");
  } catch {
    return "";
  }
}

// Block a record-API write when its production is archived. Called from the
// onRecord*Request handlers in archive.pb.js (which require this lib inside
// their own bodies — top-level hook functions don't exist when handlers fire).
function guardArchivedWrite(e) {
  if (e.hasSuperuserAuth()) return;
  let name = "";
  try {
    name = e.collection.name;
  } catch {
    try {
      name = e.record.collection().name;
    } catch {
      return; // can't tell the collection — fail open.
    }
  }
  const pid = ownerProductionId(e.app, name, e.record);
  if (!pid) return;
  let prod;
  try {
    prod = e.app.findRecordById("productions", pid);
  } catch {
    return; // production gone — nothing to protect.
  }
  assertNotArchived(prod);
}

// --- email --------------------------------------------------------------------

function recipients(app, productionId, calledMemberIds) {
  const calledIds = toIdArray(calledMemberIds);
  const members = app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
    p: productionId,
  });
  const out = [];
  const seen = new Set();
  const push = (uid) => {
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    try {
      const u = app.findRecordById("users", uid);
      out.push({ address: u.email(), name: u.get("name") });
    } catch {
      /* skip broken rows */
    }
  };
  for (const m of members) {
    if (
      calledIds.length > 0 &&
      !calledIds.includes(m.id) &&
      !calledIds.includes(String(m.get("claimedFrom") || ""))
    )
      continue;
    push(m.get("user"));
    // Guardian-managed child: every guardian hears everything (issue #9).
    for (const g of toIdArray(m.get("guardians"))) push(g);
    // Manager-entered contact for folks not on Glow Tape: email only, no SMS.
    const offline = String(m.get("contactEmail") || "").trim();
    if (offline && !m.get("user") && !seen.has("offline:" + offline)) {
      seen.add("offline:" + offline);
      out.push({ address: offline, name: m.get("displayName") || m.get("position") || "Cast member" });
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

// Plain-JS base64: PocketBase's JSVM has no $security.base64Encode (found
// the hard way on the first real Twilio send, 2026-07-21). ASCII-only input
// (SID:token), so no unicode handling needed. Verified byte-identical to
// Node's Buffer base64.
function base64Encode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < str.length; i += 3) {
    const c1 = str.charCodeAt(i);
    const c2 = str.charCodeAt(i + 1);
    const c3 = str.charCodeAt(i + 2);
    out += chars[c1 >> 2];
    out += chars[((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4)];
    out += isNaN(c2) ? "=" : chars[((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6)];
    out += isNaN(c3) ? "=" : chars[c3 & 63];
  }
  return out;
}

// Trim + lowercase so an invisible trailing space or stray capital in the
// env file can't silently put texting into dormant mode (2026-07-21: it did).
function smsProvider() {
  return ($os.getenv("GLOWTAPE_SMS_PROVIDER") || "").trim().toLowerCase();
}

function smsConfigured() {
  const p = smsProvider();
  return p === "twilio" || p === "telnyx";
}

function sendSms(app, to, body) {
  const provider = smsProvider();
  if (!smsConfigured()) {
    app.logger().info("glowtape sms (dormant, not sent)", "to", to, "body", body);
    return false;
  }
  try {
    if (provider === "twilio") {
      const sid = ($os.getenv("TWILIO_ACCOUNT_SID") || "").trim();
      const token = ($os.getenv("TWILIO_AUTH_TOKEN") || "").trim();
      const from = ($os.getenv("TWILIO_FROM") || "").trim();
      const auth = base64Encode(sid + ":" + token);
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

// America/Los_Angeles UTC offset without Intl, which the JSVM lacks.
// DST: second Sunday of March to first Sunday of November.
function pacificOffsetHours(t) {
  const nthSunday = (year, month, n) => {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (7 - first.getUTCDay()) % 7;
    return 1 + offset + (n - 1) * 7;
  };
  const y = new Date(t).getUTCFullYear();
  const dstStart = Date.UTC(y, 2, nthSunday(y, 2, 2), 10); // 2am PT = 10:00 UTC
  const dstEnd = Date.UTC(y, 10, nthSunday(y, 10, 1), 9); // 2am PDT = 09:00 UTC
  return t >= dstStart && t < dstEnd ? 7 : 8;
}

// The current (or given) hour of day in Grays Harbor, 0-23.
function pacificHour(date) {
  const t = (date || new Date()).getTime();
  return new Date(t - pacificOffsetHours(t) * 3600e3).getUTCHours();
}

// --- reminder timing ------------------------------------------------------------
// Keys people can pick (users.reminderTimes, up to 3). Relative ones are
// "this long before the call"; eve/morn are clock times in Grays Harbor.
const REMINDER_KEYS = ["eve", "morn", "10h", "4h", "2h", "1h", "30m"];
const REMINDER_DEFAULT = ["10h", "2h"];
const REMINDER_HOURS = { "10h": 10, "4h": 4, "2h": 2, "1h": 1, "30m": 0.5 };

// The user's chosen keys (validated), or the default when never set.
function reminderKinds(value) {
  // record.get() on a json field returns raw JSON BYTES in the JSVM — which
  // goja even reports as an array (of numbers) — so anything that isn't a
  // plain array of strings is parsed from its text (as calendar.pb.js does).
  // (A JSON null comes back as EMPTY bytes, whose String() is "null".)
  let v = value;
  const plain = Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");
  if (v !== null && v !== undefined && !plain) {
    const text = String(v);
    try {
      v = text === "" && Array.isArray(v) ? [] : JSON.parse(text);
    } catch {
      v = null;
    }
  }
  if (!Array.isArray(v)) v = null;
  if (v === null || v === undefined || v === "") return REMINDER_DEFAULT.slice();
  const out = [];
  for (const k of v) {
    const key = String(k);
    if (REMINDER_KEYS.includes(key) && !out.includes(key)) out.push(key);
  }
  return out.slice(0, 3);
}

// UTC ms of hour h (Pacific) on the Pacific calendar day containing t.
function pacificAt(t, h) {
  const off = pacificOffsetHours(t) * 3600e3;
  const dayStart = Math.floor((t - off) / 86400e3) * 86400e3;
  return dayStart + off + h * 3600e3;
}

// No texts or pings 9pm-7am Pacific. A reminder that would land in quiet
// hours moves to 7pm the evening before (early calls get announced the night
// before, never at dawn) — except for a call later that SAME night, which is
// reminded just before 9pm.
function reminderMoment(kind, startMs) {
  let m;
  if (kind === "eve") m = pacificAt(startMs, 19) - 86400e3;
  else if (kind === "morn") {
    m = pacificAt(startMs, 8);
    if (startMs - m < 30 * 60e3) m = pacificAt(startMs, 19) - 86400e3; // call before ~8:30
  } else m = startMs - REMINDER_HOURS[kind] * 3600e3;
  const h = pacificHour(new Date(m));
  if (h >= 21) {
    // a call later tonight: just before quiet hours; tomorrow morning's call:
    // the 7pm evening heads-up, so the night-before reminders arrive together
    const sameNight = pacificAt(startMs, 0) === pacificAt(m, 0);
    m = sameNight ? pacificAt(m, 21) - 10 * 60e3 : pacificAt(m, 19);
  }
  else if (h < 7) m = pacificAt(m, 19) - 86400e3;
  return m;
}

// Which of the chosen kinds are due right now for a call starting at startMs.
// The cron sends ONE reminder covering every newly-due kind, so an event
// added at the last minute never gets a burst of texts.
function reminderDueKinds(nowMs, startMs, kinds) {
  if (startMs <= nowMs) return [];
  const h = pacificHour(new Date(nowMs));
  if (h >= 21 || h < 7) return [];
  return kinds.filter((k) => nowMs >= reminderMoment(k, startMs));
}

// Texts stay within the SMS opt-in promise ("up to 2 per rehearsal day"):
// only the two chosen kinds closest to the call go out by text; a third
// choice arrives as an app notification only.
function reminderTextKinds(startMs, kinds) {
  return kinds
    .slice()
    .sort((a, b) => reminderMoment(b, startMs) - reminderMoment(a, startMs))
    .slice(0, 2);
}

// "soon" / "today" / "tomorrow" / weekday, for the reminder text.
function reminderWord(nowMs, startMs) {
  if (startMs - nowMs <= 3 * 3600e3) return "soon";
  const day = (t) => Math.floor((t - pacificOffsetHours(t) * 3600e3) / 86400e3);
  const d = day(startMs) - day(nowMs);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  return "coming up";
}

// Format a UTC datetime for Grays Harbor.
function formatPacific(value) {
  const utc = new Date(String(value).replace(" ", "T"));
  const t = utc.getTime();
  const local = new Date(t - pacificOffsetHours(t) * 3600e3);
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

// Emails + opted-in phones for a production's managers (for day-of alerts).
function managerContacts(app, production) {
  const out = { emails: [], phones: [] };
  for (const uid of toIdArray(production.get("managers"))) {
    try {
      const u = app.findRecordById("users", uid);
      out.emails.push({ address: u.email(), name: u.get("name") });
      if (u.get("smsOptIn") && u.get("phoneVerified") && u.get("phone")) {
        out.phones.push(u.get("phone"));
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

// --- web push -------------------------------------------------------------------
// The actual Web Push crypto lives in a localhost Node sidecar (see
// deploy/push-sender); these helpers collect subscriptions and batch to it.

function pushConfigured() {
  return !!$os.getenv("GLOWTAPE_VAPID_PUBLIC");
}

// User ids behind a set of member ids (or every member when memberIds is
// null/empty): each member's own user plus all guardians, claimedFrom-aware.
function recipientUserIds(app, productionId, memberIds) {
  const want = memberIds && memberIds.length ? memberIds : null;
  const rows = app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
    p: productionId,
  });
  const seen = {};
  const out = [];
  const add = (id) => {
    if (id && !seen[id]) {
      seen[id] = 1;
      out.push(id);
    }
  };
  for (const m of rows) {
    if (want && !want.includes(m.id) && !want.includes(String(m.get("claimedFrom") || ""))) {
      continue;
    }
    add(String(m.get("user") || ""));
    for (const g of toIdArray(m.get("guardians"))) add(g);
  }
  return out;
}

// Send one payload to every subscription of the given users (null = every
// subscription there is). Fire-and-forget: failures only log, and endpoints
// the push service reports gone are pruned.
function sendPush(app, userIds, payload) {
  if (!pushConfigured()) return;
  try {
    let subs = [];
    if (userIds === null) {
      subs = app.findRecordsByFilter("push_subscriptions", "id != ''", "", 2000, 0);
    } else {
      const seen = {};
      const uniq = [];
      for (const u of userIds) {
        if (u && !seen[u]) {
          seen[u] = 1;
          uniq.push(u);
        }
      }
      for (let i = 0; i < uniq.length; i += 20) {
        const chunk = uniq.slice(i, i + 20);
        const params = {};
        const filter = chunk
          .map((id, j) => {
            params["u" + j] = id;
            return "user = {:u" + j + "}";
          })
          .join(" || ");
        subs = subs.concat(app.findRecordsByFilter("push_subscriptions", filter, "", 500, 0, params));
      }
    }
    if (subs.length === 0) return;

    const items = subs.map((s) => ({
      subscription: {
        endpoint: s.get("endpoint"),
        keys: { p256dh: s.get("p256dh"), auth: s.get("auth") },
      },
      payload,
    }));
    const res = $http.send({
      url: "http://127.0.0.1:8666/send",
      method: "POST",
      body: JSON.stringify({ items }),
      headers: { "content-type": "application/json" },
      timeout: 20,
    });
    const results = ((res && res.json) || {}).results || [];
    for (let i = 0; i < results.length; i++) {
      if (results[i] && results[i].gone) {
        try {
          app.delete(subs[i]);
        } catch {
          /* already gone */
        }
      }
    }
  } catch (err) {
    app.logger().warn("glowtape: push send failed", "error", String(err));
  }
}

// Recompute a production's denormalized managers list from member flags.
function syncProductionManagers(app, productionId) {
  try {
    const production = app.findRecordById("productions", productionId);
    const rows = app.findRecordsByFilter(
      "members",
      "production = {:p} && manager = true",
      "",
      500,
      0,
      { p: productionId },
    );
    const next = [];
    for (const r of rows) {
      const uid = r.get("user");
      if (uid && !next.includes(uid)) next.push(uid);
    }
    const current = toIdArray(production.get("managers"));
    const same =
      next.length === current.length && next.every((id) => current.includes(id));
    if (!same) {
      production.set("managers", next);
      app.save(production);
    }
  } catch (err) {
    app.logger().error("glowtape: manager sync failed", "error", String(err));
  }
}

// Keep a member's auto-group assignments (🔒 Cast / 🔒 Crew channels) matched
// to their role: performers belong in the 'cast' auto group, crew in 'crew',
// everyone else in neither. Hand-picked custom groups are left alone. Called
// from the members after-save hooks; the no-change guard stops the re-entrant
// second pass.
function syncMemberAutoGroups(app, member) {
  try {
    const autoGroups = app.findRecordsByFilter(
      "groups",
      "production = {:p} && auto != ''",
      "",
      10,
      0,
      { p: String(member.get("production")) },
    );
    if (autoGroups.length === 0) return;
    const role = String(member.get("role"));
    const current = toIdArray(member.get("groups"));
    const next = current.slice();
    for (const g of autoGroups) {
      const wanted =
        (g.get("auto") === "cast" && role === "performer") ||
        (g.get("auto") === "crew" && role === "crew");
      const at = next.indexOf(g.id);
      if (wanted && at === -1) next.push(g.id);
      if (!wanted && at !== -1) next.splice(at, 1);
    }
    const same = next.length === current.length && next.every((id) => current.includes(id));
    if (!same) {
      member.set("groups", next);
      app.save(member);
    }
  } catch (err) {
    app.logger().error("glowtape: auto-group sync failed", "error", String(err));
  }
}

// Validate a run-of-show timeline ({title, minutes} rows; clock times are
// never stored — they compute forward from the event start). Used by the
// events/update route and the Claude connector. null / undefined / [] clear
// it (returns []). Throws an Error naming the bad row.
const TIMELINE_MAX_ROWS = 40;
const TIMELINE_MAX_BYTES = 10000; // events.timeline maxSize (migration 1757000000)
function cleanTimeline(value) {
  if (value === null || value === undefined || value === "") return [];
  // Round-trip so a VM-wrapped Go slice from the request body becomes a plain array.
  let list;
  try {
    list = JSON.parse(JSON.stringify(value));
  } catch (err) {
    throw new Error("The timeline must be a list of {title, minutes} rows.");
  }
  if (!Array.isArray(list)) throw new Error("The timeline must be a list of {title, minutes} rows.");
  if (list.length > TIMELINE_MAX_ROWS) {
    throw new Error(`The timeline has ${list.length} rows — the most is ${TIMELINE_MAX_ROWS}.`);
  }
  const out = list.map((row, i) => {
    const n = i + 1;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Timeline row ${n} must be {title, minutes}.`);
    }
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) throw new Error(`Timeline row ${n} needs a title.`);
    if (title.length > 200) throw new Error(`Timeline row ${n} title is longer than 200 characters.`);
    const minutes = row.minutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes > 600) {
      throw new Error(`Timeline row ${n} ("${title}") minutes must be a whole number from 0 to 600.`);
    }
    return { title, minutes };
  });
  // Bytes, not characters: the JSON field limit counts the encoded size.
  const size = unescape(encodeURIComponent(JSON.stringify(out))).length;
  if (size > TIMELINE_MAX_BYTES) {
    throw new Error(`The timeline is too long to save (${size} bytes; the most is ${TIMELINE_MAX_BYTES}). Shorten some titles.`);
  }
  return out;
}

module.exports = {
  cleanTimeline,
  pbNow,
  REMINDER_KEYS,
  reminderKinds,
  reminderDueKinds,
  reminderTextKinds,
  reminderWord,
  canManage,
  assertNotArchived,
  guardArchivedWrite,
  managerContacts,
  syncProductionManagers,
  syncMemberAutoGroups,
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
  pacificHour,
  pacificOffsetHours,
  pushConfigured,
  recipientUserIds,
  sendPush,
  icsEscape,
  icsDate,
  icsDateFromMs,
};
