/// <reference path="../pb_data/types.d.ts" />
//
// Fingerprint / face sign-in (passkeys, WebAuthn). Optional extra to the
// emailed code: a signed-in person sets it up once per device from Home, then
// signs in with their phone's fingerprint, Face ID or Windows Hello.
//
//   register/start + register/finish  (signed in)  — save this device's key
//   signin/start   + signin/finish    (anyone)     — prove it, get a session
//
// Signature math happens in the Node sidecar (passkeys_lib.sidecarCheck).
// NOTE: handlers run in isolated VMs — helpers are require()d inside each one.

routerAdd(
  "POST",
  "/api/glowtape/passkey/register/start",
  (e) => {
    const pk = require(`${__hooks}/passkeys_lib.js`);
    const user = e.auth;
    const ch = pk.issueChallenge(e.app, "register", user.id, e.realIP());
    const existing = e.app.findRecordsByFilter("passkeys", "user = {:u}", "", 50, 0, { u: user.id });
    return e.json(200, {
      challengeId: ch.id,
      challenge: ch.getString("challenge"),
      rpId: pk.rpId(e),
      userId: user.id,
      userName: user.getString("email"),
      displayName: user.getString("name") || user.getString("email"),
      exclude: existing.map((r) => r.getString("credentialId")),
    });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/glowtape/passkey/register/finish",
  (e) => {
    const pk = require(`${__hooks}/passkeys_lib.js`);
    const data = new DynamicModel({
      challengeId: "",
      credentialId: "",
      clientDataJSON: "",
      publicKey: "",
      alg: 0,
      label: "",
    });
    e.bindBody(data);
    const ch = pk.consumeChallenge(e.app, data.challengeId, "register");
    if (!ch || ch.getString("user") !== e.auth.id) {
      throw new BadRequestError("That took too long — try again.");
    }
    const cid = data.credentialId;
    // (goja regexps are RE2: no {16,1400} repeat counts — check length apart)
    if (!/^[A-Za-z0-9_-]+$/.test(cid) || cid.length < 16 || cid.length > 1400) {
      throw new BadRequestError("This device sent something we can't use.");
    }
    const check = pk.sidecarCheck("register", {
      clientDataJSON: data.clientDataJSON,
      challenge: ch.getString("challenge"),
      origin: pk.origin(e),
      publicKey: data.publicKey,
      alg: data.alg,
    });
    if (!check.ok) {
      console.log(`passkey register refused: ${check.reason}`);
      throw new BadRequestError("This device's fingerprint sign-in didn't check out. Try again.");
    }
    if (e.app.findRecordsByFilter("passkeys", "user = {:u}", "", 21, 0, { u: e.auth.id }).length >= 20) {
      throw new BadRequestError("That's a lot of devices — remove an old one first.");
    }
    const rec = new Record(e.app.findCollectionByNameOrId("passkeys"));
    rec.set("user", e.auth.id);
    rec.set("credentialId", data.credentialId);
    rec.set("publicKey", data.publicKey);
    rec.set("alg", data.alg);
    rec.set("signCount", 0);
    rec.set("label", String(data.label || "").trim().slice(0, 80) || "This device");
    try {
      e.app.save(rec);
    } catch {
      throw new BadRequestError("This device is already set up.");
    }
    return e.json(200, { ok: true, id: rec.id });
  },
  $apis.requireAuth("users"),
);

routerAdd("POST", "/api/glowtape/passkey/signin/start", (e) => {
  const pk = require(`${__hooks}/passkeys_lib.js`);
  const ch = pk.issueChallenge(e.app, "signin", "", e.realIP());
  return e.json(200, { challengeId: ch.id, challenge: ch.getString("challenge"), rpId: pk.rpId(e) });
});

routerAdd("POST", "/api/glowtape/passkey/signin/finish", (e) => {
  const pk = require(`${__hooks}/passkeys_lib.js`);
  const data = new DynamicModel({
    challengeId: "",
    credentialId: "",
    clientDataJSON: "",
    authenticatorData: "",
    signature: "",
  });
  e.bindBody(data);
  const fail = "We couldn't sign you in with that. Use the email code instead.";
  const ch = pk.consumeChallenge(e.app, data.challengeId, "signin");
  if (!ch) throw new BadRequestError("That took too long — try again.");

  let key;
  try {
    key = e.app.findFirstRecordByFilter("passkeys", "credentialId = {:c}", { c: data.credentialId });
  } catch {
    // Deleted from Glow Tape but still on the phone.
    throw new BadRequestError(
      "This device's fingerprint sign-in was removed. Sign in with the email code, then set it up again.",
    );
  }
  const check = pk.sidecarCheck("assert", {
    clientDataJSON: data.clientDataJSON,
    authenticatorData: data.authenticatorData,
    signature: data.signature,
    challenge: ch.getString("challenge"),
    origin: pk.origin(e),
    rpId: pk.rpId(e),
    publicKey: key.getString("publicKey"),
    alg: key.getInt("alg"),
  });
  if (!check.ok) {
    console.log(`passkey signin refused: ${check.reason}`);
    throw new BadRequestError(fail);
  }
  // A counter that goes backwards means a cloned key. Synced passkeys
  // (iCloud/Google) always report 0, which is fine.
  const count = Number(check.signCount) || 0;
  const stored = key.getInt("signCount");
  if (count !== 0 && count <= stored) {
    console.log(`passkey signin refused: sign count ${count} <= ${stored} for ${key.id}`);
    throw new BadRequestError(fail);
  }
  key.set("signCount", count);
  key.set("lastUsed", pk.pbTime(0));
  e.app.save(key);

  const user = e.app.findRecordById("users", key.getString("user"));
  return $apis.recordAuthResponse(e, user, "passkey");
});
