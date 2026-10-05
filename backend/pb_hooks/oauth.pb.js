/// <reference path="../pb_data/types.d.ts" />
//
// OAuth for the Claude connector: discovery documents, client registration,
// the consent step behind /connect, and the token endpoint. The flow and
// helpers are described in oauth_lib.js. Operator-only for now, like the
// connector itself.
//
// NOTE: handlers run in isolated VMs — helpers are require()d INSIDE each.

// RFC 9728: where claude.ai learns which server signs people in. Served at the
// root and at the path-suffixed form the MCP spec prefers.
routerAdd("GET", "/.well-known/oauth-protected-resource", (e) => {
  const o = require(`${__hooks}/oauth_lib.js`);
  return e.json(200, {
    resource: o.resourceUrl(e),
    authorization_servers: [o.baseUrl(e)],
    bearer_methods_supported: ["header"],
    resource_name: "Glow Tape",
  });
});
routerAdd("GET", "/.well-known/oauth-protected-resource/{rest...}", (e) => {
  const o = require(`${__hooks}/oauth_lib.js`);
  return e.json(200, {
    resource: o.resourceUrl(e),
    authorization_servers: [o.baseUrl(e)],
    bearer_methods_supported: ["header"],
    resource_name: "Glow Tape",
  });
});

// RFC 8414 authorization server metadata.
routerAdd("GET", "/.well-known/oauth-authorization-server", (e) => {
  const o = require(`${__hooks}/oauth_lib.js`);
  const base = o.baseUrl(e);
  return e.json(200, {
    issuer: base,
    authorization_endpoint: base + "/connect",
    token_endpoint: base + "/api/glowtape/oauth/token",
    registration_endpoint: base + "/api/glowtape/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["glowtape"],
  });
});

