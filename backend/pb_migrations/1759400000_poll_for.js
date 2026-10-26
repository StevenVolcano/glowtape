/// <reference path="../pb_data/types.d.ts" />
//
// messages.pollFor: the members a poll is asking (hand-picked in Schedule →
// When can we rehearse?). Only they (and their guardians) get the push, and
// the poll card shows who it's waiting on. Empty = the whole channel, as
// before. Set only at create (messages.pb.js locks it afterwards).

migrate(
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    const members = app.findCollectionByNameOrId("members");
    messages.fields.add(
      new Field({
        type: "relation",
        name: "pollFor",
        collectionId: members.id,
        maxSelect: 200,
        cascadeDelete: false,
      }),
    );
    app.save(messages);
  },
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    messages.fields.removeByName("pollFor");
    app.save(messages);
  },
);
