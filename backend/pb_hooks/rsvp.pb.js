/// <reference path="../pb_data/types.d.ts" />
//
// RSVPs for parties (and any event a manager switched RSVP on for).
// The only way to write an rsvps row: answer for yourself or your child,
// or a manager fills one in for someone who told them in person.
// answer '' = take your answer back.
//
// NOTE: handlers run in isolated VMs — require glowtape_lib INSIDE the body.

routerAdd(
  "POST",
  "/api/glowtape/rsvp",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ event: "", member: "", answer: "", guests: 0 });
    e.bindBody(data);

    let event;
    try {
      event = e.app.findRecordById("events", data.event);
    } catch {
      throw new BadRequestError("Unknown event.");
    }
    if (!event.get("rsvp")) throw new BadRequestError("This event isn't taking RSVPs.");
    if (event.get("status") === "cancelled") throw new BadRequestError("This event was cancelled.");
    const production = e.app.findRecordById("productions", event.get("production"));
    lib.assertNotArchived(production);

    let member;
    try {
      member = e.app.findRecordById("members", data.member);
    } catch {
      throw new BadRequestError("Unknown member.");
    }
    if (member.get("production") !== production.id) throw new BadRequestError("Wrong production.");

    const isManager = lib.canManage(production, e.auth);
    const owns =
      member.get("user") === e.auth.id || lib.toIdArray(member.get("guardians")).includes(e.auth.id);
    if (!isManager && !owns) {
      throw new BadRequestError("You can only RSVP for yourself or your child.");
    }
    const called = lib.toIdArray(event.get("called"));
    const invited =
      called.length === 0 ||
      called.includes(member.id) ||
      (!!member.get("claimedFrom") && called.includes(member.get("claimedFrom")));
    if (!invited && !isManager) throw new BadRequestError("This one isn't for you.");

    const answer = String(data.answer || "");
    if (answer !== "" && answer !== "yes" && answer !== "maybe" && answer !== "no") {
      throw new BadRequestError("Pick Going, Maybe or Can't go.");
    }
    const guests = answer === "no" ? 0 : Math.max(0, Math.min(20, Math.floor(Number(data.guests) || 0)));

    let row = null;
    try {
      row = e.app.findFirstRecordByFilter("rsvps", "event = {:ev} && member = {:m}", {
        ev: event.id,
        m: member.id,
      });
    } catch {
      row = null;
    }
    if (answer === "") {
      if (row) e.app.delete(row);
      return e.json(200, { ok: true });
    }
    if (!row) {
      row = new Record(e.app.findCollectionByNameOrId("rsvps"));
      row.set("production", production.id);
      row.set("event", event.id);
      row.set("member", member.id);
    }
    row.set("user", e.auth.id);
    row.set("answer", answer);
    row.set("guests", guests);
    e.app.save(row);
    return e.json(200, { ok: true, id: row.id });
  },
  $apis.requireAuth(),
);
