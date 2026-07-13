/// <reference path="../pb_data/types.d.ts" />
//
// Day-of self-reporting: "running late" / "can't make it". Upserts the
// member's attendance row and alerts the production team immediately by
// email (and SMS, when configured). Managers do roll call through the
// normal attendance record API — no alerts for that.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

routerAdd(
  "POST",
  "/api/glowtape/attendance/report",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ event: "", status: "", note: "", member: "" });
    e.bindBody(data);

    if (data.status !== "late" && data.status !== "absent") {
      throw new BadRequestError("Report either 'late' or 'absent'.");
    }

    let event;
    try {
      event = e.app.findRecordById("events", data.event);
    } catch {
      throw new BadRequestError("Unknown event.");
    }
    const production = e.app.findRecordById("productions", event.get("production"));

    // Reporting for a specific member (a guardian on a child's behalf, or an
    // explicit self); otherwise fall back to the caller's own member row.
    let member;
    if (data.member) {
      try {
        member = e.app.findRecordById("members", data.member);
      } catch {
        throw new BadRequestError("Unknown member.");
      }
      const isSelf = member.get("user") === e.auth.id;
      const isGuardian = lib.toIdArray(member.get("guardians")).includes(e.auth.id);
      if (member.get("production") !== production.id || (!isSelf && !isGuardian)) {
        throw new BadRequestError("You can only report for yourself or your child.");
      }
    } else {
      try {
        member = e.app.findFirstRecordByFilter("members", "production = {:p} && user = {:u}", {
          p: production.id,
          u: e.auth.id,
        });
      } catch {
        throw new BadRequestError("You're not in this production.");
      }
    }

    const note = String(data.note || "").slice(0, 300);
    let row;
    try {
      row = e.app.findFirstRecordByFilter("attendance", "event = {:ev} && member = {:m}", {
        ev: event.id,
        m: member.id,
      });
    } catch {
      const col = e.app.findCollectionByNameOrId("attendance");
      row = new Record(col);
      row.set("event", event.id);
      row.set("member", member.id);
    }
    row.set("status", data.status);
    row.set("note", note);
    e.app.save(row);

    // Alert the production team right away.
    try {
      const reporter = e.auth.get("name") || e.auth.email();
      const onBehalf = member.get("user") !== e.auth.id;
      const who = onBehalf
        ? `${member.get("displayName") || "Their child"} (via ${reporter})`
        : reporter;
      const verb = data.status === "late" ? "is running late" : "can't make it";
      const when = lib.formatPacific(event.get("start"));
      const contacts = lib.managerContacts(e.app, production);
      lib.sendMail(
        e.app,
        contacts.emails,
        `[${production.get("title")}] ${who} ${verb} — ${event.get("title")}`,
        [
          `<h2>${who} ${verb}</h2>`,
          `<p><strong>${event.get("title")}</strong> — ${when} (Pacific)</p>`,
          note ? `<p>Note: ${note}</p>` : "",
          `<p>Reported from Glow Tape just now.</p>`,
        ].join("\n"),
      );
      for (const phone of contacts.phones) {
        lib.sendSms(
          e.app,
          phone,
          `Glow Tape: ${who} ${verb} for ${event.get("title")} (${when}).${note ? " " + note : ""}`,
        );
      }
      lib.sendPush(e.app, lib.toIdArray(production.get("managers")), {
        title: `${data.status === "late" ? "🕒" : "😷"} ${who} ${verb}`,
        body: `${event.get("title")} — ${when}${note ? ` · ${note}` : ""}`,
        url: `/production/${production.id}/schedule`,
        tag: `att-${event.id}`,
      });
    } catch (err) {
      e.app.logger().error("glowtape: attendance alert failed", "error", String(err));
    }

    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);
