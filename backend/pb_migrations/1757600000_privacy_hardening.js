/// <reference path="../pb_data/types.d.ts" />
//
// Privacy hardening from the roles audit (2026-07-22):
//
// 1. members.contactEmail / contactPhone become hidden fields. They were
//    manager-entered offline contacts but readable by every co-member,
//    partially defeating 1755500000's "contacts are production-team-only".
//    Managers now read them via GET /api/glowtape/contacts (offline map) and
//    write them via POST /api/glowtape/members/contact (contacts.pb.js).
// 2. users.ageBand / teenUntil become hidden. They were visible to every
//    signed-in user, letting anyone enumerate which accounts are minors.
//    The app reads its own band via GET /api/glowtape/me.
// 3. annotations: the production-wide scope opens to the operator (the
//    Stagehand's script-room tools silently failed on foreign productions).
//    PERSONAL annotations stay exactly as private as before — the personal
//    branch is untouched, on purpose, per the constitution.

const memberRead =
  "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
const OP = "@request.auth.operator = true";

const oldAnnotations = {
  listRule:
    "(scope = 'personal' && user = @request.auth.id) || (scope = 'production' && (" + memberRead + "))",
  createRule:
    "user = @request.auth.id && (" + memberRead + ") && (scope = 'personal' || production.managers.id ?= @request.auth.id)",
  updateRule:
    "user = @request.auth.id || (scope = 'production' && production.managers.id ?= @request.auth.id)",
  deleteRule:
    "user = @request.auth.id || (scope = 'production' && production.managers.id ?= @request.auth.id)",
};

const newAnnotations = {
  listRule:
    "(scope = 'personal' && user = @request.auth.id) || (scope = 'production' && (" +
    memberRead + " || " + OP + "))",
  createRule:
    "user = @request.auth.id && (" + memberRead + " || " + OP + ") && (scope = 'personal' || production.managers.id ?= @request.auth.id || " + OP + ")",
  updateRule:
    "user = @request.auth.id || (scope = 'production' && (production.managers.id ?= @request.auth.id || " + OP + "))",
  deleteRule:
    "user = @request.auth.id || (scope = 'production' && (production.managers.id ?= @request.auth.id || " + OP + "))",
};

function setHidden(app, collectionName, fieldNames, hidden) {
  const c = app.findCollectionByNameOrId(collectionName);
  for (const name of fieldNames) {
    const f = c.fields.getByName(name);
    if (f) f.hidden = hidden;
  }
  app.save(c);
}

migrate(
  (app) => {
    setHidden(app, "members", ["contactEmail", "contactPhone"], true);
    setHidden(app, "users", ["ageBand", "teenUntil"], true);

    const annotations = app.findCollectionByNameOrId("annotations");
    annotations.listRule = newAnnotations.listRule;
    annotations.viewRule = newAnnotations.listRule;
    annotations.createRule = newAnnotations.createRule;
    annotations.updateRule = newAnnotations.updateRule;
    annotations.deleteRule = newAnnotations.deleteRule;
    app.save(annotations);
  },
  (app) => {
    setHidden(app, "members", ["contactEmail", "contactPhone"], false);
    setHidden(app, "users", ["ageBand", "teenUntil"], false);

    const annotations = app.findCollectionByNameOrId("annotations");
    annotations.listRule = oldAnnotations.listRule;
    annotations.viewRule = oldAnnotations.listRule;
    annotations.createRule = oldAnnotations.createRule;
    annotations.updateRule = oldAnnotations.updateRule;
    annotations.deleteRule = oldAnnotations.deleteRule;
    app.save(annotations);
  },
);
