/// <reference path="../pb_data/types.d.ts" />
//
// Highlight colors: annotations carry an optional color key ('yellow' when
// missing) so highlighters come in more than one shade.

migrate(
  (app) => {
    const annotations = app.findCollectionByNameOrId("annotations");
    annotations.fields.add(new Field({ type: "text", name: "color", max: 20 }));
    app.save(annotations);
  },
  (app) => {
    const annotations = app.findCollectionByNameOrId("annotations");
    annotations.fields.removeByName("color");
    app.save(annotations);
  },
);
