/// <reference path="../pb_data/types.d.ts" />
//
// Door check-in: an event can carry a signinCode. The SM turns it on from
// roll call, which generates the code and a QR; cast scan it at the door and
// mark themselves present through a route (attendance createRule stays
// manager-only). The code isn't a secret — it's printed on a poster taped to
// the door — the route just checks it plus a sane time window.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(new Field({ type: "text", name: "signinCode", max: 40 }));
    app.save(events);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("signinCode");
    app.save(events);
  },
);
