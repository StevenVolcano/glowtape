/// <reference path="../pb_data/types.d.ts" />
//
// A photo on each Sheets row (props, costumes, set) so "the blue suitcase"
// is never a guessing game. One image per row; the app shrinks and strips
// EXIF before upload (lib/images.ts), so the 10MB cap is just a backstop.
// Visibility rides on tracker_items' existing rules — whoever can read the
// row can see its photo; only managers can add, replace or remove one.

migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("tracker_items");
    items.fields.add(
      new Field({
        name: "photo",
        type: "file",
        maxSelect: 1,
        maxSize: 10485760,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        thumbs: ["120x120"],
      }),
    );
    app.save(items);
  },
  (app) => {
    const items = app.findCollectionByNameOrId("tracker_items");
    items.fields.removeByName("photo");
    app.save(items);
  },
);
