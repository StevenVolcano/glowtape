/// <reference path="../pb_data/types.d.ts" />
//
// Sheets as cards (Steven 2026-11-01: "more like a SharePoint list" — make it
// friendly to track down props and costumes). Each row can now carry files:
// photos of the thing (shrunk + EXIF-stripped in the browser by
// lib/images.ts) and paperwork like a rental agreement PDF or a costume
// plot. Plus a "Where it is" column, because "where's the blue suitcase?"
// is the question these sheets exist to answer, and longer notes now that a
// card has room to show them.
//
// The file field is PROTECTED: costume-fitting photos can show children, so
// plain file URLs 404 and the app asks for a short-lived token
// (pb.files.getToken). Access rides on tracker_items' existing rules — signed
// in AND in the show (or a manager / the operator) to see, managers to add or
// remove. No rule changes needed: those rules already start with
// `@request.auth.id != ''` (1759200000) and carry the operator clause
// (1757800000).

migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("tracker_items");
    items.fields.add(
      new Field({
        name: "attachments",
        type: "file",
        maxSelect: 12,
        maxSize: 26214400, // 25 MB each — a scanned rental contract or a big photo
        protected: true,
        thumbs: ["240x240", "800x0"],
        mimeTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "application/pdf",
          "text/plain",
          "text/csv",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
      }),
    );
    items.fields.add(new Field({ name: "where", type: "text", max: 200 }));
    const notes = items.fields.getByName("notes");
    if (notes) notes.max = 2000;
    app.save(items);
  },
  (app) => {
    const items = app.findCollectionByNameOrId("tracker_items");
    items.fields.removeByName("attachments");
    items.fields.removeByName("where");
    const notes = items.fields.getByName("notes");
    if (notes) notes.max = 400;
    app.save(items);
  },
);
