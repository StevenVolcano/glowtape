/// <reference path="../pb_data/types.d.ts" />
//
// Two audition-form additions: per-role casting notes (what the director is
// looking for — gender, age, character description) and a show description,
// so auditioners know what the play and the parts are about.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.add(new Field({ name: "roleNotes", type: "text", max: 500 }));
    app.save(members);

    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.add(new Field({ name: "description", type: "text", max: 2000 }));
    app.save(productions);
  },
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.removeByName("roleNotes");
    app.save(members);
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("description");
    app.save(productions);
  },
);
