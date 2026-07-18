/// <reference path="../pb_data/types.d.ts" />
//
// The potluck sign-up: a cast party (or strike, or any event) can carry a
// bring-something list. The event stores its categories (Mains, Sides,
// Desserts, Drinks…); everyone adds "I'll bring cookies" under one. One row
// per promised item, owned by the person who promised it.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(new Field({ type: "json", name: "bringCategories", maxSize: 2000 }));
    app.save(events);

    const productions = app.findCollectionByNameOrId("productions");
    const users = app.findCollectionByNameOrId("users");

    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    const ownOrManager = "user = @request.auth.id || production.managers.id ?= @request.auth.id";

    const items = new Collection({
      type: "base",
      name: "bring_items",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "event", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "item", required: true, max: 200 },
        { type: "text", name: "category", max: 100 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      listRule: memberRead,
      viewRule: memberRead,
      createRule: "user = @request.auth.id && (" + memberRead + ")",
      updateRule: ownOrManager,
      deleteRule: ownOrManager,
    });
    app.save(items);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("bringCategories");
    app.save(events);
    app.delete(app.findCollectionByNameOrId("bring_items"));
  },
);
