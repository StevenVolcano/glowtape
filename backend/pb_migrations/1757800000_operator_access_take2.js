/// <reference path="../pb_data/types.d.ts" />
//
// Operator ("Glow Tape Stagehand") access, take 2.
//
// 1757400000 intended to append `|| @request.auth.operator = true` to
// production-scoped collection rules, but its wrap loop used dynamic
// bracket access (`c[prop]`) which silently no-ops on collection objects in
// PocketBase's JSVM — only its two direct assignments applied
// (productions.createRule). This migration applies the same wraps with
// static property access, guarded so it's a no-op anywhere a rule is
// already operator-aware. Collections whose rules were REWRITTEN with
// operator clauses baked in by later migrations (channels/messages/
// reactions in 1757500000, annotations in 1757600000, conflicts in
// 1757700000) are skipped, as are groups.update/delete (1757500000).
// annotations stays personal-private by design. On a fresh database this
// runs after all of the above and converges to the same state.

const OP = "@request.auth.operator = true";

function wrapped(rule, kind) {
  if (rule === null || rule === undefined) return rule;
  const s = String(rule);
  if (s === "" || s.includes("@request.auth.operator")) return rule;
  return kind === "author"
    ? `(${s}) || (${OP} && author = @request.auth.id)`
    : `(${s}) || ${OP}`;
}

function unwrapped(rule, kind) {
  if (rule === null || rule === undefined) return rule;
  const s = String(rule);
  const suffix =
    kind === "author" ? ` || (${OP} && author = @request.auth.id)` : ` || ${OP}`;
  if (s.startsWith("(") && s.endsWith(suffix)) {
    return s.slice(1, s.length - suffix.length - 1);
  }
  return rule;
}

// spec values: "w" plain wrap, "author" identity-preserving create wrap.
// Only static dot access below — see the post-mortem in 1757400000.
function applyAll(app, specs, transform) {
  for (const [name, spec] of specs) {
    const c = app.findCollectionByNameOrId(name);
    if (spec.list) c.listRule = transform(c.listRule, spec.list);
    if (spec.view) c.viewRule = transform(c.viewRule, spec.view);
    if (spec.create) c.createRule = transform(c.createRule, spec.create);
    if (spec.update) c.updateRule = transform(c.updateRule, spec.update);
    if (spec.delete) c.deleteRule = transform(c.deleteRule, spec.delete);
    app.save(c);
  }
}

const SPECS = [
  ["productions", { list: "w", view: "w", update: "w" }],
  ["members", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["events", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["acks", { list: "w", view: "w" }],
  ["announcements", { list: "w", view: "w", create: "author", update: "w", delete: "w" }],
  ["announcement_acks", { list: "w", view: "w" }],
  ["attendance", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["tasks", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["tracker_items", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["auditions", { list: "w", view: "w", delete: "w" }],
  ["resources", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["notes", { list: "w", view: "w", create: "author", update: "w", delete: "w" }],
  ["units", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["cast_drafts", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["groups", { list: "w", view: "w", create: "w" }],
  ["line_notes", { list: "w", view: "w", create: "author", update: "w", delete: "w" }],
  ["show_reports", { list: "w", view: "w", create: "author", update: "w", delete: "w" }],
  ["timeline_templates", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["slots", { list: "w", view: "w", create: "w", update: "w", delete: "w" }],
  ["bring_items", { list: "w", view: "w", update: "w", delete: "w" }],
];

migrate(
  (app) => {
    applyAll(app, SPECS, wrapped);
    // productions.createRule was already set to OP by 1757400000's direct
    // assignment; re-assert defensively (String() coercion — rule values
    // may come back as wrapped objects, never trust typeof here).
    const productions = app.findCollectionByNameOrId("productions");
    const cr = productions.createRule;
    if (cr === null || cr === undefined || String(cr) === "") {
      productions.createRule = OP;
    }
    app.save(productions);
  },
  (app) => {
    applyAll(app, SPECS, unwrapped);
    const productions = app.findCollectionByNameOrId("productions");
    if (String(productions.createRule) === OP) productions.createRule = null;
    app.save(productions);
  },
);
