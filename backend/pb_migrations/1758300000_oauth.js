/// <reference path="../pb_data/types.d.ts" />
//
// OAuth for the Claude connector (pb_hooks/oauth.pb.js). Replaces the
// link-is-the-password connector URLs: claude.ai registers itself, the person
// approves it on /connect while signed in, and Claude gets short-lived tokens.
// Only SHA-256 hashes of codes and tokens are stored.
//
// oauth_clients: apps that registered (dynamic client registration).
// oauth_codes:   one-time sign-in codes, five minutes, deleted when used.
// oauth_grants:  one row per connected app per person; deleting it turns
//                that app off. The owner can list and delete their own.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const clients = new Collection({
      type: "base",
      name: "oauth_clients",
      fields: [
        { type: "text", name: "clientId", required: true, max: 64 },
        { type: "text", name: "name", max: 100 },
        { type: "json", name: "redirectUris", maxSize: 4000 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_oauth_clients_id ON oauth_clients (clientId)"],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(clients);

    const codes = new Collection({
      type: "base",
      name: "oauth_codes",
      fields: [
        { type: "text", name: "codeHash", required: true, max: 128 },
        { type: "relation", name: "client", collectionId: clients.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "redirectUri", required: true, max: 2000 },
        { type: "text", name: "challenge", required: true, max: 128 },
        { type: "date", name: "expires", required: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_oauth_codes_hash ON oauth_codes (codeHash)"],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(codes);

    const own = "user = @request.auth.id";
    const grants = new Collection({
      type: "base",
      name: "oauth_grants",
      fields: [
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "client", collectionId: clients.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "label", max: 100 },
        { type: "text", name: "accessHash", required: true, max: 128, hidden: true },
        { type: "date", name: "accessExpires", required: true, hidden: true },
        { type: "text", name: "refreshHash", required: true, max: 128, hidden: true },
        { type: "date", name: "refreshExpires", required: true },
        { type: "date", name: "lastUsed" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_oauth_grants_access ON oauth_grants (accessHash)",
        "CREATE UNIQUE INDEX idx_oauth_grants_refresh ON oauth_grants (refreshHash)",
      ],
      listRule: own,
      viewRule: own,
      createRule: null,
      updateRule: null,
      deleteRule: own,
    });
    app.save(grants);
  },
  (app) => {
    for (const name of ["oauth_grants", "oauth_codes", "oauth_clients"]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
