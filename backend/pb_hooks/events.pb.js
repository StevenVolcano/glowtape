/// <reference path="../pb_data/types.d.ts" />
//
// Event creation (single + bulk) and change semantics.
//
// Creation goes through a custom route so bulk scheduling can send ONE
// summary email instead of one per event. Updates go through the normal
// record API; the update hook below enforces the change semantics:
//   - date/time/location changed -> reset "Got it" acks, re-arm reminders,
//     email everyone called about the change
//   - status flipped to cancelled -> cancellation email, clear reminders
//   - title/notes/called-only edits stay silent
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

routerAdd(
  "POST",
  "/api/glowtape/events",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({
      production: "",
      title: "",
      kind: "",
      location: "",
      notes: "",
      calledNote: "",
      called: [],
      units: [],
      calledGroups: [],
      bringCategories: [],
      // one entry per event: { start: ISO string, end: ISO string or "" }
      occurrences: [],
    });
    e.bindBody(data);

    if (!data.title.trim()) throw new BadRequestError("The event needs a title.");
    const occurrences = data.occurrences || [];
    if (occurrences.length === 0) throw new BadRequestError("Pick at least one date.");
    if (occurrences.length > 60) throw new BadRequestError("That's more than 60 events — split it up.");

    let production;
    try {
      production = e.app.findRecordById("productions", data.production);
    } catch {
      throw new BadRequestError("Unknown production.");
    }
    if (!lib.canManage(production, e.auth)) {
      throw new BadRequestError("Only the production team can add to the schedule.");
    }
    if (production.get("archived")) {
      throw new BadRequestError("This show is archived (read-only). Unarchive it in Manage to add events.");
    }

    const collection = e.app.findCollectionByNameOrId("events");
    const created = [];
    for (const occ of occurrences) {
      const rec = new Record(collection);
      rec.set("production", production.id);
      rec.set("title", data.title.trim());
      rec.set("kind", data.kind || "");
      rec.set("start", occ.start);
      rec.set("end", occ.end || "");
      rec.set("location", data.location);
      rec.set("notes", data.notes);
      rec.set("calledNote", data.calledNote);
      rec.set("called", lib.toIdArray(data.called));
      rec.set("units", lib.toIdArray(data.units));
      rec.set("calledGroups", lib.toIdArray(data.calledGroups));
      rec.set("bringCategories", lib.toIdArray(data.bringCategories));
      rec.set("status", "scheduled");
      e.app.save(rec);
      created.push(rec);
    }

    // Mail: one event -> detailed email; a series -> one summary email.
    try {
      const to = lib.recipients(e.app, production.id, data.called);
      if (created.length === 1) {
        const ev = created[0];
        const lines = [
          `<h2>${ev.get("title")}</h2>`,
          `<p><strong>${production.get("title")}</strong></p>`,
          `<p>When: ${lib.formatPacific(ev.get("start"))} (Pacific)</p>`,
          ev.get("location") ? `<p>Where: ${ev.get("location")}</p>` : "",
          ev.get("calledNote") ? `<p>Called: ${ev.get("calledNote")}</p>` : "",
          ev.get("notes") ? `<p>${ev.get("notes")}</p>` : "",
          `<p>Open Glow Tape to tap "Got it" so your stage manager knows you saw this.</p>`,
        ];
        lib.sendMail(
          e.app,
          to,
          `[${production.get("title")}] New on the schedule: ${ev.get("title")}`,
          lines.join("\n"),
        );
      } else {
        const items = created
          .map((ev) => `<li>${lib.formatPacific(ev.get("start"))}</li>`)
          .join("\n");
        const lines = [
          `<h2>${data.title.trim()} — ${created.length} dates</h2>`,
          `<p><strong>${production.get("title")}</strong></p>`,
          data.location ? `<p>Where: ${data.location}</p>` : "",
          data.calledNote ? `<p>Called: ${data.calledNote}</p>` : "",
          `<ul>${items}</ul>`,
          `<p>All times Pacific. Open Glow Tape to see the full schedule and tap "Got it" on each.</p>`,
        ];
        lib.sendMail(
          e.app,
          to,
          `[${production.get("title")}] ${created.length} new events: ${data.title.trim()}`,
          lines.join("\n"),
        );
      }
    } catch (err) {
      e.app.logger().error("glowtape: event mail failed", "error", String(err));
    }

    return e.json(200, { ok: true, created: created.length });
  },
  $apis.requireAuth(),
);

// --- change semantics on update -------------------------------------------------

onRecordAfterUpdateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const original = e.record.original();
    const becameCancelled =
      e.record.get("status") === "cancelled" && original.get("status") !== "cancelled";
    if (becameCancelled) {
      const production = e.app.findRecordById("productions", e.record.get("production"));
      const to = lib.recipients(e.app, production.id, e.record.get("called"));
      const rows = e.app.findRecordsByFilter("reminders_sent", "event = {:ev}", "", 500, 0, {
        ev: e.record.id,
      });
      for (const r of rows) e.app.delete(r);
      lib.sendMail(
        e.app,
        to,
        `[${production.get("title")}] CANCELLED: ${e.record.get("title")}`,
        [
          `<h2>Cancelled: ${e.record.get("title")}</h2>`,
          `<p><strong>${production.get("title")}</strong></p>`,
          `<p>Was: ${lib.formatPacific(e.record.get("start"))} (Pacific)${
            e.record.get("location") ? " at " + e.record.get("location") : ""
          }</p>`,
          `<p>No need to do anything — just don't show up. 🙂</p>`,
        ].join("\n"),
      );
    }
  } catch (err) {
    e.app.logger().error("glowtape: event cancel mail failed", "error", String(err));
  }
  e.next();
}, "events");

