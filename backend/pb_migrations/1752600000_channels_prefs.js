/// <reference path="../pb_data/types.d.ts" />
//
// Channel management + per-user notification muting.
//
// - channels gain `archived` (hidden but preserved — no destructive deletes
//   of message history) and `defaultMuted` (Off Topic starts muted for
//   everyone; a personal pref overrides).
// - channel_prefs stores each user's per-channel override. Effective mute =
//   pref exists ? pref.muted : channel.defaultMuted. Today this is a stored
//   preference + UI state; message notifications (push/digest) must respect
//   it when they arrive.

migrate(
  (app) => {
    const channels = app.findCollectionByNameOrId("channels");
    channels.fields.add(new Field({ name: "archived", type: "bool" }));
    channels.fields.add(new Field({ name: "defaultMuted", type: "bool" }));
    app.save(channels);

    const users = app.findCollectionByNameOrId("users");

    const prefs = new Collection({
      type: "base",
      name: "channel_prefs",
      fields: [
        { type: "relation", name: "channel", collectionId: channels.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "bool", name: "muted" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_channel_prefs_unique ON channel_prefs (channel, user)"],
      listRule: "user = @request.auth.id",
      viewRule: "user = @request.auth.id",
      createRule:
        "user = @request.auth.id && channel.production.members_via_production.user ?= @request.auth.id",
      updateRule: "user = @request.auth.id",
      deleteRule: "user = @request.auth.id",
    });
    app.save(prefs);
  },
  (app) => {
    const prefs = app.findCollectionByNameOrId("channel_prefs");
    if (prefs) app.delete(prefs);
    const channels = app.findCollectionByNameOrId("channels");
    channels.fields.removeByName("archived");
    channels.fields.removeByName("defaultMuted");
    app.save(channels);
  },
);
