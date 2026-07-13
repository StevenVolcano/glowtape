/// <reference path="../pb_data/types.d.ts" />
//
// Self-service email change. Sign-in has no password, so possession of the
// NEW inbox is the proof: a code goes to the new address and the switch only
// happens after it's typed back. Codes reuse the phone_codes machinery
// (the "phone" column holds the email here).
//
// NOTE: handlers run in isolated VMs — helpers are require()d INSIDE each.

routerAdd(
  "POST",
  "/api/glowtape/email/start",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ email: "" });
    e.bindBody(data);
    const email = String(data.email || "").trim().toLowerCase();
    if (!email.includes("@") || email.length < 5) {
      throw new BadRequestError("Enter the new email address.");
    }
    let taken = false;
    try {
      const existing = e.app.findAuthRecordByEmail("users", email);
      taken = existing.id !== e.auth.id;
    } catch {
      /* free */
    }
    if (taken) throw new BadRequestError("That address is already on another account.");

    lib.assertRateLimit(e.app, email, e.realIP());
    const code = $security.randomStringWithAlphabet(6, "0123456789");
    const col = e.app.findCollectionByNameOrId("phone_codes");
    const rec = new Record(col);
    rec.set("phone", email);
    rec.set("codeHash", lib.hashCode(email, code));
    rec.set("purpose", "email-change");
    rec.set("user", e.auth.id);
    rec.set("ip", e.realIP() || "");
    rec.set("expires", lib.pbNow(10 * 60 * 1000));
    rec.set("attempts", 0);
    e.app.save(rec);
    lib.sendMail(
      e.app,
      [email],
      "Glow Tape: confirm your new email",
      `<p>Your confirmation code is <strong style="font-size:1.3em">${code}</strong>.</p>` +
        `<p>Type it into Glow Tape to switch your account to this address. ` +
        `It expires in 10 minutes. Didn't ask for this? Just ignore it.</p>`,
    );
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);

routerAdd(
  "POST",
  "/api/glowtape/email/confirm",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ email: "", code: "" });
    e.bindBody(data);
    const email = String(data.email || "").trim().toLowerCase();
    const userId = lib.consumeCode(e.app, email, "email-change", data.code);
    if (userId !== e.auth.id) throw new BadRequestError("That code didn't match.");
    const user = e.app.findRecordById("users", e.auth.id);
    user.setEmail(email);
    user.set("verified", true);
    e.app.save(user);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);
