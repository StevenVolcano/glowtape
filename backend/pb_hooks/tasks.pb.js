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
