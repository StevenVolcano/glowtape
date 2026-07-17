/// <reference path="../pb_data/types.d.ts" />
//
// Line notes carry a snippet: the printed lines around the tapped spot,
// pulled from the PDF's embedded text when the note is saved. Digital
// scripts have real text; scanned photocopies yield nothing and the
// snippet stays empty (UI hides it).

migrate(
  (app) => {
    const lineNotes = app.findCollectionByNameOrId("line_notes");
    lineNotes.fields.add(new Field({ type: "text", name: "snippet", max: 400 }));
    app.save(lineNotes);
  },
  (app) => {
    const lineNotes = app.findCollectionByNameOrId("line_notes");
    lineNotes.fields.removeByName("snippet");
    app.save(lineNotes);
  },
);
