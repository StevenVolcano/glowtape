/// <reference path="../pb_data/types.d.ts" />
//
// Operator ("Glow Tape Stagehand") access to every production.
//
// The operator flag (users.operator, migration 1754100000) already powers the
// operator console, feedback, requests, access codes, orgs, and companies.
// This migration extends it to production-scoped collections so the operator
// can step into any production for white-glove setup and troubleshooting —
// without being added as a member of each one.
//
// How: each listed rule gets `|| @request.auth.operator = true` appended.
// Create rules that bind identity (author = @request.auth.id) get an
// identity-preserving wrap instead, so the operator can never write a record
// attributed to someone else.
//
// !! POST-MORTEM (2026-07-22): the dynamic `c[prop]` access in the wrap loop
// below silently no-ops in PocketBase's JSVM — only the two direct
// assignments at the end (productions.createRule) actually applied. The
// wraps are re-applied correctly, with static property access, in
// 1757800000_operator_access_take2.js. This file stays as the historical
// record; NEVER use bracket-style dynamic property access on collection
// objects in migrations.
//
// Deliberately NOT wrapped:
// - annotations: personal script-room marks are private even from the
//   operator (and from directors) — that's a constitution rule.
// - profiles, channel_prefs, push_subscriptions, users: personal, not
//   production-scoped; nothing there is needed for setup help.
// - acks/announcement_acks/conflicts/bring_items creates: those bind to the
//   signed-in user; the operator has no reason to file them in someone
//   else's production.
// - messages.updateRule: nobody edits someone else's words, operator
//   included (delete-for-moderation is wrapped instead).

const OP = "@request.auth.operator = true";
const RULE_PROPS = {
  list: "listRule",
  view: "viewRule",
  create: "createRule",
  update: "updateRule",
  delete: "deleteRule",
};

// "w" = plain OR-wrap; "author" = wrap that keeps author = self.
const WRAP = {
  productions: { list: "w", view: "w", update: "w" },
  members: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  events: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  acks: { list: "w", view: "w" },
  conflicts: { list: "w", view: "w", update: "w", delete: "w" },
  channels: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  messages: { list: "w", view: "w", create: "author", delete: "w" },
  reactions: { list: "w", view: "w" },
  announcements: { list: "w", view: "w", create: "author", update: "w", delete: "w" },
  announcement_acks: { list: "w", view: "w" },
  attendance: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  tasks: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  tracker_items: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  auditions: { list: "w", view: "w", delete: "w" },
  resources: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  notes: { list: "w", view: "w", create: "author", update: "w", delete: "w" },
  units: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  cast_drafts: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  groups: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  line_notes: { list: "w", view: "w", create: "author", update: "w", delete: "w" },
  show_reports: { list: "w", view: "w", create: "author", update: "w", delete: "w" },
  timeline_templates: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  slots: { list: "w", view: "w", create: "w", update: "w", delete: "w" },
  bring_items: { list: "w", view: "w", update: "w", delete: "w" },
};

function suffixFor(kind) {
  return kind === "author"
    ? ` || (${OP} && author = @request.auth.id)`
    : ` || ${OP}`;
}

migrate(
  (app) => {
    for (const name of Object.keys(WRAP)) {
      const c = app.findCollectionByNameOrId(name);
      for (const key of Object.keys(WRAP[name])) {
        const prop = RULE_PROPS[key];
        const rule = c[prop];
        if (typeof rule !== "string" || rule === "") continue; // null = superuser-only, "" = public
        if (rule.includes("@request.auth.operator")) continue; // already operator-aware
        c[prop] = `(${rule})${suffixFor(WRAP[name][key])}`;
      }
      app.save(c);
    }
    // productions.createRule was null (superuser-only white-glove setup) —
    // the operator IS the white glove.
    const productions = app.findCollectionByNameOrId("productions");
    productions.createRule = OP;
    app.save(productions);
  },
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    if (productions.createRule === OP) productions.createRule = null;
    app.save(productions);
    for (const name of Object.keys(WRAP)) {
      const c = app.findCollectionByNameOrId(name);
      for (const key of Object.keys(WRAP[name])) {
        const prop = RULE_PROPS[key];
        const rule = c[prop];
        if (typeof rule !== "string") continue;
        const suffix = suffixFor(WRAP[name][key]);
        if (rule.startsWith("(") && rule.endsWith(suffix)) {
          c[prop] = rule.slice(1, rule.length - suffix.length - 1);
        }
      }
      app.save(c);
    }
  },
);
