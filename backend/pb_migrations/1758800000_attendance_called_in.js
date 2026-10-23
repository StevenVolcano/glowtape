/// <reference path="../pb_data/types.d.ts" />
//
// Roll call: tell "called in" apart from "missing". `calledIn` is set by the
// self-report route (running late / can't make it) and cleared whenever the
// row is settled another way (door check-in, a manager tap), so the SM can
// see at a glance who gave notice and who just didn't show.

migrate(
  (app) => {
    const attendance = app.findCollectionByNameOrId("attendance");
    attendance.fields.add(new Field({ type: "bool", name: "calledIn" }));
    app.save(attendance);
  },
  (app) => {
    const attendance = app.findCollectionByNameOrId("attendance");
    attendance.fields.removeByName("calledIn");
    app.save(attendance);
  },
);
