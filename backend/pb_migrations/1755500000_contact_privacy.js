/// <reference path="../pb_data/types.d.ts" />
//
// Seal contact details at the API, not just in the UI. Until now every
// signed-in user could read every other user's email (emailVisibility was
// forced true at signup) and verified cell number (phone is a plain field on
// a collection viewable by any authenticated user) — the contact-sheet UI hid
// them, the API did not.
//
// - phone/phoneVerified/smsOptIn become hidden fields: stripped from every
//   API response, only hooks (superuser context) see them.
// - emailVisibility flips to false for everyone; signup no longer sets it.
// Managers and the operator get contacts through explicit gated routes
// (contacts.pb.js) instead of expands.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    for (const name of ["phone", "phoneVerified", "smsOptIn"]) {
      const field = users.fields.getByName(name);
      if (field) field.hidden = true;
    }
    app.save(users);

    let page = 0;
    for (;;) {
      const batch = app.findRecordsByFilter("users", "id != ''", "created", 200, page * 200);
      if (batch.length === 0) break;
      for (const r of batch) {
        if (r.get("emailVisibility")) {
          r.set("emailVisibility", false);
          app.save(r);
        }
      }
      if (batch.length < 200) break;
      page++;
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    for (const name of ["phone", "phoneVerified", "smsOptIn"]) {
      const field = users.fields.getByName(name);
      if (field) field.hidden = false;
    }
    app.save(users);
  },
);
