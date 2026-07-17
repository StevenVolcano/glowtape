/// <reference path="../pb_data/types.d.ts" />
//
// Line notes v2: no push per note. Notes accumulate quietly during the run;
// the SM taps "Send tonight's line notes" afterwards and each actor gets ONE
// push covering all of theirs. `notified` tracks which notes have been sent
// so a second tap only covers new ones.

migrate(
  (app) => {
    const lineNotes = app.findCollectionByNameOrId("line_notes");
    lineNotes.fields.add(new Field({ type: "bool", name: "notified" }));
    app.save(lineNotes);
  },
  (app) => {
    const lineNotes = app.findCollectionByNameOrId("line_notes");
    lineNotes.fields.removeByName("notified");
    app.save(lineNotes);
  },
);
