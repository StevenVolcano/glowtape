/// <reference path="../pb_data/types.d.ts" />
//
// Recurring conflicts ("city council, 2nd and 4th Monday") are materialized:
// the form generates one plain conflict row per date, all stamped with a
// shared series id so the whole series can be removed in one tap. Every
// consumer (schedule warnings, casting, availability) keeps reading simple
// date rows — recurrence exists only at entry time.

migrate(
  (app) => {
    const conflicts = app.findCollectionByNameOrId("conflicts");
    conflicts.fields.add(new Field({ type: "text", name: "series", max: 40 }));
    app.save(conflicts);
  },
  (app) => {
    const conflicts = app.findCollectionByNameOrId("conflicts");
    conflicts.fields.removeByName("series");
    app.save(conflicts);
  },
);
