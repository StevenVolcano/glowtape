/// <reference path="../pb_data/types.d.ts" />
//
// Line notes: the stage manager's classic paperwork, pinned to the script.
// During a run the SM taps the spot in the script room, picks the actor and
// what happened (dropped / paraphrased / skipped / jumped a cue / called for
// line); the actor gets it delivered and checks it off once it's solid.
// Visibility: production team + that actor (+ their guardians) — line notes
// are coaching, not a public scoreboard.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const resources = app.findCollectionByNameOrId("resources");
    const members = app.findCollectionByNameOrId("members");
    const users = app.findCollectionByNameOrId("users");

    const managerWrite = "production.managers.id ?= @request.auth.id";
    const canSee =
      managerWrite + " || member.user = @request.auth.id || member.guardians.id ?= @request.auth.id";

    const lineNotes = new Collection({
      type: "base",
      name: "line_notes",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "resource", collectionId: resources.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "member", collectionId: members.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "author", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "number", name: "page", required: true },
        { type: "number", name: "x" },
        { type: "number", name: "y" },
        { type: "select", name: "kind", values: ["dropped", "paraphrased", "skipped", "jumped", "called"], required: true, maxSelect: 1 },
        { type: "text", name: "text", max: 500 },
        { type: "bool", name: "done" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: canSee,
      viewRule: canSee,
      createRule: "author = @request.auth.id && " + managerWrite,
      // the actor (or guardian) marks it done; the team can edit or fix
      updateRule: canSee,
      deleteRule: managerWrite,
    });
    app.save(lineNotes);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("line_notes"));
  },
);
