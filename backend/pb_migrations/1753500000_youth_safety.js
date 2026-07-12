/// <reference path="../pb_data/types.d.ts" />
//
// Youth model (issue #9): children never have logins. A child exists as a
// guardian-managed member record — display name, role, guardian links, and
// nothing else. Guardians receive everything the child's membership
// generates. Accounts carry an age band (never a birthdate).
//
// - users.ageBand: '' (legacy/adult) | 'adult' | 'teen'; users.teenUntil:
//   approximate 18th-birthday rollover date (year precision — derived from
//   an age the person typed once and we did not keep).
// - members.minor: guardian-managed child record (user stays empty forever).
// - members.displayName: the child's name as shown (first name + last
//   initial recommended).
// - members.guardians: 1..N user accounts (divorced/blended families all
//   get everything, independently).
// - members.noPhotos: photo-consent flag, set by guardian or manager.
// - members.role gains 'guardian' for the guardians' own member rows.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new Field({ name: "ageBand", type: "select", values: ["adult", "teen"], maxSelect: 1 }));
    users.fields.add(new Field({ name: "teenUntil", type: "date" }));
    app.save(users);

    const members = app.findCollectionByNameOrId("members");
    const role = members.fields.getByName("role");
    role.values = ["director", "asst_director", "stage_manager", "performer", "crew", "guardian"];
    members.fields.add(new Field({ name: "minor", type: "bool" }));
    members.fields.add(new Field({ name: "displayName", type: "text", max: 80 }));
    members.fields.add(
      new Field({
        name: "guardians",
        type: "relation",
        collectionId: users.id,
        maxSelect: 10,
        cascadeDelete: false,
      }),
    );
    members.fields.add(new Field({ name: "noPhotos", type: "bool" }));
    app.save(members);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("ageBand");
    users.fields.removeByName("teenUntil");
    app.save(users);
    const members = app.findCollectionByNameOrId("members");
    const role = members.fields.getByName("role");
    role.values = ["director", "asst_director", "stage_manager", "performer", "crew"];
    members.fields.removeByName("minor");
    members.fields.removeByName("displayName");
    members.fields.removeByName("guardians");
    members.fields.removeByName("noPhotos");
    app.save(members);
  },
);
