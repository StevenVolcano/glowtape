/// <reference path="../pb_data/types.d.ts" />
//
// Quotes for the Tonight page: director-entered lines (favorites from the
// show, things they say in the room) that mix into the built-in
// public-domain rotation. Human-curated on purpose — no AI in Glow Tape.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.add(new Field({ type: "json", name: "quotes", maxSize: 10000 }));
    app.save(productions);
  },
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("quotes");
    app.save(productions);
  },
);
