/// <reference path="../pb_data/types.d.ts" />
//
// Direct messages between adults who share a show (migration 1759300000).
// A DM is a channel with dmUsers = [the two people]; the API rules only open
// it when BOTH accounts are ageBand 'adult'. This file:
//   - POST /api/glowtape/dm/start — find-or-create the DM with a castmate
//   - keeps dmUsers route-only (no hand-made DM channels via the record API)
//   - re-checks every DM post: both still adults, both still in the show,
//     no block either way, no polls
//   - nightly rollover of teens whose 18th birthday (teenUntil) has passed
//
// One refusal message covers "they're under 18", "they blocked you" and
// "they left the show" on purpose, so the DM button can't be used to find
// out which castmates are minors.
//
// NOTE: handlers run in isolated VMs — helpers live in glowtape_lib.js and are
// require()d INSIDE each handler (gotcha #1).

routerAdd(
  "POST",
  "/api/glowtape/dm/start",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ production: "", member: "" });
    e.bindBody(data);
    const NOPE = "You can't start a direct message with them. Direct messages are only between adults, and either person can block them.";

    let production;
    try {
      production = e.app.findRecordById("productions", data.production);
    } catch {
      throw new BadRequestError("Unknown production.");
    }
    lib.assertNotArchived(production);
    const me = e.app.findRecordById("users", e.auth.id);
    if (!lib.isAdultAccount(e.app, me)) {
      throw new ForbiddenError("Direct messages are only for people 18 or older.");
    }
    const inShow = (uid) => {
      try {
        e.app.findFirstRecordByFilter("members", "production = {:p} && user = {:u}", { p: production.id, u: uid });
        return true;
      } catch {
        return false;
      }
    };
    if (!inShow(me.id)) throw new BadRequestError("You're not in this production.");

    let member;
    try {
      member = e.app.findRecordById("members", data.member);
    } catch {
      throw new BadRequestError(NOPE);
    }
    const otherId = String(member.get("user") || "");
    if (String(member.get("production")) !== production.id || !otherId) throw new BadRequestError(NOPE);
    if (otherId === me.id) throw new BadRequestError("That's you!");
    const other = e.app.findRecordById("users", otherId);
    if (!lib.isAdultAccount(e.app, other)) throw new BadRequestError(NOPE);
    const blocked = e.app.findRecordsByFilter(
      "dm_blocks",
      "(user = {:a} && blocked = {:b}) || (user = {:b} && blocked = {:a})",
      "",
      2,
      0,
      { a: me.id, b: otherId },
    );
    // Someone I blocked: tell me (I can unblock). Someone who blocked me: generic.
    if (blocked.some((b) => String(b.get("user")) === me.id)) {
      throw new BadRequestError("You blocked them. Unblock them from your direct messages first.");
    }
    if (blocked.length) throw new BadRequestError(NOPE);

    let channel = null;
    const existing = e.app.findRecordsByFilter(
      "channels",
      "production = {:p} && dmUsers ~ {:a} && dmUsers ~ {:b}",
      "",
      1,
      0,
      { p: production.id, a: me.id, b: otherId },
    );
    if (existing.length) {
      channel = existing[0];
    } else {
      channel = new Record(e.app.findCollectionByNameOrId("channels"));
      channel.set("production", production.id);
      channel.set("dmUsers", [me.id, otherId]);
      channel.set("audience", "all"); // required; the dmUsers gate does the hiding
      channel.set("name", "💬 Direct message");
      e.app.save(channel);
    }
    return e.json(200, { ok: true, channel: channel.id });
  },
  $apis.requireAuth(),
);

// dmUsers is set by the route only — managers can create show channels via the
// API, but never one that looks like somebody's DM.
onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  if (!e.hasSuperuserAuth() && lib.toIdArray(e.record.get("dmUsers")).length) {
    throw new BadRequestError("Direct messages are started from the Messages tab.");
  }
  e.next();
}, "channels");

onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth() && e.record.getString("dmUsers") !== e.record.original().getString("dmUsers")) {
    throw new BadRequestError("A direct message's people can't be changed.");
  }
  e.next();
}, "channels");

// Every DM post: the rules already require two adults; this adds what rules
// can't say — still both in the show, nobody blocked, and no polls.
onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  let channel = null;
  try {
    channel = e.app.findRecordById("channels", e.record.get("channel"));
  } catch {
    /* the rules will refuse it */
  }
  const people = channel ? lib.toIdArray(channel.get("dmUsers")) : [];
  if (people.length) {
    const NOPE = "You can't send messages in this conversation any more.";
    if (lib.readJson(e.record, "poll")) throw new BadRequestError("Polls are for the show's channels.");
    for (const uid of people) {
      try {
        e.app.findFirstRecordByFilter("members", "production = {:p} && user = {:u}", {
          p: channel.get("production"),
          u: uid,
        });
      } catch {
        throw new BadRequestError(NOPE);
      }
      if (!lib.isAdultAccount(e.app, e.app.findRecordById("users", uid))) throw new BadRequestError(NOPE);
    }
    const blocks = e.app.findRecordsByFilter(
      "dm_blocks",
      "(user = {:a} && blocked = {:b}) || (user = {:b} && blocked = {:a})",
      "",
      2,
      0,
      { a: people[0], b: people[1] || "" },
    );
    if (blocks.some((b) => String(b.get("user")) === e.auth.id)) {
      throw new BadRequestError("You blocked them. Unblock them to send a message.");
    }
    if (blocks.length) throw new BadRequestError(NOPE);
  }
  e.next();
}, "messages");

// Teens who've reached 18 (year-precision teenUntil) become adults, so the
// DM rules — which compare ageBand only — open up for them.
cronAdd("glowtape_teen_rollover", "23 3 * * *", () => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  const now = new Date().toISOString().replace("T", " ");
  const due = $app.findRecordsByFilter(
    "users",
    "ageBand = 'teen' && teenUntil != '' && teenUntil <= {:now}",
    "",
    500,
    0,
    { now },
  );
  for (const u of due) {
    try {
      lib.isAdultAccount($app, u);
    } catch (err) {
      $app.logger().warn("glowtape: teen rollover failed", "user", u.id, "error", String(err));
    }
  }
});
