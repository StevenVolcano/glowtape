/// <reference path="../pb_data/types.d.ts" />
//
// Glow Tape SMS layer: phone verification, sign-in by text, and event
// reminders. Dormant until a provider is configured via environment
// variables — every send becomes a log line instead.
//
//   GLOWTAPE_SMS_PROVIDER = twilio | telnyx
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM   (twilio)
//   TELNYX_API_KEY, TELNYX_FROM                          (telnyx)
//
// Safety rails: US numbers only, codes are hashed and expire in 10 minutes,
// max 3 codes per phone and 10 per IP per hour, 5 wrong guesses kills a
// code, sign-in codes are only ever sent to phones already verified on an
// account, and the phone/phoneVerified fields cannot be edited through the
// regular record API.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

// --- routes -------------------------------------------------------------------

// Attach/verify a phone on the signed-in account.
routerAdd(
  "POST",
  "/api/glowtape/phone/start",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ phone: "" });
    e.bindBody(data);
    const phone = lib.normalizeUsPhone(data.phone);
    if (!phone) throw new BadRequestError("Enter a 10-digit US phone number.");
    lib.assertRateLimit(e.app, phone, e.realIP());
    lib.createAndSendCode(e.app, phone, "verify", e.auth.id, e.realIP());
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);

routerAdd(
  "POST",
  "/api/glowtape/phone/confirm",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ phone: "", code: "" });
    e.bindBody(data);
    const phone = lib.normalizeUsPhone(data.phone);
    if (!phone) throw new BadRequestError("Enter a 10-digit US phone number.");
    const userId = lib.consumeCode(e.app, phone, "verify", data.code);
    if (userId !== e.auth.id) throw new BadRequestError("That code didn't match.");
    const user = e.app.findRecordById("users", e.auth.id);
    user.set("phone", phone);
    user.set("phoneVerified", true);
    user.set("smsOptIn", true);
    e.app.save(user);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);

// Sign in by text. Codes are only sent to phones already verified on an
// account; unknown numbers get the same "ok" so the endpoint doesn't leak
// which numbers are registered (and can't be used to text strangers).
routerAdd("POST", "/api/glowtape/signin-sms/start", (e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  const data = new DynamicModel({ phone: "" });
  e.bindBody(data);
  const phone = lib.normalizeUsPhone(data.phone);
  if (!phone) throw new BadRequestError("Enter a 10-digit US phone number.");
  lib.assertRateLimit(e.app, phone, e.realIP());
  try {
    const user = e.app.findFirstRecordByFilter(
      "users",
      "phone = {:phone} && phoneVerified = true",
      { phone },
    );
    lib.createAndSendCode(e.app, phone, "signin", user.id, e.realIP());
  } catch {
    // no matching account: swallow silently
  }
  return e.json(200, { ok: true });
});

routerAdd("POST", "/api/glowtape/signin-sms/confirm", (e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  const data = new DynamicModel({ phone: "", code: "" });
  e.bindBody(data);
  const phone = lib.normalizeUsPhone(data.phone);
  if (!phone) throw new BadRequestError("Enter a 10-digit US phone number.");
  const userId = lib.consumeCode(e.app, phone, "signin", data.code);
  if (!userId) throw new BadRequestError("That code didn't match.");
  const user = e.app.findRecordById("users", userId);
  return $apis.recordAuthResponse(e, user, "phone");
});

// --- guard: phone fields only change through the verified flow -----------------

onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const original = e.record.original();
    for (const f of ["phone", "phoneVerified"]) {
      if (e.record.get(f) !== original.get(f)) {
        throw new BadRequestError("Phone numbers are changed via the verification flow.");
      }
    }
    if (e.record.get("operator") !== original.get("operator")) {
      throw new BadRequestError("The operator flag is set in the PocketBase dashboard.");
    }
    // The age band is derived from the birthdate at signup — if it were
    // self-editable, so would be all the youth-safety gating it drives.
    for (const f of ["ageBand", "teenUntil"]) {
      if (String(e.record.get(f)) !== String(original.get(f))) {
        throw new BadRequestError("Ask the operator to correct an age band.");
      }
    }
  }
  e.next();
}, "users");

// --- reminder cron --------------------------------------------------------------
// Every 10 minutes: remind people about their calls at the times THEY chose
// (users.reminderTimes, up to 3 of eve/morn/10h/4h/2h/1h/30m; default 10h +
// 2h) — by text if they've verified a phone and opted in, and by app
// notification if they've turned notifications on. Timing (incl. 9pm-7am
// quiet hours) lives in lib.reminderDueKinds. reminders_sent (event, user,
// kind) dedupes across runs; one message covers every newly-due kind, so a
// last-minute event never gets a burst.

