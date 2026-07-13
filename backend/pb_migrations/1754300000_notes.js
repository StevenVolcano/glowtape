/// <reference path="../pb_data/types.d.ts" />
//
// Notes: lightweight production note-taking (rehearsal notes, mainly). Every
// note has a stable URL so it can be pasted into a channel — the chat
// linkifies it. Any member can write one; authors and managers can edit.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const productions = app.findCollectionByNameOrId("productions");

    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";

    const notes = new Collection({
      type: "base",
      name: "notes",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "author", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "title", required: true, max: 200 },
        { type: "text", name: "body", max: 20000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: memberRead,
      viewRule: memberRead,
      createRule:
        "author = @request.auth.id && (production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id)",
      updateRule: "author = @request.auth.id || production.managers.id ?= @request.auth.id",
      deleteRule: "author = @request.auth.id || production.managers.id ?= @request.auth.id",
    });
    app.save(notes);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("notes"));
  },
);
