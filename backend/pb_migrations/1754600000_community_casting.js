/// <reference path="../pb_data/types.d.ts" />
//
// One migration, four small schema additions:
// - profiles.credits: structured stage history rows [{year, company, show, role}]
// - members.contactEmail/contactPhone: manager-entered contact info for cast
//   and crew who can't/won't use the app (included in email sends, never SMS)
// - cast_drafts: the director's private casting worksheet — invisible to
//   everyone but managers until finalized
// (The community calendar needs no schema: it's a route over events whose
// kind matches audition/performance.)

migrate(
  (app) => {
    const profiles = app.findCollectionByNameOrId("profiles");
    profiles.fields.add(new Field({ name: "credits", type: "json", maxSize: 20000 }));
    app.save(profiles);

    const members = app.findCollectionByNameOrId("members");
    members.fields.add(new Field({ name: "contactEmail", type: "text", max: 200 }));
    members.fields.add(new Field({ name: "contactPhone", type: "text", max: 40 }));
    app.save(members);

    const productions = app.findCollectionByNameOrId("productions");
    const managerOnly = "production.managers.id ?= @request.auth.id";
    const drafts = new Collection({
      type: "base",
      name: "cast_drafts",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        // { memberId: userId } — role rows mapped to the chosen auditioner
        { type: "json", name: "assignments", maxSize: 20000 },
        { type: "select", name: "status", values: ["draft", "final"], maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_cast_drafts_prod ON cast_drafts (production)"],
      listRule: managerOnly,
      viewRule: managerOnly,
      createRule: managerOnly,
      updateRule: managerOnly,
      deleteRule: managerOnly,
    });
    app.save(drafts);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("cast_drafts"));
    const members = app.findCollectionByNameOrId("members");
    members.fields.removeByName("contactEmail");
    members.fields.removeByName("contactPhone");
    app.save(members);
    const profiles = app.findCollectionByNameOrId("profiles");
    profiles.fields.removeByName("credits");
    app.save(profiles);
  },
);
