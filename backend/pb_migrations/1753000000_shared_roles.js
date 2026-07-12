/// <reference path="../pb_data/types.d.ts" />
//
// Shared roles: "Ensemble" or "Stage Crew" placeholders that several people
// claim with the same code.
//
// - members.multi: this placeholder is a shared role. It is never itself
//   cast; each claimer gets their own member row.
// - members.claimedFrom: points a claimer's row back at the shared
//   placeholder. Calling the placeholder on an event calls every claimer —
//   recipients, reminders, calendar feeds, and "you're called" checks all
//   follow claimedFrom.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.add(new Field({ name: "multi", type: "bool" }));
    members.fields.add(
      new Field({
        name: "claimedFrom",
        type: "relation",
        collectionId: members.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    );
    app.save(members);
  },
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.removeByName("claimedFrom");
    members.fields.removeByName("multi");
    app.save(members);
  },
);
