/// <reference path="../pb_data/types.d.ts" />
//
// Polls in chat: a message can carry a poll.
//
// - poll: {kind: 'choice'|'times', question, multi, options: [{id, label,
//   start?, end?}]}. 'choice' = pick an answer; 'times' = Doodle-style "when
//   works?" where each option is a date/time and people mark yes / maybe.
//   Only managers can post one (checked in messages.pb.js).
// - pollVotes: {userId: {name, picks: {optionId: 'yes'|'maybe'}}}. Written
//   ONLY by POST /api/glowtape/polls/vote (polls.pb.js), so the record API
//   can't forge someone else's vote; readable by whoever can read the
//   message, so results are visible to the channel and nobody else.
// - pollClosed: voting stopped (managers or the poll's author).
// - pollPinned: shown on the show's Dashboard while it's open.

migrate(
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    messages.fields.add(new Field({ type: "json", name: "poll", maxSize: 20000 }));
    messages.fields.add(new Field({ type: "json", name: "pollVotes", maxSize: 500000 }));
    messages.fields.add(new Field({ type: "bool", name: "pollClosed" }));
    messages.fields.add(new Field({ type: "bool", name: "pollPinned" }));
    app.save(messages);
  },
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    for (const f of ["poll", "pollVotes", "pollClosed", "pollPinned"]) messages.fields.removeByName(f);
    app.save(messages);
  },
);
