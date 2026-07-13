/// <reference path="../pb_data/types.d.ts" />
//
// Web push: one row per (user, browser) subscription. Created/removed by the
// app when someone toggles notifications on a device; dead endpoints are
// pruned automatically when the push service reports them gone.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    const subs = new Collection({
      type: "base",
      name: "push_subscriptions",
      fields: [
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "endpoint", required: true, max: 1000 },
        { type: "text", name: "p256dh", required: true, max: 200 },
        { type: "text", name: "auth", required: true, max: 100 },
        { type: "text", name: "ua", max: 200 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_push_endpoint ON push_subscriptions (endpoint)"],
      listRule: "user = @request.auth.id",
      viewRule: "user = @request.auth.id",
      createRule: "@request.auth.id != '' && user = @request.auth.id",
      updateRule: "user = @request.auth.id",
      deleteRule: "user = @request.auth.id",
    });
    app.save(subs);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("push_subscriptions"));
  },
);
