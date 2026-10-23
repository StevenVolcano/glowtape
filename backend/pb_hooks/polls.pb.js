/// <reference path="../pb_data/types.d.ts" />
//
// Polls in chat (migration 1758700000): voting, closing and pinning.
//
// A poll lives on its chat message. Votes are stored on the message too
// (pollVotes), so anyone who can read the message sees the results live —
// and nobody else. Writes come only through these routes: the record API
// refuses changes to the poll fields (messages.pb.js update hook).
//
// One vote per account. A parent votes for themselves; under-13s have no
// accounts (youth safety), so they never appear in results.
//
// NOTE: handlers run in isolated VMs — helpers live in glowtape_lib.js and
// are require()d INSIDE each handler (gotcha #1).

// Vote (or change your vote). picks = {optionId: 'yes'|'maybe'}; empty
// picks takes your vote back.
routerAdd(
  "POST",
  "/api/glowtape/polls/vote",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const body = e.requestInfo().body || {};
    const messageId = String(body.message || "");
    let picksIn = {};
    try {
      picksIn = JSON.parse(JSON.stringify(body.picks || {})) || {};
    } catch {
      picksIn = {};
    }

    let message;
    try {
      message = e.app.findRecordById("messages", messageId);
    } catch {
      throw new NotFoundError("That poll is gone.");
    }
    const col = e.app.findCollectionByNameOrId("messages");
    if (!e.app.canAccessRecord(message, e.requestInfo(), String(col.viewRule || ""))) {
      throw new NotFoundError("That poll is gone.");
    }
    const poll = lib.readJson(message, "poll");
    if (!poll || !Array.isArray(poll.options)) throw new BadRequestError("That message isn't a poll.");
    if (message.get("pollClosed")) throw new BadRequestError("This poll is closed.");
    const channel = e.app.findRecordById("channels", message.get("channel"));
    if (channel.get("production")) {
      lib.assertNotArchived(e.app.findRecordById("productions", channel.get("production")));
    }

    const ids = poll.options.map((o) => String(o.id));
    const picks = {};
    for (const id of Object.keys(picksIn)) {
      const v = String(picksIn[id]);
      if (!ids.includes(id)) continue;
      if (v === "yes" || (v === "maybe" && poll.kind === "times")) picks[id] = v;
    }
    if (poll.kind !== "times" && !poll.multi && Object.keys(picks).length > 1) {
      throw new BadRequestError("Pick just one answer.");
    }

    let saved = null;
    e.app.runInTransaction((txApp) => {
      const fresh = txApp.findRecordById("messages", message.id);
      const votes = lib.readJson(fresh, "pollVotes") || {};
      if (Object.keys(picks).length === 0) delete votes[e.auth.id];
      else votes[e.auth.id] = { name: String(e.auth.get("name") || ""), picks };
      fresh.set("pollVotes", votes);
      txApp.save(fresh);
      saved = fresh;
    });
    return e.json(200, { pollVotes: lib.readJson(saved, "pollVotes") || {} });
  },
  $apis.requireAuth(),
);

// Close/reopen (managers or the poll's author) and pin to / unpin from the
// show's Dashboard (managers). Only the fields sent are changed.
routerAdd(
  "POST",
  "/api/glowtape/polls/manage",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const body = e.requestInfo().body || {};
    let message;
    try {
      message = e.app.findRecordById("messages", String(body.message || ""));
    } catch {
      throw new NotFoundError("That poll is gone.");
    }
    if (!lib.readJson(message, "poll")) throw new BadRequestError("That message isn't a poll.");
    const channel = e.app.findRecordById("channels", message.get("channel"));
    const production = e.app.findRecordById("productions", String(channel.get("production") || ""));
    lib.assertNotArchived(production);
    const manager = lib.canManage(production, e.auth);
    const author = String(message.get("author")) === e.auth.id;

    if (body.closed !== undefined && body.closed !== null) {
      if (!manager && !author) throw new ForbiddenError("Only the show's managers can close a poll.");
      message.set("pollClosed", !!body.closed);
      // A closed poll has nothing left to ask, so it leaves the Dashboard.
      if (body.closed) message.set("pollPinned", false);
    }
    if (body.pinned !== undefined && body.pinned !== null) {
      if (!manager) throw new ForbiddenError("Only the show's managers can pin a poll.");
      if (body.pinned && message.get("pollClosed")) {
        throw new BadRequestError("Reopen the poll before pinning it.");
      }
      message.set("pollPinned", !!body.pinned);
    }
    e.app.save(message);
    return e.json(200, { pollClosed: !!message.get("pollClosed"), pollPinned: !!message.get("pollPinned") });
  },
  $apis.requireAuth(),
);
