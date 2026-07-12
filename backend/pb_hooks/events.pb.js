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
      location: "",
      notes: "",
      calledNote: "",
      called: [],
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
    if (!lib.toIdArray(production.get("managers")).includes(e.auth.id)) {
      throw new BadRequestError("Only the production team can add to the schedule.");
    }

    const collection = e.app.findCollectionByNameOrId("events");
    const created = [];
    for (const occ of occurrences) {
      const rec = new Record(collection);
      rec.set("production", production.id);
      rec.set("title", data.title.trim());
      rec.set("start", occ.start);
      rec.set("end", occ.end || "");
      rec.set("location", data.location);
      rec.set("notes", data.notes);
      rec.set("calledNote", data.calledNote);
      rec.set("called", lib.toIdArray(data.called));
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
    const production = e.app.findRecordById("productions", e.record.get("production"));
    const to = lib.recipients(e.app, production.id, e.record.get("called"));

    const becameCancelled =
      e.record.get("status") === "cancelled" && original.get("status") !== "cancelled";
    const timePlaceChanged =
      String(e.record.get("start")) !== String(original.get("start")) ||
      String(e.record.get("end")) !== String(original.get("end")) ||
      e.record.get("location") !== original.get("location");

    const wipe = (collectionName) => {
      const rows = e.app.findRecordsByFilter(collectionName, "event = {:ev}", "", 500, 0, {
        ev: e.record.id,
      });
      for (const r of rows) e.app.delete(r);
    };

    if (becameCancelled) {
      wipe("reminders_sent"); // no reminders for a cancelled event
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
    } else if (timePlaceChanged && e.record.get("status") !== "cancelled") {
      wipe("acks"); // everyone must re-acknowledge a moved event
      wipe("reminders_sent"); // reminders re-arm for the new time
      lib.sendMail(
        e.app,
        to,
        `[${production.get("title")}] Schedule change: ${e.record.get("title")}`,
        [
          `<h2>Changed: ${e.record.get("title")}</h2>`,
          `<p><strong>${production.get("title")}</strong></p>`,
          `<p>Now: ${lib.formatPacific(e.record.get("start"))} (Pacific)</p>`,
          e.record.get("location") ? `<p>Where: ${e.record.get("location")}</p>` : "",
          e.record.get("calledNote") ? `<p>Called: ${e.record.get("calledNote")}</p>` : "",
          `<p>Your earlier "Got it" was reset — open Glow Tape and tap it again so your stage manager knows you saw the change.</p>`,
        ].join("\n"),
      );
    }
  } catch (err) {
    e.app.logger().error("glowtape: event change mail failed", "error", String(err));
  }
  e.next();
}, "events");
