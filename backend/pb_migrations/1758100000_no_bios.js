/// <reference path="../pb_data/types.d.ts" />
//
// Not every show prints bios. productions.noBios = true switches the whole
// bio workflow off for that show: no "write your bio" nudges, no bio editor
// on To-Do, no bio requests, no bios section in the program packet.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.add(new Field({ name: "noBios", type: "bool" }));
    app.save(productions);
  },
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("noBios");
    app.save(productions);
  },
);
