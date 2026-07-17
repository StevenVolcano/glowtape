/// <reference path="../pb_data/types.d.ts" />
//
// Weekly busy hours: "work Mon–Fri 9–5", "class Tue/Thu 6–9pm". Same
// conflicts collection, three new optional fields — a row with days +
// fromTime + toTime is a weekly pattern (start = effective from, end =
// optional until; empty end = open-ended) instead of a date range. One
// collection means every conflict consumer sees both kinds in one query.

migrate(
  (app) => {
    const conflicts = app.findCollectionByNameOrId("conflicts");
    conflicts.fields.add(new Field({ type: "json", name: "days", maxSize: 100 }));
    conflicts.fields.add(new Field({ type: "text", name: "fromTime", max: 5 }));
    conflicts.fields.add(new Field({ type: "text", name: "toTime", max: 5 }));
    app.save(conflicts);
  },
  (app) => {
    const conflicts = app.findCollectionByNameOrId("conflicts");
    for (const f of ["days", "fromTime", "toTime"]) conflicts.fields.removeByName(f);
    app.save(conflicts);
  },
);
