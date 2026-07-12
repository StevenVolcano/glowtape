/// <reference path="../pb_data/types.d.ts" />
//
// Soft-cancel for events: cancelled events stay visible (struck through in
// the app, STATUS:CANCELLED in calendar feeds) instead of vanishing without
// explanation. Empty status = scheduled.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(
      new Field({ name: "status", type: "select", values: ["scheduled", "cancelled"], maxSelect: 1 }),
    );
    app.save(events);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("status");
    app.save(events);
  },
);
