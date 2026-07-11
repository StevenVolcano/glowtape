/// <reference path="../pb_data/types.d.ts" />
//
// Initial Glow Tape schema. Applied automatically when PocketBase starts.
//
// Structure first, rules second: PocketBase validates API rules when a
// collection is saved, and several rules use the `members_via_production`
// back-relation — which only resolves once the members collection exists.
// So every collection is created with rules unset (superuser-only), and all
// rules are applied in a final pass at the end.
//
// Authorization model (MVP):
// - `productions.managers` is a denormalized list of user ids (directors,
//   ADs, stage managers) kept in sync by the app when members are edited.
//   Rules check membership via back-relations and management via `managers`.
// - All members of a production can read all of its channels; audience
//   filtering (cast/crew/team) is applied in the UI for the pilot.

const MEMBER_ROLES = ["director", "asst_director", "stage_manager", "performer", "crew"];

migrate(
  (app) => {
    // --- users (built-in auth collection): add phone, enable OTP login ---
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(
      new Field({ name: "phone", type: "text", max: 40 }),
    );
    users.otp.enabled = true;
    users.otp.duration = 300;
    users.otp.length = 6;
    app.save(users);

    // --- structure pass: collections without API rules ---

    const orgs = new Collection({
      type: "base",
      name: "orgs",
      fields: [
        { type: "text", name: "name", required: true, max: 120 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
    });
    app.save(orgs);

    const productions = new Collection({
      type: "base",
      name: "productions",
      fields: [
        { type: "relation", name: "org", collectionId: orgs.id, maxSelect: 1, cascadeDelete: false },
        { type: "text", name: "title", required: true, max: 200 },
        {
          type: "select",
          name: "status",
          values: ["planning", "rehearsal", "performance", "closed"],
          maxSelect: 1,
        },
        { type: "text", name: "joinCode", max: 20 },
        { type: "relation", name: "managers", collectionId: users.id, maxSelect: 99, cascadeDelete: false },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
    });
    app.save(productions);

    const members = new Collection({
      type: "base",
      name: "members",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "select", name: "role", values: MEMBER_ROLES, required: true, maxSelect: 1 },
        // Free-text label shown on the contact sheet: "Ophelia", "Props", "Light board op"
        { type: "text", name: "position", max: 200 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_members_unique ON members (production, user)"],
    });
    app.save(members);

    const events = new Collection({
      type: "base",
      name: "events",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "title", required: true, max: 200 },
        { type: "date", name: "start", required: true },
        { type: "date", name: "end" },
        { type: "text", name: "location", max: 200 },
        { type: "text", name: "notes", max: 2000 },
        // Who is called. Empty = everyone. calledNote covers granularity
        // ("dancers at 6, full cast at 7").
        { type: "relation", name: "called", collectionId: members.id, maxSelect: 999, cascadeDelete: false },
        { type: "text", name: "calledNote", max: 500 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
    });
    app.save(events);

    const acks = new Collection({
      type: "base",
      name: "acks",
      fields: [
        { type: "relation", name: "event", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_acks_unique ON acks (event, user)"],
    });
    app.save(acks);

    const conflicts = new Collection({
      type: "base",
      name: "conflicts",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "date", name: "start", required: true },
        { type: "date", name: "end" },
        { type: "text", name: "note", max: 500 },
        { type: "autodate", name: "created", onCreate: true },
      ],
    });
    app.save(conflicts);

    const channels = new Collection({
      type: "base",
      name: "channels",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 100 },
        { type: "select", name: "audience", values: ["all", "cast", "crew", "team"], required: true, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
      ],
    });
    app.save(channels);

    const messages = new Collection({
      type: "base",
      name: "messages",
      fields: [
        { type: "relation", name: "channel", collectionId: channels.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "author", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: false },
        { type: "text", name: "text", required: true, max: 4000 },
        { type: "autodate", name: "created", onCreate: true },
      ],
    });
    app.save(messages);

    const announcements = new Collection({
      type: "base",
      name: "announcements",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "author", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: false },
        { type: "text", name: "title", required: true, max: 200 },
        { type: "text", name: "body", max: 8000 },
        { type: "bool", name: "pinned" },
        { type: "autodate", name: "created", onCreate: true },
      ],
    });
    app.save(announcements);

    const aAcks = new Collection({
      type: "base",
      name: "announcement_acks",
      fields: [
        { type: "relation", name: "announcement", collectionId: announcements.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_announcement_acks_unique ON announcement_acks (announcement, user)",
      ],
    });
    app.save(aAcks);

    // --- rules pass: every collection now exists, back-relations resolve ---

    const setRules = (name, rules) => {
      const c = app.findCollectionByNameOrId(name);
      c.listRule = rules.list;
      c.viewRule = rules.view;
      c.createRule = rules.create;
      c.updateRule = rules.update;
      c.deleteRule = rules.del;
      app.save(c);
    };

    const isMemberOrManager =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";

    setRules("orgs", {
      list: "@request.auth.id != ''",
      view: "@request.auth.id != ''",
      create: null, // superuser only (org admin UI later)
      update: null,
      del: null,
    });

    setRules("productions", {
      list: "@request.auth.id != '' && (managers.id ?= @request.auth.id || members_via_production.user ?= @request.auth.id)",
      view: "@request.auth.id != '' && (managers.id ?= @request.auth.id || members_via_production.user ?= @request.auth.id)",
      create: null, // superuser creates productions during white-glove setup
      update: "managers.id ?= @request.auth.id",
      del: null,
    });

    setRules("members", {
      list: isMemberOrManager,
      view: isMemberOrManager,
      create: "production.managers.id ?= @request.auth.id",
      update: "production.managers.id ?= @request.auth.id",
      del: "production.managers.id ?= @request.auth.id || user = @request.auth.id",
    });

    setRules("events", {
      list: isMemberOrManager,
      view: isMemberOrManager,
      create: "production.managers.id ?= @request.auth.id",
      update: "production.managers.id ?= @request.auth.id",
      del: "production.managers.id ?= @request.auth.id",
    });

    setRules("acks", {
      list: "event.production.managers.id ?= @request.auth.id || event.production.members_via_production.user ?= @request.auth.id",
      view: "event.production.managers.id ?= @request.auth.id || event.production.members_via_production.user ?= @request.auth.id",
      create: "user = @request.auth.id && event.production.members_via_production.user ?= @request.auth.id",
      update: null,
      del: "user = @request.auth.id",
    });

    setRules("conflicts", {
      list: isMemberOrManager,
      view: isMemberOrManager,
      create: "user = @request.auth.id && production.members_via_production.user ?= @request.auth.id",
      update: "user = @request.auth.id",
      del: "user = @request.auth.id",
    });

    setRules("channels", {
      list: isMemberOrManager,
      view: isMemberOrManager,
      create: "production.managers.id ?= @request.auth.id",
      update: "production.managers.id ?= @request.auth.id",
      del: "production.managers.id ?= @request.auth.id",
    });

    setRules("messages", {
      list: "channel.production.managers.id ?= @request.auth.id || channel.production.members_via_production.user ?= @request.auth.id",
      view: "channel.production.managers.id ?= @request.auth.id || channel.production.members_via_production.user ?= @request.auth.id",
      create: "author = @request.auth.id && channel.production.members_via_production.user ?= @request.auth.id",
      update: "author = @request.auth.id",
      del: "author = @request.auth.id || channel.production.managers.id ?= @request.auth.id",
    });

    setRules("announcements", {
      list: isMemberOrManager,
      view: isMemberOrManager,
      create: "author = @request.auth.id && production.managers.id ?= @request.auth.id",
      update: "production.managers.id ?= @request.auth.id",
      del: "production.managers.id ?= @request.auth.id",
    });

    setRules("announcement_acks", {
      list: "announcement.production.managers.id ?= @request.auth.id || announcement.production.members_via_production.user ?= @request.auth.id",
      view: "announcement.production.managers.id ?= @request.auth.id || announcement.production.members_via_production.user ?= @request.auth.id",
      create: "user = @request.auth.id && announcement.production.members_via_production.user ?= @request.auth.id",
      update: null,
      del: "user = @request.auth.id",
    });
  },
  (app) => {
    for (const name of [
      "announcement_acks",
      "announcements",
      "messages",
      "channels",
      "conflicts",
      "acks",
      "events",
      "members",
      "productions",
      "orgs",
    ]) {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    }
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("phone");
    app.save(users);
  },
);