// --- edits: single or many, ONE email ------------------------------------------
// The app edits events through this route (never the raw record API) so a
// pass over several events sends a single digest. Date/time/place changes
// reset acks and re-arm reminders per event; others stay quiet.

routerAdd(
  "POST",
  "/api/glowtape/events/update",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const body = e.requestInfo().body || {};
    const items = body.events || [];
    if (items.length === 0) throw new BadRequestError("Nothing to save.");
    if (items.length > 100) throw new BadRequestError("Too many events in one save.");

    const changed = [];
    let production = null;
    let everyoneNotified = false;
    const notifyMemberIds = [];

    for (const item of items) {
      const rec = e.app.findRecordById("events", String(item.id));
      if (!production) {
        production = e.app.findRecordById("productions", rec.get("production"));
        if (!lib.canManage(production, e.auth)) {
          throw new BadRequestError("Only the production team can edit the schedule.");
        }
        if (production.get("archived")) {
          throw new BadRequestError("This show is archived (read-only). Unarchive it in Manage to edit events.");
        }
      } else if (rec.get("production") !== production.id) {
        throw new BadRequestError("All events must belong to the same production.");
      }

      const beforeStart = String(rec.get("start"));
      const beforeEnd = String(rec.get("end"));
      const beforeLocation = rec.get("location");

      for (const f of ["title", "kind", "location", "notes", "calledNote"]) {
        if (item[f] !== undefined) rec.set(f, item[f]);
      }
      if (item.start !== undefined) rec.set("start", item.start);
      if (item.end !== undefined) rec.set("end", item.end);
      if (item.called !== undefined) rec.set("called", lib.toIdArray(item.called));
      if (item.units !== undefined) rec.set("units", lib.toIdArray(item.units));
      if (item.calledGroups !== undefined) rec.set("calledGroups", lib.toIdArray(item.calledGroups));
      if (item.bringCategories !== undefined) rec.set("bringCategories", lib.toIdArray(item.bringCategories));
      e.app.save(rec);

      const significant =
        rec.get("status") !== "cancelled" &&
        (String(rec.get("start")) !== beforeStart ||
          String(rec.get("end")) !== beforeEnd ||
          rec.get("location") !== beforeLocation);

      if (significant) {
        for (const col of ["acks", "reminders_sent"]) {
          const rows = e.app.findRecordsByFilter(col, "event = {:ev}", "", 500, 0, { ev: rec.id });
          for (const r of rows) e.app.delete(r);
        }
        changed.push(rec);
        const called = lib.toIdArray(rec.get("called"));
        if (called.length === 0) everyoneNotified = true;
        else notifyMemberIds.push(...called);
      }
    }

    if (changed.length > 0 && production) {
      try {
        const to = lib.recipients(
          e.app,
          production.id,
          everyoneNotified ? null : notifyMemberIds,
        );
        const lineFor = (ev) =>
          `<li><strong>${ev.get("kind") ? ev.get("kind") + ": " : ""}${ev.get("title")}</strong> — now ${lib.formatPacific(ev.get("start"))}${
            ev.get("location") ? " at " + ev.get("location") : ""
          }</li>`;
        const subject =
          changed.length === 1
            ? `[${production.get("title")}] Schedule change: ${changed[0].get("title")}`
            : `[${production.get("title")}] ${changed.length} schedule changes`;
        lib.sendMail(
          e.app,
          to,
          subject,
          [
            `<h2>${changed.length === 1 ? "Schedule change" : changed.length + " schedule changes"}</h2>`,
            `<p><strong>${production.get("title")}</strong> — all times Pacific</p>`,
            `<ul>${changed.map(lineFor).join("\n")}</ul>`,
            `<p>Your earlier "Got it" on these was reset — open Glow Tape and tap again so your stage manager knows you saw the changes.</p>`,
          ].join("\n"),
        );
      } catch (err) {
        e.app.logger().error("glowtape: event change mail failed", "error", String(err));
      }
      try {
        lib.sendPush(
          e.app,
          lib.recipientUserIds(e.app, production.id, everyoneNotified ? null : notifyMemberIds),
          {
            title: `🗓 ${production.get("title")}: schedule change`,
            body:
              changed.length === 1
                ? `${changed[0].get("title")} — now ${lib.formatPacific(changed[0].get("start"))}`
                : `${changed.length} events changed — check the schedule`,
            url: `/production/${production.id}/schedule`,
            tag: `sched-${production.id}`,
          },
        );
      } catch (err) {
        e.app.logger().warn("glowtape: event change push failed", "error", String(err));
      }
    }

    return e.json(200, { ok: true, saved: items.length, notified: changed.length });
  },
  $apis.requireAuth(),
);
