/// <reference path="../pb_data/types.d.ts" />
//
// Event categories and preset locations.
// - events.kind: "Table Read", "Blocking", "Dress"… free text, chosen from the
//   production's list in the UI.
// - productions.eventKinds / productions.locations: per-production preset
//   lists (JSON arrays), editable by managers; the app falls back to sensible
//   defaults when empty.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(new Field({ name: "kind", type: "text", max: 60 }));
    app.save(events);

    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.add(new Field({ name: "eventKinds", type: "json", maxSize: 5000 }));
    productions.fields.add(new Field({ name: "locations", type: "json", maxSize: 5000 }));
    app.save(productions);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("kind");
    app.save(events);
    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("eventKinds");
    productions.fields.removeByName("locations");
    app.save(productions);
  },
);
