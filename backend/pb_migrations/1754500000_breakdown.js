/// <reference path="../pb_data/types.d.ts" />
//
// Show breakdown: the show split into units — songs for a musical, scenes,
// or page ranges/hunks for a straight play (productions.breakdownStyle picks
// which). Each unit knows who's involved via member rows (so it works before
// casting, against character roles), split into on-stage / singing / dancing
// for musicals. Events can reference units, and the app fills "who's called"
// from them — the breakdown drives scheduling.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const members = app.findCollectionByNameOrId("members");
    const events = app.findCollectionByNameOrId("events");

    productions.fields.add(
      new Field({ name: "breakdownStyle", type: "select", values: ["songs", "scenes", "pages"], maxSelect: 1 }),
    );
    app.save(productions);

    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    const managerWrite = "production.managers.id ?= @request.auth.id";

    const units = new Collection({
      type: "base",
      name: "units",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 200 },
        { type: "text", name: "act", max: 60 },
        { type: "text", name: "pages", max: 60 },
        { type: "number", name: "order" },
        { type: "relation", name: "onstage", collectionId: members.id, maxSelect: 300, cascadeDelete: false },
        { type: "relation", name: "singing", collectionId: members.id, maxSelect: 300, cascadeDelete: false },
        { type: "relation", name: "dancing", collectionId: members.id, maxSelect: 300, cascadeDelete: false },
        { type: "text", name: "notes", max: 400 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: memberRead,
      viewRule: memberRead,
      createRule: managerWrite,
      updateRule: managerWrite,
      deleteRule: managerWrite,
    });
    app.save(units);

    events.fields.add(
      new Field({ name: "units", type: "relation", collectionId: units.id, maxSelect: 100, cascadeDelete: false }),
    );
    app.save(events);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("units");
    app.save(events);
    app.delete(app.findCollectionByNameOrId("units"));
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("breakdownStyle");
    app.save(productions);
  },
);
