/// <reference path="../pb_data/types.d.ts" />
//
// Sign-up slots (costume fittings, headshots, one-on-ones): managers post a
// sheet of short time slots; cast book one each (guardians book for their
// kids). One record per slot — a booking is the member relation being set.
// Booking/cancelling goes through a route (ownership + race checks); the
// record API stays manager-only for writes.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const members = app.findCollectionByNameOrId("members");

    const managerWrite = "production.managers.id ?= @request.auth.id";
    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";

    const slots = new Collection({
      type: "base",
      name: "slots",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "title", required: true, max: 120 },
        { type: "date", name: "start", required: true },
        { type: "number", name: "minutes" },
        { type: "text", name: "location", max: 200 },
        { type: "relation", name: "member", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: memberRead,
      viewRule: memberRead,
      createRule: managerWrite,
      updateRule: managerWrite,
      deleteRule: managerWrite,
    });
    app.save(slots);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("slots"));
  },
);
