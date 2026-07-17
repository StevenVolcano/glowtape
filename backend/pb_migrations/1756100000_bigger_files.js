/// <reference path="../pb_data/types.d.ts" />
//
// 25 MB was too small for scanned scripts and librettos — raise the
// resource file cap to 50 MB.

migrate(
  (app) => {
    const resources = app.findCollectionByNameOrId("resources");
    const file = resources.fields.getByName("file");
    if (file) file.maxSize = 52428800;
    app.save(resources);
  },
  (app) => {
    const resources = app.findCollectionByNameOrId("resources");
    const file = resources.fields.getByName("file");
    if (file) file.maxSize = 26214400;
    app.save(resources);
  },
);
