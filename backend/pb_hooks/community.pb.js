/// <reference path="../pb_data/types.d.ts" />
//
// Community calendar: upcoming audition and performance events across ALL
// productions, for any signed-in user. Served as a route (not wider API
// rules) so only safe fields leave the server — no called lists, no notes,
// and production join codes stay private.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

routerAdd(
  "GET",
  "/api/glowtape/community-calendar",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const events = e.app.findRecordsByFilter(
      "events",
      "start >= {:from} && status != 'cancelled' && (kind ~ 'audition' || kind ~ 'performance')",
      "start",
      200,
      0,
      { from: lib.pbNow(-24 * 3600e3) },
    );
    const productionNames = {};
    const out = [];
    for (const ev of events) {
      const pid = String(ev.get("production"));
      if (!(pid in productionNames)) {
        try {
          const p = e.app.findRecordById("productions", pid);
          let orgName = "";
          try {
            orgName = e.app.findRecordById("orgs", p.get("org")).get("name");
          } catch {
            /* org gone */
          }
          productionNames[pid] = { title: p.get("title"), org: orgName, auditionOpen: !!p.get("auditionOpen") };
        } catch {
          productionNames[pid] = null;
        }
      }
      const prod = productionNames[pid];
      if (!prod) continue;
      out.push({
        id: ev.id,
        title: ev.get("title"),
        kind: ev.get("kind"),
        start: ev.get("start"),
        end: ev.get("end"),
        location: ev.get("location"),
        production: pid,
        productionTitle: prod.title,
        org: prod.org,
        auditionOpen: prod.auditionOpen,
      });
    }
    return e.json(200, { events: out });
  },
  $apis.requireAuth(),
);
