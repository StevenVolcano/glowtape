/// <reference path="../pb_data/types.d.ts" />
//
// Fingerprint / face sign-in (passkeys, WebAuthn).
//
// - passkeys: one row per device a person set up. Owners can list and remove
//   their own; rows are created/updated only by the passkey routes
//   (pb_hooks/passkeys.pb.js). The public key itself is hidden from the API.
// - passkey_challenges: one-use, 5-minute random challenges. Route-only.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const own = "user = @request.auth.id";

    const passkeys = new Collection({
      type: "base",
      name: "passkeys",
      fields: [
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "credentialId", required: true, max: 1400 },
        { type: "text", name: "publicKey", required: true, max: 4000, hidden: true },
        { type: "number", name: "alg", onlyInt: true },
        { type: "number", name: "signCount", onlyInt: true },
        { type: "text", name: "label", max: 80 },
        { type: "date", name: "lastUsed" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_passkeys_credential ON passkeys (credentialId)",
        "CREATE INDEX idx_passkeys_user ON passkeys (user)",
      ],
      listRule: own,
      viewRule: own,
      createRule: null,
      updateRule: null,
      deleteRule: own,
    });
    app.save(passkeys);

    const challenges = new Collection({
      type: "base",
      name: "passkey_challenges",
      fields: [
        { type: "text", name: "challenge", required: true, max: 100 },
        { type: "select", name: "purpose", values: ["register", "signin"], maxSelect: 1, required: true },
        { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "ip", max: 64 },
        { type: "date", name: "expires", required: true },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE INDEX idx_passkey_challenges_ip ON passkey_challenges (ip, created)"],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(challenges);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("passkey_challenges"));
    app.delete(app.findCollectionByNameOrId("passkeys"));
  },
);
