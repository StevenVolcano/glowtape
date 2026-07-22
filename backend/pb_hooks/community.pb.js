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

    // A company's ticket link, keyed by the org it's linked to (by relation
    // id, not name). A performance whose production sets its own ticketUrl
    // wins over this company-wide box office.
    const orgTicketUrls = {};
    try {
      const companies = e.app.findRecordsByFilter("companies", "ticketUrl != '' && org != ''", "name", 200, 0);
      for (const c of companies) {
        orgTicketUrls[String(c.get("org"))] = c.get("ticketUrl");
      }
    } catch {
      /* no companies with links */
    }

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
          productionNames[pid] = {
            title: p.get("title"),
            org: orgName,
            orgId: String(p.get("org")),
            ticketUrl: p.get("ticketUrl") || "",
            auditionOpen: !!p.get("auditionOpen"),
          };
        } catch {
          productionNames[pid] = null;
        }
      }
      const prod = productionNames[pid];
      if (!prod) continue;
      // Only performances sell tickets; auditions never carry a buy link.
      // A show's own link wins; otherwise fall back to the company box office.
      const isPerformance = String(ev.get("kind")).toLowerCase().indexOf("performance") !== -1;
      const ticketUrl = isPerformance
        ? prod.ticketUrl || orgTicketUrls[prod.orgId] || ""
        : "";
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
        ticketUrl: ticketUrl,
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
    const isManager = lib.canManage(production, e.auth);
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
    const seenRoles = {};
    for (const m of members) {
      if (m.get("claimedFrom")) continue;
      const label = m.get("position") + (m.get("minor") ? " (young performer)" : "");
      if (seenRoles[label]) continue;
      seenRoles[label] = true;
      roles.push({ name: label, notes: m.get("roleNotes") || "" });
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

    // Who's running the show — so auditioners know who they'll be working
    // with. Ordered by role (director first), not alphabetically. Only the
    // name and role leave the server; no contact details.
    const ROLE_RANK = { director: 0, asst_director: 1, stage_manager: 2 };
    const ROLE_LABEL = {
      director: "Director",
      asst_director: "Assistant Director",
      stage_manager: "Stage Manager",
      performer: "Performer",
      crew: "Crew",
    };
    const teamMembers = e.app.findRecordsByFilter(
      "members",
      "production = {:p} && role != 'guardian'",
      "created",
      200,
      0,
      { p: production.id },
    );
    const team = [];
    for (const m of teamMembers) {
      const roleKey = m.get("role");
      const isTeam = roleKey in ROLE_RANK || m.get("manager");
      if (!isTeam) continue;
      let name = "";
      if (m.get("user")) {
        try {
          name = e.app.findRecordById("users", m.get("user")).get("name");
        } catch {
          /* user gone */
        }
      } else {
        name = m.get("displayName") || "";
      }
      if (!name) continue; // an unclaimed staff placeholder has no person yet
      team.push({
        name: name,
        role: m.get("position") || ROLE_LABEL[roleKey] || "Production team",
        rank: roleKey in ROLE_RANK ? ROLE_RANK[roleKey] : 3,
      });
    }
    team.sort((a, b) => a.rank - b.rank);

    return e.json(200, {
      open: !!production.get("auditionOpen"),
      title: production.get("title"),
      writtenBy: production.get("writtenBy") || "",
      description: production.get("description") || "",
      notes: production.get("auditionNotes"),
      questions: production.get("auditionQuestions") || [],
      roles,
      team: team.map((t) => ({ name: t.name, role: t.role })),
      events: events.map(eventFields),
      performances: performances.map(eventFields),
    });
  },
  $apis.requireAuth(),
);
