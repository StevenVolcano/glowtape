/// <reference path="../pb_data/types.d.ts" />
//
// Personal iCalendar feed: each user gets a secret URL listing every event
// they're called for, across all their productions. Subscribing to it in
// Google Calendar / Apple Calendar / Outlook keeps their own calendar in
// sync automatically (Google refreshes subscribed feeds slowly — hours, not
// minutes; Apple is usually faster).
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

// Get (or lazily create) the signed-in user's feed URL.
routerAdd(
  "GET",
  "/api/glowtape/calendar-url",
  (e) => {
    const user = e.app.findRecordById("users", e.auth.id);
    let token = user.get("calendarToken");
    if (!token) {
      token = $security.randomString(32);
      user.set("calendarToken", token);
      e.app.save(user);
    }
    let base = e.app.settings().meta.appURL || "";
    if (base.endsWith("/")) base = base.slice(0, -1);
    return e.json(200, { url: base + "/api/glowtape/cal/" + token + "/calls.ics" });
  },
  $apis.requireAuth(),
);

routerAdd("GET", "/api/glowtape/cal/{token}/calls.ics", (e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);

  const token = e.request.pathValue("token");
  if (!token || token.length < 16) throw new NotFoundError();

  let user;
  try {
    user = e.app.findFirstRecordByFilter("users", "calendarToken = {:t}", { t: token });
  } catch {
    throw new NotFoundError();
  }

  const memberships = e.app.findRecordsByFilter("members", "user = {:u}", "", 100, 0, {
    u: user.id,
  });

  const weekAgo = lib.pbNow(-7 * 86400e3);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Glow Tape//Calls//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + lib.icsEscape((user.get("name") || "My") + " — theater calls"),
  ];

  for (const m of memberships) {
    let production;
    try {
      production = e.app.findRecordById("productions", m.get("production"));
    } catch {
      continue;
    }

    // name -> address map from production + org preset places
    const placeAddr = {};
    const collect = (rawJson) => {
      try {
        const list = JSON.parse(String(rawJson || "[]"));
        if (Array.isArray(list)) {
          for (const it of list) {
            if (it && typeof it === "object" && it.name && it.address) {
              const key = String(it.name).toLowerCase();
              if (!(key in placeAddr)) placeAddr[key] = String(it.address);
            }
          }
        }
      } catch {
        /* older string-list shape or empty */
      }
    };
    collect(production.get("locations"));
    try {
      const org = e.app.findRecordById("orgs", production.get("org"));
      collect(org.get("locations"));
    } catch {
      /* no org */
    }

    const events = e.app.findRecordsByFilter(
      "events",
      "production = {:p} && start >= {:from}",
      "start",
      500,
      0,
      { p: production.id, from: weekAgo },
    );

    for (const ev of events) {
      const called = lib.toIdArray(ev.get("called"));
      if (
        called.length > 0 &&
        !called.includes(m.id) &&
        !called.includes(String(m.get("claimedFrom") || ""))
      )
        continue;

      const start = String(ev.get("start"));
      const end = ev.get("end") ? String(ev.get("end")) : null;
      const desc = [ev.get("calledNote"), ev.get("notes")].filter(Boolean).join("\n");

      lines.push("BEGIN:VEVENT");
      lines.push("UID:evt-" + ev.id + "@glowtape");
      lines.push("DTSTAMP:" + lib.icsDateFromMs(Date.now()));
      lines.push("DTSTART:" + lib.icsDate(start));
      lines.push(
        "DTEND:" +
          (end
            ? lib.icsDate(end)
            : lib.icsDateFromMs(new Date(start.replace(" ", "T")).getTime() + 2 * 3600e3)),
      );
      const cancelled = ev.get("status") === "cancelled";
      if (cancelled) lines.push("STATUS:CANCELLED");
      lines.push(
        "SUMMARY:" +
          lib.icsEscape(
            (cancelled ? "CANCELLED — " : "") + ev.get("title") + " — " + production.get("title"),
          ),
      );
      if (ev.get("location")) {
        const locName = String(ev.get("location"));
        const addr = placeAddr[locName.toLowerCase()];
        lines.push("LOCATION:" + lib.icsEscape(addr ? locName + ", " + addr : locName));
      }
      if (desc) lines.push("DESCRIPTION:" + lib.icsEscape(desc));
      lines.push("END:VEVENT");
    }
  }

  lines.push("END:VCALENDAR");
  const ics = lines.join("\r\n") + "\r\n";

  e.response.header().set("Content-Disposition", 'inline; filename="calls.ics"');
  return e.blob(200, "text/calendar; charset=utf-8", toBytes(ics));
});
