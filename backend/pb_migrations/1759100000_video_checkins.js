/// <reference path="../pb_data/types.d.ts" />
//
// Video check-ins: a manager asks for a short video ("Your dialect lines,
// Act 1"); each asked actor records one in the app (3-minute cap, enforced
// client-side; the file-size cap is the server-side backstop) and the
// reviewers watch it and leave coaching notes.
//
// Who sees a video: managers + operator, the actor (and their guardians),
// and the members of the request's reviewer group — so a dialect coach in
// the "Production team" group can review without Manage access. Castmates
// never see each other's videos.
//
// video_checkins has a FIXED collection id so its files live at
// pb_data/storage/videocheckins00 — deploy/glowtape-backup excludes that
// folder (videos are big and short-lived; Steven 2026-10-24). The file field
// is protected: plain URLs 404, the app fetches a token first.

const OP = "@request.auth.operator = true";
const MANAGER = "production.managers.id ?= @request.auth.id";
// Unclaimed role rows have user = '', so a signed-out request would match
// `...user ?= @request.auth.id` clauses — every rule starts with this.
const SIGNED_IN = "@request.auth.id != ''";

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const members = app.findCollectionByNameOrId("members");
    const groups = app.findCollectionByNameOrId("groups");
    const users = app.findCollectionByNameOrId("users");

    const requests = new Collection({
      type: "base",
      name: "video_requests",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "title", required: true, max: 120 },
        { type: "text", name: "instructions", max: 2000 },
        { type: "date", name: "due" },
        // empty = every performer in the show
        { type: "relation", name: "members", collectionId: members.id, maxSelect: 500 },
        // members of this group can watch + give notes (managers always can)
        { type: "relation", name: "reviewGroup", collectionId: groups.id, maxSelect: 1 },
        { type: "bool", name: "closed" },
        { type: "relation", name: "author", collectionId: users.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
    });
    app.save(requests);

    const checkins = new Collection({
      id: "videocheckins00",
      type: "base",
      name: "video_checkins",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "request", collectionId: requests.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "member", collectionId: members.id, required: true, maxSelect: 1, cascadeDelete: true },
        {
          type: "file",
          name: "video",
          required: true,
          maxSelect: 1,
          maxSize: 300 * 1024 * 1024,
          mimeTypes: ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v", "video/3gpp", "video/x-matroska"],
          protected: true,
        },
        { type: "number", name: "seconds", min: 0 },
        { type: "relation", name: "uploadedBy", collectionId: users.id, maxSelect: 1 },
        { type: "text", name: "feedback", max: 4000 },
        { type: "bool", name: "reviewed" },
        { type: "relation", name: "feedbackBy", collectionId: users.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_video_checkins_req_member ON video_checkins (request, member)"],
    });
    app.save(checkins);

    // rules last — they reference back-relations (gotcha #3)
    const r = app.findCollectionByNameOrId("video_requests");
    const inShow =
      `${MANAGER} || production.members_via_production.user ?= @request.auth.id || ` +
      `production.members_via_production.guardians.id ?= @request.auth.id || ${OP}`;
    r.listRule = `${SIGNED_IN} && (${inShow})`;
    r.viewRule = `${SIGNED_IN} && (${inShow})`;
    r.createRule = `${SIGNED_IN} && (${MANAGER} || ${OP})`;
    r.updateRule = `${SIGNED_IN} && (${MANAGER} || ${OP})`;
    r.deleteRule = `${SIGNED_IN} && (${MANAGER} || ${OP})`;
    app.save(r);

    const c = app.findCollectionByNameOrId("video_checkins");
    const own = "member.user = @request.auth.id || member.guardians.id ?= @request.auth.id";
    const reviewer = "request.reviewGroup.members_via_groups.user ?= @request.auth.id";
    const canSee = `${SIGNED_IN} && (${MANAGER} || ${own} || ${reviewer} || ${OP})`;
    c.listRule = canSee;
    c.viewRule = canSee;
    c.createRule =
      `${SIGNED_IN} && uploadedBy = @request.auth.id && (${own}) && member.production = production && ` +
      "request.production = production && request.closed = false";
    // which fields each side may change is policed in videos.pb.js
    c.updateRule = canSee;
    c.deleteRule = `${SIGNED_IN} && (${MANAGER} || ${own} || ${OP})`;
    app.save(c);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("video_checkins"));
    app.delete(app.findCollectionByNameOrId("video_requests"));
  },
);
