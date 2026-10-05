/// <reference path="../pb_data/types.d.ts" />
//
// Claude connector: a private MCP endpoint, operator-only for now — Steven's
// own director tooling, not a cast feature. Tools live in mcp_lib.js.
// claude.ai connects to POST /api/glowtape/mcp and signs in with OAuth
// (oauth.pb.js), sending a short-lived bearer token. The older
// /api/glowtape/mcp/{token} links (only their SHA-256 stored in mcp_tokens)
// still answer until each row is deleted.
//
// NOTE: handlers run in isolated VMs — helpers are require()d INSIDE each.

routerAdd("POST", "/api/glowtape/mcp/{token}", (e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  const mcp = require(`${__hooks}/mcp_lib.js`);
  const user = mcp.userForToken(e.app, e.request.pathValue("token"));
  if (!user) {
    return e.json(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unknown or revoked connector link." } });
  }
  let msg;
  try {
    msg = e.requestInfo().body;
  } catch {
    return e.json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const res = mcp.handle(e.app, user, msg, lib);
  if (res === null) return e.noContent(202);
  return e.json(200, res);
});

// The OAuth form (oauth.pb.js): claude.ai sends a bearer token in the
// Authorization header, so no secret ever appears in a URL or a request log.
// No token (or an expired one) → 401 pointing at the discovery document,
// which is how claude.ai knows to start (or refresh) the sign-in.
routerAdd("POST", "/api/glowtape/mcp", (e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  const mcp = require(`${__hooks}/mcp_lib.js`);
  const o = require(`${__hooks}/oauth_lib.js`);
  const m = /^Bearer\s+(\S+)$/i.exec(e.request.header.get("Authorization") || "");
  const user = m ? o.userForAccessToken(e.app, m[1]) : null;
  if (!user || !user.get("operator")) {
    e.response.header().set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${o.metadataUrl(e)}"` + (m ? ', error="invalid_token"' : ""),
    );
    return e.json(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in to Glow Tape." } });
  }
  let msg;
  try {
    msg = e.requestInfo().body;
  } catch {
    return e.json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const res = mcp.handle(e.app, user, msg, lib);
  if (res === null) return e.noContent(202);
  return e.json(200, res);
});

// Streamable HTTP clients may try to open a server-to-client stream or end a
// session; this server is stateless and request/response only.
routerAdd("GET", "/api/glowtape/mcp", (e) => e.json(405, { message: "POST only" }));
routerAdd("DELETE", "/api/glowtape/mcp", (e) => e.noContent(204));
routerAdd("GET", "/api/glowtape/mcp/{token}", (e) => e.json(405, { message: "POST only" }));
routerAdd("DELETE", "/api/glowtape/mcp/{token}", (e) => e.noContent(204));
