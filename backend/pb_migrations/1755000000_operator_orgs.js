/// <reference path="../pb_data/types.d.ts" />
//
// Let the operator add and rename organizations from the operator console
// instead of the PocketBase dashboard. Delete stays superuser-only — an org
// with productions hanging off it shouldn't vanish from a web form.

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("orgs");
    orgs.createRule = "@request.auth.operator = true";
    orgs.updateRule = "@request.auth.operator = true";
    app.save(orgs);
  },
  (app) => {
    const orgs = app.findCollectionByNameOrId("orgs");
    orgs.createRule = null;
    orgs.updateRule = null;
    app.save(orgs);
  },
);
