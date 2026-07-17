/// <reference path="../pb_data/types.d.ts" />
//
// Nightly rehearsal report: at 10pm Pacific, every production that had events
// today gets one email to its managers — roll call per event, late/absent
// names, overdue tasks, and any notes written today. No events today = no
// email.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

cronAdd("glowtape_rehearsal_reports", "0 * * * *", () => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  if (lib.pacificHour() !== 22) return;

  // Today's window, in UTC, aligned to the Pacific calendar day.
  const nowMs = Date.now();
  const off = lib.pacificOffsetHours(nowMs);
  const local = new Date(nowMs - off * 3600e3);
  const dayStartMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + off * 3600e3;
  const fmt = (ms) => new Date(ms).toISOString().replace("T", " ");
  const from = fmt(dayStartMs);
  const to = fmt(dayStartMs + 24 * 3600e3);

  const events = $app.findRecordsByFilter(
    "events",
    "start >= {:from} && start < {:to} && status != 'cancelled'",
    "start",
    200,
    0,
    { from, to },
  );
  if (events.length === 0) return;

  const byProduction = {};
  for (const ev of events) {
    const pid = String(ev.get("production"));
    (byProduction[pid] = byProduction[pid] || []).push(ev);
  }

  for (const pid of Object.keys(byProduction)) {
    try {
      const production = $app.findRecordById("productions", pid);
      const contacts = lib.managerContacts($app, production);
      if (contacts.emails.length === 0) continue;

      const members = $app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
        p: pid,
      });
      const nameOf = (memberId) => {
        const m = members.find((x) => x.id === memberId);
        if (!m) return "someone";
        if (m.get("displayName")) return m.get("displayName");
        if (m.get("user")) {
          try {
            return $app.findRecordById("users", m.get("user")).get("name");
          } catch {
            /* fall through */
          }
        }
        return m.get("position") || "someone";
      };

      const sections = [];
      for (const ev of byProduction[pid]) {
        const rows = $app.findRecordsByFilter("attendance", "event = {:ev}", "", 500, 0, {
          ev: ev.id,
        });
        const count = (s) => rows.filter((r) => r.get("status") === s).length;
        const names = (s) =>
          rows
            .filter((r) => r.get("status") === s)
            .map((r) => {
              const note = r.get("note");
              return nameOf(String(r.get("member"))) + (note ? ` (${note})` : "");
            })
            .join(", ");
        sections.push(
          [
            `<h3>${ev.get("title")} — ${lib.formatPacific(ev.get("start"))}</h3>`,
            rows.length === 0
              ? `<p>No roll call taken.</p>`
              : `<p>${count("present")} present · ${count("late")} late · ${count("absent")} absent</p>` +
                (count("late") ? `<p>Late: ${names("late")}</p>` : "") +
                (count("absent") ? `<p>Absent: ${names("absent")}</p>` : ""),
          ].join("\n"),
        );
      }

      const overdue = $app.findRecordsByFilter(
        "tasks",
        "production = {:p} && done = false && due != '' && due < {:now}",
        "due",
        10,
        0,
        { p: pid, now: lib.pbNow(0) },
      );
      if (overdue.length > 0) {
        sections.push(
          `<h3>Overdue to-dos</h3><ul>${overdue
            .map(
              (t) =>
                `<li>${t.get("title")}${
                  t.get("assignee") ? " — " + nameOf(String(t.get("assignee"))) : ""
                }</li>`,
            )
            .join("")}</ul>`,
        );
      }

      const todaysNotes = $app.findRecordsByFilter(
        "notes",
        "production = {:p} && updated >= {:from}",
        "-updated",
        10,
        0,
        { p: pid, from },
      );
      if (todaysNotes.length > 0) {
        sections.push(
          `<h3>Notes from today</h3><ul>${todaysNotes
            .map((n) => `<li>${n.get("title")}</li>`)
            .join("")}</ul>`,
        );
      }

      // Line notes given today, tallied per person (open count matters most).
      const todaysLineNotes = $app.findRecordsByFilter(
        "line_notes",
        "production = {:p} && created >= {:from}",
        "created",
        200,
        0,
        { p: pid, from },
      );
      if (todaysLineNotes.length > 0) {
        const perMember = {};
        for (const ln of todaysLineNotes) {
          const mid = String(ln.get("member"));
          if (!perMember[mid]) perMember[mid] = { total: 0, open: 0 };
          perMember[mid].total++;
          if (!ln.get("done")) perMember[mid].open++;
        }
        const rows = [];
        for (const mid of Object.keys(perMember)) {
          let who = "someone";
          try {
            const m = $app.findRecordById("members", mid);
            who = m.get("displayName") || m.get("position") || "someone";
            if (m.get("user")) {
              try {
                who = $app.findRecordById("users", m.get("user")).get("name") || who;
              } catch {
                /* keep */
              }
            }
          } catch {
            /* keep */
          }
          const c = perMember[mid];
          rows.push(`<li>${who}: ${c.total} note${c.total === 1 ? "" : "s"}${c.open ? ` (${c.open} still open)` : " — all cleared"}</li>`);
        }
        sections.push(`<h3>Line notes given today</h3><ul>${rows.join("")}</ul>`);
      }

      lib.sendMail(
        $app,
        contacts.emails,
        `[${production.get("title")}] Rehearsal report — ${lib
          .formatPacific(fmt(dayStartMs + 12 * 3600e3))
          .split(",")[0]}`,
        [
          `<h2>${production.get("title")} — today's report</h2>`,
          ...sections,
          `<p>Sent automatically each night there's something on the schedule. Full details are on the Manage tab.</p>`,
        ].join("\n"),
      );
    } catch (err) {
      $app.logger().error("glowtape: rehearsal report failed", "production", pid, "error", String(err));
    }
  }
});
