/// <reference path="../pb_data/types.d.ts" />
//
// RSVPs (Steven 2026-10-29: "When a cast party is scheduled, we need an RSVP
// option… Just cast parties?"). events.rsvp turns it on — automatically for
// party/potluck kinds (lib.rsvpDefault), by a manager checkbox on anything
// else. One rsvps row per (event, member): Going / Maybe / Can't go plus how
// many guests they're bringing. A parent answers for their child.
//
// Writes go ONLY through POST /api/glowtape/rsvp (rsvp.pb.js) so the
// is-this-person-invited and is-RSVP-on checks live in one place. Reads:
// managers + operator see everyone (the headcount); everyone else sees only
// their own rows and their children's. Signed-in guard at the front (gotcha #13).

const GUARD = "@request.auth.id != ''";
const read =
  `${GUARD} && (production.managers.id ?= @request.auth.id || member.user = @request.auth.id || ` +
  "member.guardians.id ?= @request.auth.id || @request.auth.operator = true)";

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(new Field({ type: "bool", name: "rsvp" }));
    app.save(events);

    const productions = app.findCollectionByNameOrId("productions");
    const members = app.findCollectionByNameOrId("members");
    const users = app.findCollectionByNameOrId("users");

    const rsvps = new Collection({
      type: "base",
      name: "rsvps",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "event", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "member", collectionId: members.id, required: true, maxSelect: 1, cascadeDelete: true },
        // who tapped it (the member, a parent, or a manager filling in for someone)
        { type: "relation", name: "user", collectionId: users.id, maxSelect: 1 },
        { type: "select", name: "answer", required: true, maxSelect: 1, values: ["yes", "maybe", "no"] },
        { type: "number", name: "guests", min: 0, max: 20, onlyInt: true },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_rsvps_event_member ON rsvps (event, member)"],
      listRule: read,
      viewRule: read,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(rsvps);

    // Parties already on the calendar get RSVP switched on.
    const parties = app.findRecordsByFilter(
      "events",
      "kind ~ 'party' || kind ~ 'potluck'",
      "",
      1000,
      0,
    );
    for (const ev of parties) {
      ev.set("rsvp", true);
      app.save(ev);
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("rsvps"));
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("rsvp");
    app.save(events);
  },
);
