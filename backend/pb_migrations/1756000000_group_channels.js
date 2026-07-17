/// <reference path="../pb_data/types.d.ts" />
//
// Group channels: a channel can be tied to a role group ("Group A"). Only the
// group's members (their guardians included — a child's guardian sees
// everything the child sees) and the production team can see it. Same
// youth-safety shape as member team channels: never a private pair, always
// the whole staff in the room.

migrate(
  (app) => {
    const groupsCol = app.findCollectionByNameOrId("groups");
    const channels = app.findCollectionByNameOrId("channels");
    channels.fields.add(
      new Field({ name: "group", type: "relation", collectionId: groupsCol.id, maxSelect: 1, cascadeDelete: true }),
    );

    const chMemberGate =
      "(member = '' || member.user = @request.auth.id || member.guardians.id ?= @request.auth.id || production.managers.id ?= @request.auth.id)";
    const chGroupGate =
      "(group = '' || group.members_via_groups.user ?= @request.auth.id || group.members_via_groups.guardians.id ?= @request.auth.id || production.managers.id ?= @request.auth.id)";
    channels.listRule =
      "(production = '' || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id) && " +
      chMemberGate + " && " + chGroupGate;
    channels.viewRule = channels.listRule;
    app.save(channels);

    const msgMemberGate =
      "(channel.member = '' || channel.member.user = @request.auth.id || channel.member.guardians.id ?= @request.auth.id || channel.production.managers.id ?= @request.auth.id)";
    const msgGroupGate =
      "(channel.group = '' || channel.group.members_via_groups.user ?= @request.auth.id || channel.group.members_via_groups.guardians.id ?= @request.auth.id || channel.production.managers.id ?= @request.auth.id)";
    const messages = app.findCollectionByNameOrId("messages");
    messages.listRule =
      "(channel.production = '' || channel.production.managers.id ?= @request.auth.id || channel.production.members_via_production.user ?= @request.auth.id) && " +
      msgMemberGate + " && " + msgGroupGate;
    messages.viewRule = messages.listRule;
    messages.createRule =
      "author = @request.auth.id && (channel.production = '' || channel.production.members_via_production.user ?= @request.auth.id || channel.production.managers.id ?= @request.auth.id) && " +
      msgMemberGate + " && " + msgGroupGate;
    app.save(messages);

    const rxMemberGate =
      "(message.channel.member = '' || message.channel.member.user = @request.auth.id || message.channel.member.guardians.id ?= @request.auth.id || message.channel.production.managers.id ?= @request.auth.id)";
    const rxGroupGate =
      "(message.channel.group = '' || message.channel.group.members_via_groups.user ?= @request.auth.id || message.channel.group.members_via_groups.guardians.id ?= @request.auth.id || message.channel.production.managers.id ?= @request.auth.id)";
    const reactions = app.findCollectionByNameOrId("reactions");
    reactions.listRule =
      "(message.channel.production = '' || message.channel.production.managers.id ?= @request.auth.id || message.channel.production.members_via_production.user ?= @request.auth.id) && " +
      rxMemberGate + " && " + rxGroupGate;
    reactions.viewRule = reactions.listRule;
    reactions.createRule =
      "user = @request.auth.id && (message.channel.production = '' || message.channel.production.members_via_production.user ?= @request.auth.id || message.channel.production.managers.id ?= @request.auth.id) && " +
      rxMemberGate + " && " + rxGroupGate;
    app.save(reactions);
  },
  (app) => {
    const channels = app.findCollectionByNameOrId("channels");
    channels.fields.removeByName("group");
    app.save(channels);
  },
);
