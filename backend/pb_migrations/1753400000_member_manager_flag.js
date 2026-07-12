/// <reference path="../pb_data/types.d.ts" />
//
// Explicit per-member Manage access. `manager` is the source of truth for
// productions.managers (recomputed server-side by the members hooks); the
// UI auto-checks it when a member's role is director/AD/SM and lets it be
// toggled freely for anyone else (choreographer, producer, ...).
// Backfills the flag from current roles.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.add(new Field({ name: "manager", type: "bool" }));
    app.save(members);

    const rows = app.findRecordsByFilter(
      "members",
      "role = 'director' || role = 'asst_director' || role = 'stage_manager'",
      "",
      500,
      0,
      {},
    );
    for (const r of rows) {
      r.set("manager", true);
      app.save(r);
    }
  },
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.removeByName("manager");
    app.save(members);
  },
);
