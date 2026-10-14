// Shared helpers for fingerprint / face sign-in (passkeys). require()d inside
// each handler of passkeys.pb.js (handlers run in isolated VMs).
//
// Signature checks happen in the Node sidecar (deploy/push-sender/webauthn.mjs)
// because the JSVM has no ECDSA/RSA verify. This file owns everything stateful:
// challenges, stored keys, sign counters.

const CHALLENGE_SECONDS = 300;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function pbTime(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString().replace("T", " ");
}

// The page origin the browser must report, and the passkey "relying party"
// id (its hostname) — glowtape.net in production, localhost in dev.
function origin(e) {
  const oauth = require(`${__hooks}/oauth_lib.js`);
  return oauth.baseUrl(e);
}

function rpId(e) {
  return origin(e).replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
}

// Drop expired challenges, refuse a flood from one address, then issue a new
// one-use challenge. Returns the record.
function issueChallenge(app, purpose, userId, ip) {
  try {
    for (const r of app.findRecordsByFilter("passkey_challenges", "expires < {:now}", "", 500, 0, {
      now: pbTime(0),
    })) {
      app.delete(r);
    }
  } catch (err) {
    console.log(`passkey challenge cleanup: ${err}`);
  }
  const recent = app.findRecordsByFilter(
    "passkey_challenges",
    "ip = {:ip} && created > {:since}",
    "",
    30,
    0,
    { ip: ip || "", since: pbTime(-CHALLENGE_SECONDS) },
  );
  if (recent.length >= 30) throw new BadRequestError("Too many tries — wait a few minutes.");

  const rec = new Record(app.findCollectionByNameOrId("passkey_challenges"));
  rec.set("challenge", $security.randomStringWithAlphabet(43, ALPHABET));
  rec.set("purpose", purpose);
  if (userId) rec.set("user", userId);
  rec.set("ip", ip || "");
  rec.set("expires", pbTime(CHALLENGE_SECONDS));
  app.save(rec);
  return rec;
}

// Find and delete (one use) an unexpired challenge. Returns its record or null.
function consumeChallenge(app, id, purpose) {
  let rec;
  try {
    rec = app.findRecordById("passkey_challenges", String(id || ""));
  } catch {
    return null;
  }
  app.delete(rec);
  if (rec.getString("purpose") !== purpose) return null;
  if (rec.getString("expires") < pbTime(0)) return null;
  return rec;
}

// Ask the sidecar to check a browser response. Returns its JSON
// ({ok, reason?, signCount?}); a down sidecar is a friendly error.
function sidecarCheck(path, body) {
  let res;
  try {
    res = $http.send({
      url: "http://127.0.0.1:8666/webauthn/" + path,
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      timeout: 10,
    });
  } catch (err) {
    console.log(`passkey sidecar unreachable: ${err}`);
    res = null;
  }
  if (!res || res.statusCode !== 200) {
    throw new BadRequestError("Fingerprint sign-in is resting right now — use the email code for now.");
  }
  return res.json || {};
}

module.exports = {
  issueChallenge,
  consumeChallenge,
  sidecarCheck,
  origin,
  rpId,
  pbTime,
};
