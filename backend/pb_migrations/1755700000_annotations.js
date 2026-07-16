/// <reference path="../pb_data/types.d.ts" />
//
// Script-room annotations: pin-style notes anchored to a spot on a page of a
// PDF resource (script, libretto, score). Two scopes: 'production' notes the
// staff adds for everyone, and 'personal' notes only their author sees.
// Notes carry a done flag so script/music fixes can be marked off.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const resources = app.findCollectionByNameOrId("resources");
    const users = app.findCollectionByNameOrId("users");

    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";

    const annotations = new Collection({
      type: "base",
      name: "annotations",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "resource", collectionId: resources.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "number", name: "page", required: true },
        { type: "number", name: "x" }, // fraction of page width, 0..1
        { type: "number", name: "y" }, // fraction of page height, 0..1
        { type: "text", name: "text", required: true, max: 1000 },
        { type: "select", name: "scope", values: ["production", "personal"], required: true, maxSelect: 1 },
        { type: "bool", name: "done" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule:
        "(scope = 'personal' && user = @request.auth.id) || (scope = 'production' && (" + memberRead + "))",
      viewRule:
        "(scope = 'personal' && user = @request.auth.id) || (scope = 'production' && (" + memberRead + "))",
      // Anyone in the production writes personal notes; only managers write
      // production-wide ones.
      createRule:
        "user = @request.auth.id && (" + memberRead + ") && (scope = 'personal' || production.managers.id ?= @request.auth.id)",
      // Authors manage their own; managers can edit/mark-off production notes.
      updateRule:
        "user = @request.auth.id || (scope = 'production' && production.managers.id ?= @request.auth.id)",
      deleteRule:
        "user = @request.auth.id || (scope = 'production' && production.managers.id ?= @request.auth.id)",
    });
    app.save(annotations);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("annotations"));
  },
);