// RFC 7591 dynamic client registration. Public clients only (PKCE, no
// secret); redirect URIs must be Claude's callback hosts or loopback.
routerAdd("POST", "/api/glowtape/oauth/register", (e) => {
  const o = require(`${__hooks}/oauth_lib.js`);
  const body = e.requestInfo().body || {};
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(o.redirectAllowed)) {
    return e.json(400, {
      error: "invalid_redirect_uri",
      error_description: "Redirect URIs must be Claude's own callback (https) or a loopback address.",
    });
  }
  if (e.app.countRecords("oauth_clients") >= o.MAX_CLIENTS) {
    return e.json(400, { error: "invalid_client_metadata", error_description: "Too many registered apps." });
  }
  const name = String(body.client_name || "Claude").slice(0, 100);
  const client = new Record(e.app.findCollectionByNameOrId("oauth_clients"));
  const clientId = o.randomToken();
  client.set("clientId", clientId);
  client.set("name", name);
  client.set("redirectUris", uris);
  e.app.save(client);
  return e.json(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

// What the /connect page shows: the app's name, after checking the request
// is one we'd honour. Errors here are shown on the page, never redirected.
routerAdd(
  "GET",
  "/api/glowtape/oauth/client",
  (e) => {
    const o = require(`${__hooks}/oauth_lib.js`);
    const query = e.request.url.query();
    const client = o.findClient(e.app, query.get("client_id"));
    const redirect = query.get("redirect_uri");
    if (!client || !o.clientRedirects(client).includes(redirect) || !o.redirectAllowed(redirect)) {
      throw new BadRequestError("This connection request isn't valid. Start again from Claude.");
    }
    return e.json(200, { name: client.get("name") || "Claude", operatorOnly: !e.auth.get("operator") });
  },
  $apis.requireAuth("users"),
);

// The person tapped Allow (or Don't allow) on /connect. Returns where the
// browser goes next: back to Claude with a one-time code, or with an error.
routerAdd(
  "POST",
  "/api/glowtape/oauth/approve",
  (e) => {
    const o = require(`${__hooks}/oauth_lib.js`);
    const body = e.requestInfo().body || {};
    const client = o.findClient(e.app, body.client_id);
    const redirect = String(body.redirect_uri || "");
    if (!client || !o.clientRedirects(client).includes(redirect) || !o.redirectAllowed(redirect)) {
      throw new BadRequestError("This connection request isn't valid. Start again from Claude.");
    }
    const back = (params) => {
      const parts = [];
      for (const k of Object.keys(params)) {
        if (params[k]) parts.push(`${k}=${encodeURIComponent(params[k])}`);
      }
      return redirect + (redirect.includes("?") ? "&" : "?") + parts.join("&");
    };
    const state = String(body.state || "");
    const iss = o.baseUrl(e);
    if (body.deny) {
      return e.json(200, { redirect: back({ error: "access_denied", state, iss }) });
    }
    if (!e.auth.get("operator")) {
      throw new ForbiddenError("The Claude connector is operator-only for now.");
    }
    if (String(body.response_type || "") !== "code") {
      return e.json(200, { redirect: back({ error: "unsupported_response_type", state, iss }) });
    }
    const challenge = String(body.code_challenge || "");
    if (String(body.code_challenge_method || "") !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(challenge)) {
      return e.json(200, {
        redirect: back({ error: "invalid_request", error_description: "PKCE S256 is required.", state, iss }),
      });
    }
    const code = o.randomToken();
    const row = new Record(e.app.findCollectionByNameOrId("oauth_codes"));
    row.set("codeHash", o.hash(code));
    row.set("client", client.id);
    row.set("user", e.auth.id);
    row.set("redirectUri", redirect);
    row.set("challenge", challenge);
    row.set("expires", o.pbTime(o.CODE_SECONDS));
    e.app.save(row);
    return e.json(200, { redirect: back({ code, state, iss }) });
  },
  $apis.requireAuth("users"),
);

// Token endpoint (form-encoded, per OAuth). Trades a code + PKCE verifier,
// or a refresh token, for fresh tokens. Refresh tokens rotate on every use.
routerAdd("POST", "/api/glowtape/oauth/token", (e) => {
  const o = require(`${__hooks}/oauth_lib.js`);
  e.response.header().set("Cache-Control", "no-store");
  const body = e.requestInfo().body || {};
  const field = (k) => {
    const v = body[k];
    return String((Array.isArray(v) ? v[0] : v) || "");
  };
  const fail = (error, description) => e.json(400, { error, error_description: description });
  const client = o.findClient(e.app, field("client_id"));
  if (!client) return fail("invalid_client", "Unknown client.");

  if (field("grant_type") === "authorization_code") {
    let row;
    try {
      row = e.app.findFirstRecordByFilter("oauth_codes", "codeHash = {:h}", { h: o.hash(field("code")) });
    } catch {
      return fail("invalid_grant", "Unknown or used code.");
    }
    // One use, whatever happens next.
    e.app.delete(row);
    if (String(row.get("expires")) < o.pbTime(0)) return fail("invalid_grant", "The code expired.");
    if (row.get("client") !== client.id) return fail("invalid_grant", "Code was issued to another app.");
    if (row.get("redirectUri") !== field("redirect_uri")) return fail("invalid_grant", "Redirect URI doesn't match.");
    if (!o.pkceMatches(field("code_verifier"), row.get("challenge"))) {
      return fail("invalid_grant", "PKCE verifier doesn't match.");
    }
    const grant = new Record(e.app.findCollectionByNameOrId("oauth_grants"));
    grant.set("user", row.get("user"));
    grant.set("client", client.id);
    grant.set("label", client.get("name") || "Claude");
    return e.json(200, o.issueTokens(e.app, grant));
  }

  if (field("grant_type") === "refresh_token") {
    let grant;
    try {
      grant = e.app.findFirstRecordByFilter("oauth_grants", "refreshHash = {:h} && refreshExpires > {:now}", {
        h: o.hash(field("refresh_token")),
        now: o.pbTime(0),
      });
    } catch {
      return fail("invalid_grant", "Unknown, used or expired refresh token.");
    }
    if (grant.get("client") !== client.id) return fail("invalid_grant", "Token was issued to another app.");
    return e.json(200, o.issueTokens(e.app, grant));
  }

  return fail("unsupported_grant_type", "Use authorization_code or refresh_token.");
});

// Housekeeping: drop expired codes, grants nobody refreshed in time, and
// apps that registered a week ago but were never allowed (so open
// registration can't fill MAX_CLIENTS for good).
cronAdd("glowtape_oauth_cleanup", "17 4 * * *", () => {
  require(`${__hooks}/oauth_lib.js`).cleanup($app);
});
