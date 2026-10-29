/// <reference path="../pb_data/types.d.ts" />
//
// Event descriptions could only hold 2,000 characters, and going over failed
// the whole save with a vague error (Steven 2026-10-29, editing a cast party
// with a long description). Room for a real write-up now: 10,000.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    const notes = events.fields.getByName("notes");
    notes.max = 10000;
    app.save(events);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    const notes = events.fields.getByName("notes");
    notes.max = 2000;
    app.save(events);
  },
);
