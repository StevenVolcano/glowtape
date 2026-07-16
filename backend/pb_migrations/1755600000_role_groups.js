/// <reference path="../pb_data/types.d.ts" />
//
// Role groups: named sets of roles ("Group A", "Leads", "Dancers") a director
// defines per production. A role can belong to several groups. Groups can be
// attached to breakdown units and picked when scheduling — selecting a group
// calls everyone whose role is in it (resolved to member ids at save time,
// same pattern as units).

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const members = app.findCollectionByNameOrId("members");
    const events = app.findCollectionByNameOrId("events");
    const units = app.findCollectionByNameOrId("units");

    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    const managerWrite = "production.managers.id ?= @request.auth.id";

    const groups = new Collection({
      type: "base",
      name: "groups",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 80 },
        { type: "number", name: "order" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_groups_prod_name ON groups (production, name)"],
      listRule: memberRead,
      viewRule: memberRead,
      createRule: managerWrite,
      updateRule: managerWrite,
      deleteRule: managerWrite,
    });
    app.save(groups);

    const saved = app.findCollectionByNameOrId("groups");
    members.fields.add(
      new Field({ type: "relation", name: "groups", collectionId: saved.id, maxSelect: 50, cascadeDelete: false }),
    );
    app.save(members);
    units.fields.add(
      new Field({ type: "relation", name: "groups", collectionId: saved.id, maxSelect: 50, cascadeDelete: false }),
    );
    app.save(units);
    events.fields.add(
      new Field({ type: "relation", name: "calledGroups", collectionId: saved.id, maxSelect: 50, cascadeDelete: false }),
    );
    app.save(events);
  },
  (app) => {
    for (const [col, field] of [["members", "groups"], ["units", "groups"], ["events", "calledGroups"]]) {
      const c = app.findCollectionByNameOrId(col);
      c.fields.removeByName(field);
      app.save(c);
    }
    app.delete(app.findCollectionByNameOrId("groups"));
  },
);
