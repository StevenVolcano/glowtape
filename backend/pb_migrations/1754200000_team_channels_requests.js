/// <reference path="../pb_data/types.d.ts" />
//
// 1) Semi-private team channels: channels gain an optional `member` relation.
//    When set, the channel is visible only to that member's own user, their
//    guardians, and the production's managers — a way for one person to reach
//    the whole production team without any 1:1 messaging (several adults are
//    always present, keeping the youth-safety model intact).
//
// 2) production_requests: a director asks for a new production on Glow Tape;
//    the operator edits the details, then approves (a route creates the org,
//    production, and their manager membership) or declines.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const members = app.findCollectionByNameOrId("members");
    const channels = app.findCollectionByNameOrId("channels");

    // --- team channels ------------------------------------------------------
    channels.fields.add(
      new Field({ name: "member", type: "relation", collectionId: members.id, maxSelect: 1, cascadeDelete: true }),
    );
    const chPrivateGate =
      "(member = '' || member.user = @request.auth.id || member.guardians.id ?= @request.auth.id || production.managers.id ?= @request.auth.id)";
    channels.listRule =
      "(production = '' || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id) && " +
      chPrivateGate;
    channels.viewRule = channels.listRule;
    app.save(channels);

    const msgPrivateGate =
      "(channel.member = '' || channel.member.user = @request.auth.id || channel.member.guardians.id ?= @request.auth.id || channel.production.managers.id ?= @request.auth.id)";
    const messages = app.findCollectionByNameOrId("messages");
    messages.listRule =
      "(channel.production = '' || channel.production.managers.id ?= @request.auth.id || channel.production.members_via_production.user ?= @request.auth.id) && " +
      msgPrivateGate;
    messages.viewRule = messages.listRule;
    messages.createRule =
      "author = @request.auth.id && (channel.production = '' || channel.production.members_via_production.user ?= @request.auth.id) && " +
      msgPrivateGate;
    app.save(messages);

    const rxPrivateGate =
      "(message.channel.member = '' || message.channel.member.user = @request.auth.id || message.channel.member.guardians.id ?= @request.auth.id || message.channel.production.managers.id ?= @request.auth.id)";
    const reactions = app.findCollectionByNameOrId("reactions");
    reactions.listRule =
      "(message.channel.production = '' || message.channel.production.managers.id ?= @request.auth.id || message.channel.production.members_via_production.user ?= @request.auth.id) && " +
      rxPrivateGate;
    reactions.viewRule = reactions.listRule;
    reactions.createRule =
      "user = @request.auth.id && (message.channel.production = '' || message.channel.production.members_via_production.user ?= @request.auth.id) && " +
      rxPrivateGate;
    app.save(reactions);

    // --- production requests ------------------------------------------------
    const requests = new Collection({
      type: "base",
      name: "production_requests",
      fields: [
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "org", required: true, max: 200 },
        { type: "text", name: "title", required: true, max: 200 },
        { type: "select", name: "role", values: ["director", "asst_director", "stage_manager", "producer"], required: true, maxSelect: 1 },
        { type: "text", name: "timeline", max: 300 },
        { type: "text", name: "castSize", max: 100 },
        { type: "bool", name: "minors" },
        { type: "text", name: "notes", max: 1000 },
        { type: "select", name: "status", values: ["new", "approved", "declined"], maxSelect: 1 },
        { type: "text", name: "reply", max: 500 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: "user = @request.auth.id || @request.auth.operator = true",
      viewRule: "user = @request.auth.id || @request.auth.operator = true",
      createRule: "@request.auth.id != '' && user = @request.auth.id && (status = '' || status = 'new')",
      updateRule: "@request.auth.operator = true",
      deleteRule: "@request.auth.operator = true || user = @request.auth.id",
    });
    app.save(requests);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("production_requests"));

    const channels = app.findCollectionByNameOrId("channels");
    channels.listRule =
      "production = '' || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    channels.viewRule = channels.listRule;
    channels.fields.removeByName("member");
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
  },
);
