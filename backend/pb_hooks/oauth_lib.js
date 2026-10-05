// OAuth 2.1 for the Claude connector — helpers for pb_hooks/oauth.pb.js and
// the bearer-token MCP route in mcp.pb.js. require() this INSIDE handlers
// (VM rule, gotcha #1).
//
// The flow claude.ai follows (MCP authorization spec):
//   1. POST /api/glowtape/mcp with no token → 401 + WWW-Authenticate pointing
//      at /.well-known/oauth-protected-resource.
//   2. Reads that, then /.well-known/oauth-authorization-server.
//   3. Registers itself at /api/glowtape/oauth/register (public client, PKCE).
//   4. Sends the person to /connect (the app's consent page). Signed in, they
//      tap Allow → /api/glowtape/oauth/approve makes a five-minute code.
//   5. Trades the code + PKCE verifier at /api/glowtape/oauth/token for a
//      one-hour access token and a refresh token (rotated on every use).
// Only SHA-256 hashes are stored. Deleting an oauth_grants row turns it off.

const ACCESS_SECONDS = 60 * 60;
const REFRESH_SECONDS = 60 * 24 * 60 * 60;
const CODE_SECONDS = 5 * 60;
const MAX_CLIENTS = 500;
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// The public origin, e.g. https://glowtape.net. Behind Caddy the Host is
// glowtape.net; only a local dev server is plain http.
function baseUrl(e) {
  const env = $os.getenv("GLOWTAPE_PUBLIC_URL");
  if (env) return env.replace(/\/+$/, "");
  const host = e.request.host;
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https";
  return `${scheme}://${host}`;
}

function resourceUrl(e) {
  return baseUrl(e) + "/api/glowtape/mcp";
}

function metadataUrl(e) {
  return baseUrl(e) + "/.well-known/oauth-protected-resource/api/glowtape/mcp";
}

function randomToken() {
  return $security.randomStringWithAlphabet(48, ALPHABET);
}

function hash(s) {
  return $security.sha256(String(s));
}

// PB datetime string, seconds from now.
function pbTime(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString().replace("T", " ");
}

// base64url (no padding) of the bytes a hex string spells out.
function hexToBase64Url(hex) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += chars[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += chars[n & 63];
  }
  return out;
}

// PKCE S256: challenge = base64url(sha256(verifier)).
function pkceMatches(verifier, challenge) {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(String(verifier || ""))) return false;
  return hexToBase64Url($security.sha256(verifier)) === challenge;
}

// Where an app may send the person back to: Claude's own callback hosts over
// https, or a loopback address (desktop and command-line clients).
function redirectAllowed(uri) {
  const m = /^(https?):\/\/([^/:?#]+)(:\d+)?(\/[^#]*)?$/.exec(String(uri || ""));
  if (!m) return false;
  const host = m[2].toLowerCase();
  if (m[1] === "http") return host === "localhost" || host === "127.0.0.1";
  const hosts = ($os.getenv("GLOWTAPE_OAUTH_REDIRECT_HOSTS") || "claude.ai,claude.com")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(host);
}

function findClient(app, clientId) {
  if (!clientId) return null;
  try {
    return app.findFirstRecordByFilter("oauth_clients", "clientId = {:c}", { c: String(clientId) });
  } catch {
    return null;
  }
}

function clientRedirects(client) {
  try {
    const v = JSON.parse(String(client.get("redirectUris")));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// The user behind a bearer access token, or null.
function userForAccessToken(app, token) {
  if (!token || token.length < 30) return null;
  let grant;
  try {
    grant = app.findFirstRecordByFilter("oauth_grants", "accessHash = {:h} && accessExpires > {:now}", {
      h: hash(token),
      now: pbTime(0),
    });
  } catch {
    return null;
  }
  try {
    grant.set("lastUsed", pbTime(0));
    app.save(grant);
  } catch {
    /* bookkeeping only */
  }
  try {
    return app.findRecordById("users", grant.get("user"));
  } catch {
    return null;
  }
}

// Fresh access + refresh tokens on a grant (new or existing). Returns the
// token response body.
function issueTokens(app, grant) {
  const access = randomToken();
  const refresh = randomToken();
  grant.set("accessHash", hash(access));
  grant.set("accessExpires", pbTime(ACCESS_SECONDS));
  grant.set("refreshHash", hash(refresh));
  grant.set("refreshExpires", pbTime(REFRESH_SECONDS));
  app.save(grant);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_SECONDS,
    refresh_token: refresh,
    scope: "glowtape",
  };
}

function cleanup(app) {
  const now = pbTime(0);
  for (const [name, filter] of [
    ["oauth_codes", "expires < {:now}"],
    ["oauth_grants", "refreshExpires < {:now}"],
  ]) {
    try {
      for (const r of app.findRecordsByFilter(name, filter, "", 500, 0, { now })) app.delete(r);
    } catch (err) {
      console.log(`oauth cleanup ${name}: ${err}`);
    }
  }
  try {
    const old = app.findRecordsByFilter("oauth_clients", "created < {:old}", "", 500, 0, { old: pbTime(-7 * 24 * 60 * 60) });
    for (const c of old) {
      if (app.countRecords("oauth_grants", $dbx.hashExp({ client: c.id })) === 0) app.delete(c);
    }
  } catch (err) {
    console.log(`oauth cleanup oauth_clients: ${err}`);
  }
}

module.exports = {
  cleanup,
  CODE_SECONDS,
  MAX_CLIENTS,
  baseUrl,
  resourceUrl,
  metadataUrl,
  randomToken,
  hash,
  pbTime,
  hexToBase64Url,
  pkceMatches,
  redirectAllowed,
  findClient,
  clientRedirects,
  userForAccessToken,
  issueTokens,
};
