/// <reference path="../pb_data/types.d.ts" />
//
// Text the whole cast: managers send one message that goes out as a text to
// everyone who said yes to cast texts, and as a private Glow Tape message
// (their 🔒 "& managers" channel) to everyone else.
//
// - users.smsCastTexts: a SEPARATE yes from reminder texts. The reminder
//   opt-in (and the toll-free registration behind it) promises "up to 2
//   rehearsal-reminder texts per rehearsal day", so manager messages need
//   their own consent. Hidden like the other phone fields (1755500000); read
//   and set through /api/glowtape/phone/status and /phone/cast-texts.
// - text_blasts: one row per send, for the history list and the daily cap.
//   Written only by the /api/glowtape/cast-text route; managers can read.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new Field({ name: "smsCastTexts", type: "bool", hidden: true }));
    app.save(users);

    const productions = app.findCollectionByNameOrId("productions");
    const managerOnly = "production.managers.id ?= @request.auth.id || @request.auth.operator = true";

    const blasts = new Collection({
      type: "base",
      name: "text_blasts",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "author", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: false },
        { type: "text", name: "text", required: true, max: 1000 },
        { type: "select", name: "audience", values: ["cast", "everyone"], maxSelect: 1 },
        { type: "number", name: "texted" },
        { type: "number", name: "inApp" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE INDEX idx_text_blasts_production ON text_blasts (production, created)"],
      listRule: managerOnly,
      viewRule: managerOnly,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(blasts);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("text_blasts"));
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("smsCastTexts");
    app.save(users);
  },
);
