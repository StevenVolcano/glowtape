/// <reference path="../pb_data/types.d.ts" />
//
// Manual "🔔 Remind people" (Steven 2026-10-29: "Can I ping a reminder to
// events, especially those that have changed?").
//   changeNote / changedAt — what the last date/time/place edit changed, set
//     by the events/update route, so a reminder (and the event card) can say
//     "Changed: was 6pm, now 7pm" to people who haven't tapped Got it since.
//   remindedAt — when a manager last sent a reminder; the route allows one
//     per event every few hours.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(new Field({ type: "text", name: "changeNote", max: 1000 }));
    events.fields.add(new Field({ type: "date", name: "changedAt" }));
    events.fields.add(new Field({ type: "date", name: "remindedAt" }));
    app.save(events);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    for (const name of ["changeNote", "changedAt", "remindedAt"]) {
      const f = events.fields.getByName(name);
      if (f) events.fields.removeById(f.id);
    }
    app.save(events);
  },
);
