/// <reference path="../pb_data/types.d.ts" />
//
// Archive a show. An archived production is a finished record: it drops off
// the main productions list into "Past shows" and becomes read-only, so a
// wrapped show can't be edited by accident. Managers flip it back anytime.
// Enforcement lives in pb_hooks/archive.pb.js (request guard) + the event
// routes; this migration just adds the flag.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.add(new Field({ name: "archived", type: "bool" }));
    app.save(productions);
  },
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("archived");
    app.save(productions);
  },
);
