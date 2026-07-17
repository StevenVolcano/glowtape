/// <reference path="../pb_data/types.d.ts" />
//
// Box highlights: a fourth annotation kind whose two path points are
// opposite corners of a filled translucent rectangle.

migrate(
  (app) => {
    const annotations = app.findCollectionByNameOrId("annotations");
    const kind = annotations.fields.getByName("kind");
    if (kind) kind.values = ["pin", "draw", "highlight", "box"];
    app.save(annotations);
  },
  (app) => {
    const annotations = app.findCollectionByNameOrId("annotations");
    const kind = annotations.fields.getByName("kind");
    if (kind) kind.values = ["pin", "draw", "highlight"];
    app.save(annotations);
  },
);
