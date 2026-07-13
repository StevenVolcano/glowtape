/// <reference path="../pb_data/types.d.ts" />
//
// The author credit line: "by Thornton Wilder", "book by ..., music by ...".
// Shown under the show title on the audition form and paper form.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.add(new Field({ name: "writtenBy", type: "text", max: 200 }));
    app.save(productions);
  },
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("writtenBy");
    app.save(productions);
  },
);
