/// <reference path="../pb_data/types.d.ts" />
//
// 1) access_codes: signup becomes invite-based. A new account needs EITHER a
//    production/role code OR one of these operator-issued community codes
//    (create them in the dashboard; set `expires` to rotate monthly or
//    quarterly — an expired or deactivated code simply stops working).
//    Superuser-only collection.
//
// 2) attendance: one row per (event, member). Managers write via the record
//    API (roll call); cast self-reports late/absent via a route that also
//    alerts the production team.

migrate(
  (app) => {
    const codes = new Collection({
      type: "base",
      name: "access_codes",
      fields: [
        { type: "text", name: "code", required: true, max: 40 },
        { type: "text", name: "note", max: 200 },
        { type: "date", name: "expires" },
        { type: "bool", name: "active" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_access_codes_code ON access_codes (code)"],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(codes);

    const events = app.findCollectionByNameOrId("events");
    const members = app.findCollectionByNameOrId("members");

    const memberRead =
      "event.production.managers.id ?= @request.auth.id || event.production.members_via_production.user ?= @request.auth.id";

    const attendance = new Collection({
      type: "base",
      name: "attendance",
      fields: [
        { type: "relation", name: "event", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "member", collectionId: members.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "select", name: "status", values: ["present", "late", "absent"], required: true, maxSelect: 1 },
        { type: "text", name: "note", max: 300 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_attendance_unique ON attendance (event, member)"],
      listRule: memberRead,
      viewRule: memberRead,
      createRule: "event.production.managers.id ?= @request.auth.id",
      updateRule: "event.production.managers.id ?= @request.auth.id",
      deleteRule: "event.production.managers.id ?= @request.auth.id",
    });
    app.save(attendance);
  },
  (app) => {
    for (const name of ["attendance", "access_codes"]) {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    }
  },
);
