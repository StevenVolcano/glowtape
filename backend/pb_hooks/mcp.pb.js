/// <reference path="../pb_data/types.d.ts" />
//
// Claude connector: a private MCP endpoint per user, plus the route that makes
// the link. Tools live in mcp_lib.js. The link IS the credential (claude.ai's
// "add custom connector" takes a URL), so only its SHA-256 is stored and it's
// shown once; deleting the mcp_tokens row (Operator console) revokes it.
// Operator-only for now — Steven's own director tooling, not a cast feature.
//
// NOTE: handlers run in isolated VMs — helpers are require()d INSIDE each.

routerAdd(
  "POST",
  "/api/glowtape/mcp-tokens",
  (e) => {
    if (!e.auth.get("operator")) {
      throw new ForbiddenError("The Claude connector is operator-only for now.");
    }
    const body = e.requestInfo().body || {};
    const label = String(body.label || "Claude").slice(0, 100);
    const token = $security.randomStringWithAlphabet(
      48,
      "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    );
    const rec = new Record(e.app.findCollectionByNameOrId("mcp_tokens"));
    rec.set("user", e.auth.id);
    rec.set("tokenHash", $security.sha256(token));
    rec.set("label", label);
    e.app.save(rec);
    // Behind Caddy the Host is glowtape.net and the scheme is https; only a
    // local dev server is plain http. (PB's appURL defaults to localhost.)
    const host = e.request.host;
    const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https";
    return e.json(200, { id: rec.id, url: `${scheme}://${host}/api/glowtape/mcp/${token}` });
  },
  $apis.requireAuth(),
);

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

// Streamable HTTP clients may try to open a server-to-client stream or end a
// session; this server is stateless and request/response only.
routerAdd("GET", "/api/glowtape/mcp/{token}", (e) => e.json(405, { message: "POST only" }));
routerAdd("DELETE", "/api/glowtape/mcp/{token}", (e) => e.noContent(204));
