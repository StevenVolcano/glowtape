/// <reference path="../pb_data/types.d.ts" />
//
// Structured conflicts on audition signups: [{start, end, note}] like the
// schedule tab's conflicts, alongside the plain-text summary in `conflicts`
// that the review and casting screens already display.

migrate(
  (app) => {
    const auditions = app.findCollectionByNameOrId("auditions");
    auditions.fields.add(new Field({ name: "conflictDates", type: "json", maxSize: 8000 }));
    app.save(auditions);
  },
  (app) => {
    const auditions = app.findCollectionByNameOrId("auditions");
    auditions.fields.removeByName("conflictDates");
    app.save(auditions);
  },
);
