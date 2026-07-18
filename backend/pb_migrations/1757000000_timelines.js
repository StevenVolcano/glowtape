/// <reference path="../pb_data/types.d.ts" />
//
// Timeline planner ("run of show"): an event carries an ordered list of
// segments with DURATIONS — {title, minutes} — and clock times are computed
// forward from the event start, so changing one duration shifts everything
// after it (the model every run-of-show tool converges on). Templates are
// per-production, manager-curated; three starter templates ship in code.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(new Field({ type: "json", name: "timeline", maxSize: 10000 }));
    app.save(events);

    const productions = app.findCollectionByNameOrId("productions");
    const managerOnly = "production.managers.id ?= @request.auth.id";
    const templates = new Collection({
      type: "base",
      name: "timeline_templates",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 100 },
        { type: "json", name: "items", maxSize: 10000 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      listRule: managerOnly,
      viewRule: managerOnly,
      createRule: managerOnly,
      updateRule: managerOnly,
      deleteRule: managerOnly,
    });
    app.save(templates);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("timeline");
    app.save(events);
    app.delete(app.findCollectionByNameOrId("timeline_templates"));
  },
);
