/// <reference path="../pb_data/types.d.ts" />
//
// Photos in messages + emoji reactions.
//
// - messages gain an optional image (single, 10MB cap, common web formats;
//   PocketBase generates a 400px-wide thumb for the thread view) and text
//   becomes optional so an image can stand alone.
// - reactions: one row per (message, user, emoji); toggled by create/delete.

migrate(
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    messages.fields.add(
      new Field({
        name: "image",
        type: "file",
        maxSelect: 1,
        maxSize: 10485760,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        thumbs: ["400x0"],
      }),
    );
    const text = messages.fields.getByName("text");
    text.required = false;
    app.save(messages);

    const users = app.findCollectionByNameOrId("users");

    const memberRead =
      "message.channel.production.managers.id ?= @request.auth.id || message.channel.production.members_via_production.user ?= @request.auth.id";

    const reactions = new Collection({
      type: "base",
      name: "reactions",
      fields: [
        { type: "relation", name: "message", collectionId: messages.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "emoji", required: true, max: 8 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_reactions_unique ON reactions (message, user, emoji)"],
      listRule: memberRead,
      viewRule: memberRead,
      createRule:
        "user = @request.auth.id && message.channel.production.members_via_production.user ?= @request.auth.id",
      updateRule: null,
      deleteRule: "user = @request.auth.id",
    });
    app.save(reactions);
  },
  (app) => {
    const reactions = app.findCollectionByNameOrId("reactions");
    if (reactions) app.delete(reactions);
    const messages = app.findCollectionByNameOrId("messages");
    messages.fields.removeByName("image");
    const text = messages.fields.getByName("text");
    text.required = true;
    app.save(messages);
  },
);
