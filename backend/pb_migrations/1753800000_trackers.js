/// <reference path="../pb_data/types.d.ts" />
//
// Phase 2 trackers — the multi-tab Google Sheet, structured. One generic
// collection; the app maps columns per tracker type (props, costumes, set,
// light cues, sound cues). Cue paperwork only: QLab owns execution.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");

    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    const managerWrite = "production.managers.id ?= @request.auth.id";

    const items = new Collection({
      type: "base",
      name: "tracker_items",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        {
          type: "select",
          name: "tracker",
          values: ["props", "costumes", "set", "light_cues", "sound_cues"],
          required: true,
          maxSelect: 1,
        },
        { type: "text", name: "name", max: 200 },
        { type: "text", name: "a", max: 200 },
        { type: "text", name: "b", max: 200 },
        { type: "text", name: "c", max: 200 },
        { type: "text", name: "status", max: 60 },
        { type: "text", name: "notes", max: 400 },
        // numeric sort key (auto-derived from a numeric name, e.g. cue 12.5)
        { type: "number", name: "order" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: memberRead,
      viewRule: memberRead,
      createRule: managerWrite,
      updateRule: managerWrite,
      deleteRule: managerWrite,
    });
    app.save(items);
  },
  (app) => {
    const items = app.findCollectionByNameOrId("tracker_items");
    if (items) app.delete(items);
  },
);
