/// <reference path="../pb_data/types.d.ts" />
//
// Resources: documents and links attached to a production, split into two
// areas — 'show' (scripts info, music tracks, forms; visible to the cast and
// crew) and 'audition' (sides, what-to-prepare packets; visible to anyone
// signed in while auditions are open, since that's who needs them).

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");

    const resources = new Collection({
      type: "base",
      name: "resources",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "select", name: "area", values: ["show", "audition"], required: true, maxSelect: 1 },
        { type: "text", name: "title", max: 200, required: true },
        { type: "url", name: "url" },
        {
          type: "file",
          name: "file",
          maxSelect: 1,
          maxSize: 26214400, // 25 MB — sheet-music PDFs and rehearsal tracks add up
        },
        { type: "number", name: "order" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule:
        "(area = 'audition' && production.auditionOpen = true && @request.auth.id != '') || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id",
      viewRule:
        "(area = 'audition' && production.auditionOpen = true && @request.auth.id != '') || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id",
      createRule: "production.managers.id ?= @request.auth.id",
      updateRule: "production.managers.id ?= @request.auth.id",
      deleteRule: "production.managers.id ?= @request.auth.id",
    });
    app.save(resources);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("resources"));
  },
);
