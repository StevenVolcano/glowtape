/// <reference path="../pb_data/types.d.ts" />
//
// Conflicts, two changes in one:
//
// 1. Conflicts become team-private. The old member-wide read rule let any
//    castmate read anyone's conflict rows (including notes like "doctor
//    appointment") — the UI never showed them, but the API served them.
//    Now: your own rows, rows about a member you are (or guard), managers,
//    operator. FindTime/alerts/EventForm warnings are manager surfaces, so
//    nothing member-facing changes.
// 2. conflicts.member (optional relation): a conflict ABOUT a member row
//    rather than the author — how a parent enters "soccer on Tuesdays" for
//    their child, who has no login. Guardians (both parents) and managers
//    can create/edit/remove them; matching consumers use conflictAppliesTo
//    in src/lib/conflicts.ts.

const OP = "@request.auth.operator = true";
const isMemberOrManager =
  "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";

const oldRules = {
  list: `(${isMemberOrManager}) || ${OP}`,
  create:
    "user = @request.auth.id && production.members_via_production.user ?= @request.auth.id",
  update: `(user = @request.auth.id) || ${OP}`,
  del: `(user = @request.auth.id) || ${OP}`,
};

const aboutMe =
  "(member != '' && (member.user = @request.auth.id || member.guardians.id ?= @request.auth.id))";
const newRules = {
  list: `user = @request.auth.id || ${aboutMe} || production.managers.id ?= @request.auth.id || ${OP}`,
  create:
    "user = @request.auth.id && (production.members_via_production.user ?= @request.auth.id || production.managers.id ?= @request.auth.id) && " +
    "(member = '' || (member.production = production && (member.user = @request.auth.id || member.guardians.id ?= @request.auth.id || production.managers.id ?= @request.auth.id)))",
  update: `user = @request.auth.id || ${aboutMe} || production.managers.id ?= @request.auth.id || ${OP}`,
  del: `user = @request.auth.id || ${aboutMe} || production.managers.id ?= @request.auth.id || ${OP}`,
};

migrate(
  (app) => {
    const conflicts = app.findCollectionByNameOrId("conflicts");
    const members = app.findCollectionByNameOrId("members");
    conflicts.fields.add(
      new Field({
        type: "relation",
        name: "member",
        collectionId: members.id,
        maxSelect: 1,
        cascadeDelete: true,
      }),
    );
    conflicts.listRule = newRules.list;
    conflicts.viewRule = newRules.list;
    conflicts.createRule = newRules.create;
    conflicts.updateRule = newRules.update;
    conflicts.deleteRule = newRules.del;
    app.save(conflicts);
  },
  (app) => {
    const conflicts = app.findCollectionByNameOrId("conflicts");
    conflicts.fields.removeByName("member");
    conflicts.listRule = oldRules.list;
    conflicts.viewRule = oldRules.list;
    conflicts.createRule = oldRules.create;
    conflicts.updateRule = oldRules.update;
    conflicts.deleteRule = oldRules.del;
    app.save(conflicts);
  },
);
