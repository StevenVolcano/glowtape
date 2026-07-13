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

// Everything an auditioner needs, in one call: the production's audition
// setup, the roles they can try out for, and the scheduled audition times.
// Auditioners usually aren't members, so this route (not collection rules)
// is how role names and audition events reach them — safe fields only.
routerAdd(
  "GET",
  "/api/glowtape/audition-info",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const productionId = e.request.url.query().get("production");
    let production;
    try {
      production = e.app.findRecordById("productions", productionId);
    } catch {
      throw new NotFoundError("Unknown production.");
    }
    const isManager = lib.toIdArray(production.get("managers")).includes(e.auth.id);
    if (!production.get("auditionOpen") && !isManager) {
      throw new NotFoundError("Auditions aren't open for this production.");
    }

    // Performer roles with names, not yet cast — what there is to audition for.
    const members = e.app.findRecordsByFilter(
      "members",
      "production = {:p} && role = 'performer' && position != '' && user = ''",
      "created",
      200,
      0,
      { p: production.id },
    );
    const roles = [];
    for (const m of members) {
      if (m.get("claimedFrom")) continue;
      const label = m.get("position") + (m.get("minor") ? " (young performer)" : "");
      if (!roles.includes(label)) roles.push(label);
    }

    const events = e.app.findRecordsByFilter(
      "events",
      "production = {:p} && kind ~ 'audition' && status != 'cancelled' && start >= {:from}",
      "start",
      20,
      0,
      { p: production.id, from: lib.pbNow(-24 * 3600e3) },
    );

    // The commitment being auditioned for: every performance, plus strike if
    // it's scheduled. The form asks signups to confirm they can make them all.
    const performances = e.app.findRecordsByFilter(
      "events",
      "production = {:p} && (kind ~ 'performance' || kind ~ 'strike') && status != 'cancelled' && start >= {:from}",
      "start",
      60,
      0,
      { p: production.id, from: lib.pbNow(-24 * 3600e3) },
    );

    const eventFields = (ev) => ({
      start: ev.get("start"),
      end: ev.get("end"),
      location: ev.get("location"),
      title: ev.get("title"),
      kind: ev.get("kind"),
    });

    return e.json(200, {
      open: !!production.get("auditionOpen"),
      title: production.get("title"),
      notes: production.get("auditionNotes"),
      questions: production.get("auditionQuestions") || [],
      roles,
      events: events.map(eventFields),
      performances: performances.map(eventFields),
    });
  },
  $apis.requireAuth(),
);
