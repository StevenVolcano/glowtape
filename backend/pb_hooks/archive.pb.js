/// <reference path="../pb_data/types.d.ts" />
//
// Read-only enforcement for archived shows.
//
// When a production is archived it becomes a preserved record — no new or
// changed content inside it. These request guards block member/manager writes
// to a show's content collections while it's archived. They run only on API
// record requests (not internal cascades or server-side app.save()), so they
// never fight the app's own bookkeeping. Content edited only through a custom
// route (events, casting, slots, attendance, bios, contacts, team-channel,
// line-notes) instead calls lib.assertNotArchived() in that route.
//
// The resolution + archived check lives in glowtape_lib.js guardArchivedWrite:
// hook handlers run in isolated VMs where sibling top-level functions don't
// exist, so each handler require()s the lib inside its own body (gotcha #1).
//
// Deliberately NOT guarded: `productions` itself (so managers can unarchive),
// `channel_prefs` (muting is a personal setting), and anything not tied to a
// production. If you add a production-scoped collection, add it to GUARDED.

const GUARDED = [
  // direct `production` relation
  "members",
  "events",
  "conflicts",
  "tasks",
  "tracker_items",
  "notes",
  "resources",
  "units",
  "cast_drafts",
  "announcements",
  "channels",
  "auditions",
  "annotations",
  "line_notes",
  "groups",
  "slots",
  "show_reports",
  "bring_items",
  "timeline_templates",
  // resolved through a parent (event / announcement / channel / message)
  "acks",
  "attendance",
  "announcement_acks",
  "messages",
  "reactions",
];

onRecordCreateRequest((e) => {
  require(`${__hooks}/glowtape_lib.js`).guardArchivedWrite(e);
  e.next();
}, ...GUARDED);

onRecordUpdateRequest((e) => {
  require(`${__hooks}/glowtape_lib.js`).guardArchivedWrite(e);
  e.next();
}, ...GUARDED);

onRecordDeleteRequest((e) => {
  require(`${__hooks}/glowtape_lib.js`).guardArchivedWrite(e);
  e.next();
}, ...GUARDED);