cronAdd("glowtape_sms_reminders", "*/10 * * * *", () => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  const smsOn = lib.smsConfigured();
  const pushOn = lib.pushConfigured();
  const hour = lib.pacificHour();
  const quiet = hour >= 21 || hour < 7;

  if ((smsOn || pushOn) && !quiet) {
    const nowMs = Date.now();
    // 40h covers the furthest reminder: 7pm the night before a late call.
    const events = $app.findRecordsByFilter(
      "events",
      "start >= {:from} && start <= {:to} && status != 'cancelled'",
      "start",
      500,
      0,
      { from: lib.pbNow(0), to: lib.pbNow(40 * 3600e3) },
    );
    const userCache = {};
    const pushCache = {};

    for (const event of events) {
      let production;
      try {
        production = $app.findRecordById("productions", event.get("production"));
      } catch {
        continue;
      }
      if (production.get("archived")) continue;
      const startMs = new Date(String(event.get("start")).replace(" ", "T")).getTime();
      const called = lib.toIdArray(event.get("called"));
      const members = $app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
        p: production.id,
      });

      for (const m of members) {
        if (
          called.length > 0 &&
          !called.includes(m.id) &&
          !called.includes(String(m.get("claimedFrom") || ""))
        )
          continue;

        // The member's own user plus any guardians (child members have no
        // user of their own; guardians get the reminder in their place).
        const uids = [];
        if (m.get("user")) uids.push(String(m.get("user")));
        for (const g of lib.toIdArray(m.get("guardians"))) uids.push(g);

        for (const uid of uids) {
          let user = userCache[uid];
          if (user === undefined) {
            try {
              user = $app.findRecordById("users", uid);
            } catch {
              user = null;
            }
            userCache[uid] = user;
          }
          if (!user) continue;

          const kinds = lib.reminderKinds(user.get("reminderTimes"));
          const due = lib.reminderDueKinds(nowMs, startMs, kinds);
          if (due.length === 0) continue;

          const textable = smsOn && user.get("smsOptIn") && user.get("phoneVerified") && user.get("phone");
          if (pushCache[uid] === undefined) {
            pushCache[uid] =
              pushOn &&
              $app.findRecordsByFilter("push_subscriptions", "user = {:u}", "", 1, 0, { u: uid }).length > 0;
          }
          if (!textable && !pushCache[uid]) continue;

          // unique index makes double-sends impossible even if two runs race
          const col = $app.findCollectionByNameOrId("reminders_sent");
          const fresh = [];
          for (const kind of due) {
            try {
              const marker = new Record(col);
              marker.set("event", event.id);
              marker.set("user", user.id);
              marker.set("kind", kind);
              $app.save(marker);
              fresh.push(kind);
            } catch {
              /* already reminded for this one */
            }
          }
          if (fresh.length === 0) continue;
          const textKinds = lib.reminderTextKinds(startMs, kinds);
          const textNow = textable && fresh.some((k) => textKinds.includes(k));

          const forChild = !m.get("user") && m.get("displayName") ? "For " + m.get("displayName") + ": " : "";
          const when = lib.formatPacific(event.get("start"));
          const loc = event.get("location") ? " at " + event.get("location") : "";
          const word = lib.reminderWord(nowMs, startMs);
          if (textNow) {
            lib.sendSms(
              $app,
              user.get("phone"),
              "Glow Tape: " + forChild + event.get("title") +
                " (" + production.get("title") + ") is " + word + " — " +
                when + loc + ". Reply STOP to opt out.",
            );
          }
          if (pushCache[uid]) {
            lib.sendPush($app, [uid], {
              title: `⏰ ${forChild}${event.get("title")} is ${word}`,
              body: `${production.get("title")} — ${when}${loc}`,
              url: `/production/${production.id}/schedule`,
            });
          }
        }
      }
    }
  }

  // housekeeping: drop expired codes
  const stale = $app.findRecordsByFilter("phone_codes", "expires < {:now}", "", 200, 0, {
    now: lib.pbNow(0),
  });
  for (const s of stale) $app.delete(s);
});

// Own phone status. The phone fields are hidden at the API layer (contact
// privacy, migration 1755500000), so the settings card reads them through
// this route instead of the auth record.
routerAdd(
  "GET",
  "/api/glowtape/phone/status",
  (e) => {
    const user = e.app.findRecordById("users", e.auth.id);
    return e.json(200, {
      phone: user.get("phone") || "",
      phoneVerified: !!user.get("phoneVerified"),
      smsOptIn: !!user.get("smsOptIn"),
    });
  },
  $apis.requireAuth(),
);

// Opt in or out of reminder texts. Same reason: smsOptIn is hidden, so the
// record API can't set it from the client.
routerAdd(
  "POST",
  "/api/glowtape/phone/optin",
  (e) => {
    const data = new DynamicModel({ on: false });
    e.bindBody(data);
    const user = e.app.findRecordById("users", e.auth.id);
    if (!user.get("phoneVerified")) {
      throw new BadRequestError("Verify a phone number first.");
    }
    user.set("smsOptIn", !!data.on);
    e.app.save(user);
    return e.json(200, { ok: true, smsOptIn: !!data.on });
  },
  $apis.requireAuth(),
);
