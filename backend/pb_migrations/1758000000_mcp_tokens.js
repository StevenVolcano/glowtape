/// <reference path="../pb_data/types.d.ts" />
//
// Claude connector links (MCP). Each row is one private connector URL for one
// user: only the SHA-256 of the secret is stored, the plain link is shown once
// when it's made (pb_hooks/mcp.pb.js). Deleting the row revokes the link.
// Rows are created by the route only; the owner can list and delete theirs.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const own = "user = @request.auth.id";
    const tokens = new Collection({
      type: "base",
      name: "mcp_tokens",
      fields: [
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "tokenHash", required: true, max: 128, hidden: true },
        { type: "text", name: "label", max: 100 },
        { type: "date", name: "lastUsed" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_mcp_tokens_hash ON mcp_tokens (tokenHash)"],
      listRule: own,
      viewRule: own,
      createRule: null,
      updateRule: null,
      deleteRule: own,
    });
    app.save(tokens);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("mcp_tokens"));
  },
);
