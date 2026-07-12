/// <reference path="../pb_data/types.d.ts" />
//
// Pre-cast scheduling: members can exist before anyone is cast.
//
// - members.user becomes optional: a "placeholder" member is a role
//   (position = "Ophelia", user empty) that can be called on events like
//   anyone else.
// - members.roleCode: a 2-character suffix; production joinCode + suffix is
//   the claim code handed to whoever gets cast. Joining with the 8-character
//   code attaches the new user to the placeholder — and their whole schedule
//   is already waiting.
// - The (production, user) unique index becomes partial so multiple uncast
//   placeholders (user = '') can coexist.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const user = members.fields.getByName("user");
    user.required = false;
    members.fields.add(new Field({ name: "roleCode", type: "text", max: 4 }));
    members.indexes = [
      "CREATE UNIQUE INDEX idx_members_unique ON members (production, user) WHERE user != ''",
    ];
    app.save(members);
  },
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const user = members.fields.getByName("user");
    user.required = true;
    members.fields.removeByName("roleCode");
    members.indexes = ["CREATE UNIQUE INDEX idx_members_unique ON members (production, user)"];
    app.save(members);
  },
);
