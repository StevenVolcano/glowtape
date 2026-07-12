/// <reference path="../pb_data/types.d.ts" />
//
// Org-level preset locations. Productions inherit their company's usual
// places (Driftwood's differ from Bishop Center's) and can add their own.
// Entries are {name, address} objects; older production.locations string
// entries remain valid (the app normalizes both shapes).

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("orgs");
    orgs.fields.add(new Field({ name: "locations", type: "json", maxSize: 10000 }));
    app.save(orgs);
  },
  (app) => {
    const orgs = app.findCollectionByNameOrId("orgs");
    orgs.fields.removeByName("locations");
    app.save(orgs);
  },
);
