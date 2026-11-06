/// <reference path="../pb_data/types.d.ts" />
//
// @mentions in show chat: messages.mentionMembers (people) and
// messages.mentionGroups (role groups — the Cast group covers "@Cast"). The
// text carries the readable "@Anna K." / "@Cast"; these relations are what
// the push hook uses to ping exactly those people (and a child's guardians),
// even when they muted the channel. Set only at create (messages.pb.js checks
// they belong to the show and locks them afterwards).

migrate(
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    const members = app.findCollectionByNameOrId("members");
    const groups = app.findCollectionByNameOrId("groups");
    messages.fields.add(
      new Field({
        type: "relation",
        name: "mentionMembers",
        collectionId: members.id,
        maxSelect: 50,
        cascadeDelete: false,
      }),
    );
    messages.fields.add(
      new Field({
        type: "relation",
        name: "mentionGroups",
        collectionId: groups.id,
        maxSelect: 20,
        cascadeDelete: false,
      }),
    );
    app.save(messages);
  },
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    messages.fields.removeByName("mentionMembers");
    messages.fields.removeByName("mentionGroups");
    app.save(messages);
  },
);
