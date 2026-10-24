/// <reference path="../pb_data/types.d.ts" />
//
// Direct messages between adults (Steven, 2026-10-24: "allow direct
// messaging, if the users are 18+").
//
// A DM is a channel inside a show with channels.dmUsers = the two people.
// It is ONLY readable/writable when BOTH accounts have ageBand 'adult' —
// checked in the rules below (the rule resolver can read hidden fields), so
// a teen account can't read or post in one even by crafting requests.
// Legacy accounts with no band ('') don't qualify; nightly cron
// glowtape_teen_rollover (dm.pb.js) turns teens whose teenUntil has passed
// into 'adult', so rules never need date math.
//
// Every existing channel/message/reaction rule is wrapped in
// `dmUsers:length = 0 && (...)`, so DMs fall outside the manager and
// operator (Stagehand) clauses: a DM is private to its two people. Reports
// (⚑) still reach the operator with the message text, as everywhere else.
//
// DM channels are created only by POST /api/glowtape/dm/start (dm.pb.js),
// which checks both people share the show and nobody blocked anybody.
// dm_blocks: one row per (user blocks blocked); the messages create hook
// refuses DM posts when a block exists either way.

const DM = "dmUsers:length = 0";
// Every rule keeps the signed-in guard from 1759200000 at the very front.
const GUARD = "@request.auth.id != ''";
const adultsIn = (path) =>
  `${path}dmUsers.id ?= @request.auth.id && @request.auth.ageBand = 'adult' && ${path}dmUsers.ageBand = 'adult'`;

// Take the guard off (if present) so the DM wrap goes inside it, then put it back.
const bare = (rule) => {
  const s = String(rule);
  const head = `${GUARD} && (`;
  return s.indexOf(head) === 0 && s.endsWith(")") ? s.slice(head.length, s.length - 1) : s;
};
const guard = (s) => `${GUARD} && (${s})`;

const wrap = (prefix, old) => guard(`(${prefix}${DM} && (${bare(old)})) || (${adultsIn(prefix)})`);

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const channels = app.findCollectionByNameOrId("channels");
    channels.fields.add(
      new Field({ name: "dmUsers", type: "relation", collectionId: users.id, maxSelect: 2, cascadeDelete: false }),
    );
    app.save(channels);

    const blocks = new Collection({
      type: "base",
      name: "dm_blocks",
      fields: [
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: "blocked", type: "relation", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_dm_blocks_pair ON dm_blocks (user, blocked)"],
      listRule: guard("user = @request.auth.id"),
      viewRule: guard("user = @request.auth.id"),
      createRule: guard("user = @request.auth.id && blocked != @request.auth.id"),
      updateRule: null,
      deleteRule: guard("user = @request.auth.id"),
    });
    app.save(blocks);

    const c = app.findCollectionByNameOrId("channels");
    c.listRule = wrap("", String(c.listRule));
    c.viewRule = wrap("", String(c.viewRule));
    // Managers manage show channels, never someone's DM.
    c.updateRule = guard(`${DM} && (${bare(c.updateRule)})`);
    c.deleteRule = guard(`${DM} && (${bare(c.deleteRule)})`);
    app.save(c);

    const m = app.findCollectionByNameOrId("messages");
    m.listRule = wrap("channel.", String(m.listRule));
    m.viewRule = wrap("channel.", String(m.viewRule));
    m.createRule = guard(`(channel.${DM} && (${bare(m.createRule)})) || (author = @request.auth.id && ${adultsIn("channel.")})`);
    // Own messages only in a DM — the manager/operator delete clause is for show channels.
    m.deleteRule = guard(`author = @request.auth.id || (channel.${DM} && (${bare(m.deleteRule)}))`);
    app.save(m);

    const r = app.findCollectionByNameOrId("reactions");
    r.listRule = wrap("message.channel.", String(r.listRule));
    r.viewRule = wrap("message.channel.", String(r.viewRule));
    r.createRule = guard(`(message.channel.${DM} && (${bare(r.createRule)})) || (user = @request.auth.id && ${adultsIn("message.channel.")})`);
    app.save(r);
  },
  (app) => {
    // Undo by peeling the wrappers back off (exact strings built above).
    const unwrap = (rule, head, tail) => {
      const s = bare(rule);
      const i = s.indexOf(head);
      const j = s.lastIndexOf(tail);
      return guard(i === 0 && j > 0 ? s.slice(head.length, j) : s);
    };
    const c = app.findCollectionByNameOrId("channels");
    c.listRule = unwrap(c.listRule, `(${DM} && (`, `)) || (`);
    c.viewRule = unwrap(c.viewRule, `(${DM} && (`, `)) || (`);
    c.updateRule = unwrap(c.updateRule, `${DM} && (`, `)`);
    c.deleteRule = unwrap(c.deleteRule, `${DM} && (`, `)`);
    app.save(c);

    const m = app.findCollectionByNameOrId("messages");
    m.listRule = unwrap(m.listRule, `(channel.${DM} && (`, `)) || (`);
    m.viewRule = unwrap(m.viewRule, `(channel.${DM} && (`, `)) || (`);
    m.createRule = unwrap(m.createRule, `(channel.${DM} && (`, `)) || (`);
    m.deleteRule = unwrap(m.deleteRule, `author = @request.auth.id || (channel.${DM} && (`, `))`);
    app.save(m);

    const r = app.findCollectionByNameOrId("reactions");
    r.listRule = unwrap(r.listRule, `(message.channel.${DM} && (`, `)) || (`);
    r.viewRule = unwrap(r.viewRule, `(message.channel.${DM} && (`, `)) || (`);
    r.createRule = unwrap(r.createRule, `(message.channel.${DM} && (`, `)) || (`);
    app.save(r);

    app.delete(app.findCollectionByNameOrId("dm_blocks"));
    const ch = app.findCollectionByNameOrId("channels");
    ch.fields.removeByName("dmUsers");
    app.save(ch);
  },
);
