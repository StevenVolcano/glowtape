/// <reference path="../pb_data/types.d.ts" />
//
// Task assignment email: when a task is created with an assignee (or an
// assignee is added later), that member — or a child assignee's guardians —
// gets one email. Completion and other edits stay quiet.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const assignee = e.record.get("assignee");
    if (!assignee) {
      e.next();
      return;
    }
    const production = e.app.findRecordById("productions", e.record.get("production"));
    const to = lib.recipients(e.app, production.id, [assignee]);
    const due = e.record.get("due")
      ? `<p>Due: ${lib.formatPacific(e.record.get("due")).split(",")[0]}</p>`
      : "";
    lib.sendMail(
      e.app,
      to,
      `[${production.get("title")}] Task for you: ${e.record.get("title")}`,
      [
        `<h2>${e.record.get("title")}</h2>`,
        `<p><strong>${production.get("title")}</strong>${
          e.record.get("department") ? " — " + e.record.get("department") : ""
        }</p>`,
        due,
        `<p>Open Glow Tape's To-Do tab and check it off when it's handled.</p>`,
      ].join("\n"),
    );
  } catch (err) {
    e.app.logger().error("glowtape: task mail failed", "error", String(err));
  }
  e.next();
}, "tasks");

onRecordAfterUpdateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const original = e.record.original();
    const assignee = e.record.get("assignee");
    if (assignee && assignee !== original.get("assignee") && !e.record.get("done")) {
      const production = e.app.findRecordById("productions", e.record.get("production"));
      const to = lib.recipients(e.app, production.id, [assignee]);
      lib.sendMail(
        e.app,
        to,
        `[${production.get("title")}] Task for you: ${e.record.get("title")}`,
        [
          `<h2>${e.record.get("title")}</h2>`,
          `<p><strong>${production.get("title")}</strong>${
            e.record.get("department") ? " — " + e.record.get("department") : ""
          }</p>`,
          `<p>Open Glow Tape's To-Do tab and check it off when it's handled.</p>`,
        ].join("\n"),
      );
    }
  } catch (err) {
    e.app.logger().error("glowtape: task reassign mail failed", "error", String(err));
  }
  e.next();
}, "tasks");

// --- "This production needs bios" -----------------------------------------------
// Creates one bio task per cast/crew member who hasn't written one yet
// (guardians get the child's). The task-create hook above emails each.

routerAdd(
  "POST",
  "/api/glowtape/bios/request",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ production: "", due: "", audience: "" });
    e.bindBody(data);
    const audience = data.audience || "everyone"; // performers | team | everyone

    let production;
    try {
      production = e.app.findRecordById("productions", data.production);
    } catch {
      throw new BadRequestError("Unknown production.");
    }
    if (!lib.canManage(production, e.auth)) {
      throw new BadRequestError("Only the production team can request bios.");
    }

    const members = e.app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
      p: production.id,
    });
    const existing = e.app.findRecordsByFilter(
      "tasks",
      "production = {:p} && kind = 'bio'",
      "",
      500,
      0,
      { p: production.id },
    );
    const alreadyAsked = new Set();
    for (const t of existing) alreadyAsked.add(String(t.get("assignee")));

    const col = e.app.findCollectionByNameOrId("tasks");
    let created = 0;
    const STAFF = ["director", "asst_director", "stage_manager"];
    for (const m of members) {
      if (m.get("role") === "guardian") continue; // guardians write the child's, not their own
      if (m.get("multi") && !m.get("user")) continue; // shared-role template
      if (!m.get("user") && !m.get("minor")) continue; // uncast role, nobody to ask
      if (audience === "performers" && m.get("role") !== "performer") continue;
      if (audience === "team" && !STAFF.includes(m.get("role")) && !m.get("manager")) continue;
      if (String(m.get("bio") || "").trim()) continue; // already written
      if (alreadyAsked.has(m.id)) continue; // already asked

      const who = m.get("minor") && m.get("displayName") ? m.get("displayName") + "'s" : "your";
      const t = new Record(col);
      t.set("production", production.id);
      t.set("title", "Write " + who + " program bio");
      t.set("department", "Publicity");
      t.set("assignee", m.id);
      t.set("kind", "bio");
      if (data.due) t.set("due", data.due);
      e.app.save(t);
      created++;
    }

    return e.json(200, { ok: true, created });
  },
  $apis.requireAuth(),
);
