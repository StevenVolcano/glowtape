/// <reference path="../pb_data/types.d.ts" />
//
// Seed a "What's New in Glow Tape" community channel — where new features
// get announced (and anyone can ask about them).

migrate(
  (app) => {
    const channels = app.findCollectionByNameOrId("channels");
    const c = new Record(channels);
    c.set("name", "📣 What's New in Glow Tape");
    c.set("audience", "all");
    c.set("defaultMuted", false);
    app.save(c);
  },
  (app) => {
    try {
      const c = app.findFirstRecordByFilter(
        "channels",
        "production = '' && name = {:n}",
        { n: "📣 What's New in Glow Tape" },
      );
      app.delete(c);
    } catch {
      /* already gone */
    }
  },
);
