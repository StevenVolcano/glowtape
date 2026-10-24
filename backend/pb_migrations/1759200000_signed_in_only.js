/// <reference path="../pb_data/types.d.ts" />
//
// Close the signed-out hole in the API rules (found 2026-10-24 while testing
// video check-ins).
//
// Unclaimed role rows (pre-cast roles, children) have user = ''. A request
// with no sign-in has @request.auth.id = '' too, so clauses like
// `production.members_via_production.user ?= @request.auth.id` or
// `member.user = @request.auth.id` MATCHED for anyone on the internet — the
// record API served members, events, messages, notes, tasks, children's
// conflicts and attendance to signed-out requests, and let them edit or
// delete unclaimed member rows. Every page of the app needs a sign-in, so
// every rule that mentions @request.auth now starts with
// `@request.auth.id != '' &&`. Public ("") and locked (null) rules are
// untouched, and video_requests/video_checkins were born guarded.
// Idempotent: rules already starting with the guard are skipped.
//
// Static dot access only and String()-coerced reads (gotcha #5). Future
// rule rewrites must keep the guard at the front.

const GUARD = "@request.auth.id != ''";

function guarded(rule) {
  if (rule === null || rule === undefined) return rule;
  const s = String(rule);
  if (s === "" || s.indexOf("@request.auth") === -1 || s.indexOf(GUARD) === 0) return rule;
  return `${GUARD} && (${s})`;
}

function unguarded(rule) {
  if (rule === null || rule === undefined) return rule;
  const s = String(rule);
  const head = `${GUARD} && (`;
  if (s.indexOf(head) === 0 && s.endsWith(")")) return s.slice(head.length, s.length - 1);
  return rule;
}

const NAMES = [
  "users", "orgs", "productions", "members", "events", "acks", "conflicts", "channels",
  "messages", "announcements", "announcement_acks", "channel_prefs", "reactions",
  "access_codes", "attendance", "tasks", "tracker_items", "profiles", "auditions",
  "resources", "feedback", "production_requests", "notes", "push_subscriptions", "units",
  "cast_drafts", "companies", "groups", "annotations", "line_notes", "show_reports",
  "timeline_templates", "slots", "bring_items", "mcp_tokens", "oauth_grants", "text_blasts",
  "passkeys",
];

function applyAll(app, transform) {
  for (const name of NAMES) {
    let c;
    try {
      c = app.findCollectionByNameOrId(name);
    } catch {
      continue;
    }
    c.listRule = transform(c.listRule);
    c.viewRule = transform(c.viewRule);
    c.createRule = transform(c.createRule);
    c.updateRule = transform(c.updateRule);
    c.deleteRule = transform(c.deleteRule);
    app.save(c);
  }
}

migrate(
  (app) => applyAll(app, guarded),
  (app) => applyAll(app, unguarded),
);
