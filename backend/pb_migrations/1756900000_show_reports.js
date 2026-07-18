/// <reference path="../pb_data/types.d.ts" />
//
// Show reports: the stage manager's classic performance report, as a
// two-minute phone form after curtain call — audience count, curtain times,
// what went sideways, injuries, and how it went. Production-team-only in
// both directions (cast never see incident notes), one report per event;
// saving the first version emails the whole team (that's the traditional
// distribution list).

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const events = app.findCollectionByNameOrId("events");
    const users = app.findCollectionByNameOrId("users");

    const managerOnly = "production.managers.id ?= @request.auth.id";

    const reports = new Collection({
      type: "base",
      name: "show_reports",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "event", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "author", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: false },
        { type: "number", name: "audience" },
        { type: "text", name: "houseOpen", max: 5 },
        { type: "text", name: "curtainUp", max: 5 },
        { type: "text", name: "curtainDown", max: 5 },
        { type: "text", name: "technical", max: 2000 },
        { type: "text", name: "incidents", max: 2000 },
        { type: "text", name: "notes", max: 2000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_show_reports_event ON show_reports (event)"],
      listRule: managerOnly,
      viewRule: managerOnly,
      createRule: "author = @request.auth.id && " + managerOnly,
      updateRule: managerOnly,
      deleteRule: managerOnly,
    });
    app.save(reports);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("show_reports"));
  },
);
