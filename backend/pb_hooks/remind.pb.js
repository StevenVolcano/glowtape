/// <reference path="../pb_data/types.d.ts" />
//
// 🔔 Remind people (Steven 2026-10-29: "Can I ping a reminder to events,
// especially those that have changed?"). A manager taps it on an event card;
// everyone called who hasn't answered yet — no Got it (from them or a parent),
// or no RSVP on RSVP events — gets one push + one email, and a text if
// they've said yes to texts (the same yes as reminders and Text the cast).
// If the date/time/place changed since (events.changeNote, set by the
// events/update route), the reminder leads with what changed.
//
// Rails: managers only, not on archived shows, not on cancelled or finished
// events, one reminder per event every GAP_HOURS, no texts in 9pm–7am
// quiet hours (push + email still go). Each person hears once per tap.
//
// NOTE: handlers run in isolated VMs — constants live inside the handler.

routerAdd(
  "POST",
  "/api/glowtape/events/remind",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const GAP_HOURS = 3;

    const data = new DynamicModel({ event: "" });
    e.bindBody(data);

    let event;
    try {
      event = e.app.findRecordById("events", data.event);
    } catch {
      throw new NotFoundError("That event doesn't exist.");
    }
    const production = e.app.findRecordById("productions", event.get("production"));
    if (!lib.canManage(production, e.auth)) {
      throw new ForbiddenError("Only managers can send reminders.");
    }
    lib.assertNotArchived(production);
    if (event.get("status") === "cancelled") {
      throw new BadRequestError("This event is cancelled — there's nothing to remind people about.");
    }
    const startMs = new Date(String(event.get("start")).replace(" ", "T")).getTime();
    const endRaw = String(event.get("end") || "");
    const endMs = endRaw ? new Date(endRaw.replace(" ", "T")).getTime() : startMs;
    if (Math.max(startMs, endMs) < Date.now()) {
      throw new BadRequestError("This event is already over.");
    }
    const lastRaw = String(event.get("remindedAt") || "");
    if (lastRaw) {
      const last = new Date(lastRaw.replace(" ", "T")).getTime();
      if (Date.now() - last < GAP_HOURS * 3600e3) {
        throw new BadRequestError(
          `You already sent a reminder for this at ${lib.formatPacific(lastRaw).split(", ")[1]}. ` +
            `One every ${GAP_HOURS} hours keeps people paying attention — try again after ` +
            `${lib.formatPacific(new Date(last + GAP_HOURS * 3600e3).toISOString()).split(", ")[1]}.`,
        );
      }
    }

    const rsvp = !!event.get("rsvp");
    const called = lib.toIdArray(event.get("called"));
    const answeredUsers = {};
    const answeredMembers = {};
    if (rsvp) {
      for (const r of e.app.findRecordsByFilter("rsvps", "event = {:ev}", "", 1000, 0, { ev: event.id })) {
        answeredMembers[String(r.get("member"))] = 1;
      }
    } else {
      for (const a of e.app.findRecordsByFilter("acks", "event = {:ev}", "", 1000, 0, { ev: event.id })) {
        answeredUsers[String(a.get("user"))] = 1;
      }
    }

    // The same people the RSVP guest list uses: called (empty = everyone),
    // minus parent rows and unclaimed shared-role placeholders.
    const rows = e.app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
      p: production.id,
    });
    const uids = [];
    const emailTo = [];
    const reminded = [];
    const unreachable = [];
    let answered = 0;
    for (const m of rows) {
      if (String(m.get("role")) === "guardian") continue;
      const own = String(m.get("user") || "");
      if (m.get("multi") && !own) continue;
      const claimedFrom = String(m.get("claimedFrom") || "");
      if (called.length > 0 && !called.includes(m.id) && !(claimedFrom && called.includes(claimedFrom))) continue;

      const people = [];
      if (own) people.push(own);
      for (const g of lib.toIdArray(m.get("guardians"))) if (!people.includes(g)) people.push(g);
      const done = rsvp ? !!answeredMembers[m.id] : people.some((u) => answeredUsers[u]);
      if (done) {
        answered++;
        continue;
      }
      const name = String(m.get("displayName") || m.get("position") || "Someone");
      if (people.length === 0) {
        // Not on Glow Tape: a manager-entered email still reaches them.
        const offline = String(m.get("contactEmail") || "").trim();
        if (offline) {
          if (!emailTo.some((t) => t.address === offline)) emailTo.push({ address: offline, name: name });
          reminded.push(name);
        } else unreachable.push(name);
        continue;
      }
      let named = name;
      for (const u of people) {
        if (u === e.auth.id || uids.includes(u)) continue;
        uids.push(u);
      }
      if (own) {
        try {
          named = String(e.app.findRecordById("users", own).get("name") || name);
        } catch {
          /* keep the row's name */
        }
      }
      reminded.push(named);
    }

    if (reminded.length === 0) {
      return e.json(200, { ok: true, reminded: [], answered: answered, unreachable: unreachable, texted: 0 });
    }

    const title = String(production.get("title"));
    const evTitle = String(event.get("title"));
    const when = lib.formatPacific(event.get("start"));
    const where = lib.whereShort(event);
    const change = String(event.get("changeNote") || "");
    const ask = rsvp ? "Please RSVP" : 'Please tap "Got it"';

    // Push — one payload to every account (people and parents).
    try {
      lib.sendPush(e.app, uids, {
        title: change ? `⚠ Changed: ${evTitle}` : `🔔 Reminder: ${evTitle}`,
        body: (change ? change + ". " : "") + when + where + ". " + ask + ".",
        url: `/production/${production.id}/schedule`,
        tag: `remind-${event.id}`,
      });
    } catch (err) {
      e.app.logger().warn("glowtape: remind push failed", "error", String(err));
    }

    // Texts — only for people who said yes, never in quiet hours.
    const hour = lib.pacificHour();
    const quiet = hour >= 21 || hour < 7;
    const smsOn = lib.smsConfigured() && !quiet;
    let texted = 0;
    let smsBody =
      "Glow Tape — " + title + ": " + (change ? "CHANGED " + evTitle + ". " + change + ". " : "Reminder: " + evTitle + ", ") +
      when + where + ". " + ask + " in the app.";
    if (smsBody.length > 280) smsBody = smsBody.slice(0, 277) + "…";
    smsBody += " Reply STOP to opt out.";
    for (const uid of uids) {
      let u;
      try {
        u = e.app.findRecordById("users", uid);
      } catch {
        continue;
      }
      emailTo.push({ address: u.email(), name: u.get("name") });
      if (smsOn && u.get("smsOptIn") && u.get("phoneVerified") && u.get("phone")) {
        if (lib.sendSms(e.app, u.get("phone"), smsBody)) texted++;
      }
    }

    // Email — one bcc to everyone.
    try {
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      lib.sendMail(
        e.app,
        emailTo,
        change ? `[${title}] Changed: ${evTitle} — please check` : `[${title}] Reminder: ${evTitle}`,
        [
          `<h2>${change ? "Heads up — this changed" : "Reminder"}: ${esc(evTitle)}</h2>`,
          `<p><strong>${esc(title)}</strong></p>`,
          change ? `<p style="background:#fff3c4;padding:8px"><strong>What changed:</strong> ${esc(change)}</p>` : "",
          `<p><strong>When:</strong> ${when} (Pacific)</p>`,
          lib.whereHtml(event.get("location"), event.get("videoUrl")),
          rsvp
            ? `<p><strong>Please RSVP:</strong> open Glow Tape and tap Going, Maybe or Can't go.</p>`
            : `<p>Open Glow Tape and tap "Got it" so your stage manager knows you saw this.</p>`,
          `<p style="color:#544e63">— ${esc(e.auth.get("name") || "Your managers")}, ${esc(title)}</p>`,
        ].join("\n"),
      );
    } catch (err) {
      e.app.logger().error("glowtape: remind mail failed", "error", String(err));
    }

    event.set("remindedAt", lib.pbNow());
    e.app.save(event);

    return e.json(200, {
      ok: true,
      reminded: reminded,
      answered: answered,
      unreachable: unreachable,
      texted: texted,
      quiet: quiet,
      smsOn: lib.smsConfigured(),
    });
  },
  $apis.requireAuth(),
);
