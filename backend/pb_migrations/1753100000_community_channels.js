/// <reference path="../pb_data/types.d.ts" />
//
// The community board: channels with NO production are visible to every
// signed-in Glow Tape user — the "all of Grays Harbor theater" space.
//
// - channels.production becomes optional; empty = community channel.
// - Read/post rules across channels/messages/reactions/channel_prefs gain a
//   community clause. Creating/managing community channels stays superuser-
//   only for now (they're shared infrastructure, curated by the operator).
// - Seeds the first three community channels.

migrate(
  (app) => {
    const channels = app.findCollectionByNameOrId("channels");
    const production = channels.fields.getByName("production");
    production.required = false;
    channels.listRule =
      "production = '' || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    channels.viewRule = channels.listRule;
    app.save(channels);

    const messages = app.findCollectionByNameOrId("messages");
    messages.listRule =
      "channel.production = '' || channel.production.managers.id ?= @request.auth.id || channel.production.members_via_production.user ?= @request.auth.id";
    messages.viewRule = messages.listRule;
    messages.createRule =
      "author = @request.auth.id && (channel.production = '' || channel.production.members_via_production.user ?= @request.auth.id)";
    app.save(messages);

    const reactions = app.findCollectionByNameOrId("reactions");
    reactions.listRule =
      "message.channel.production = '' || message.channel.production.managers.id ?= @request.auth.id || message.channel.production.members_via_production.user ?= @request.auth.id";
    reactions.viewRule = reactions.listRule;
    reactions.createRule =
      "user = @request.auth.id && (message.channel.production = '' || message.channel.production.members_via_production.user ?= @request.auth.id)";
    app.save(reactions);

    const prefs = app.findCollectionByNameOrId("channel_prefs");
    prefs.createRule =
      "user = @request.auth.id && (channel.production = '' || channel.production.members_via_production.user ?= @request.auth.id)";
    app.save(prefs);

    // seed the community channels
    const seed = [
      ["General", false],
      ["Auditions & Casting Calls", false],
      ["Lend & Borrow", false],
    ];
    for (const [name, defaultMuted] of seed) {
      const c = new Record(channels);
      c.set("name", name);
      c.set("audience", "all");
      c.set("defaultMuted", defaultMuted);
      app.save(c);
    }
  },
  (app) => {
    const channels = app.findCollectionByNameOrId("channels");
    const community = app.findRecordsByFilter("channels", "production = ''", "", 50, 0, {});
    for (const c of community) app.delete(c);
    const production = channels.fields.getByName("production");
    production.required = true;
    channels.listRule =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    channels.viewRule = channels.listRule;
    app.save(channels);
  },
);
