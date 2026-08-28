/// <reference path="../pb_data/types.d.ts" />
//
// Booking a sign-up slot. Cast can only write slots through here: book an
// open slot for yourself (or your child), or cancel your own booking.
// Booking a different time on the same sheet moves you — no double-booking,
// no stale holds. Managers can clear anyone's booking.
//
// NOTE: handlers run in isolated VMs — require glowtape_lib INSIDE the body.

routerAdd(
  "POST",
  "/api/glowtape/slots/book",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ slot: "", member: "" });
    e.bindBody(data);

    let slot;
    try {
      slot = e.app.findRecordById("slots", data.slot);
    } catch {
      throw new BadRequestError("Unknown slot.");
    }
    const production = e.app.findRecordById("productions", slot.get("production"));
    lib.assertNotArchived(production);
    const isManager = lib.canManage(production, e.auth);
    const ownsMember = (m) =>
      m.get("user") === e.auth.id || lib.toIdArray(m.get("guardians")).includes(e.auth.id);

    // No member sent = cancel the booking on this slot.
    if (!data.member) {
      const cur = slot.get("member");
      if (!cur) return e.json(200, { ok: true });
      let curMember;
      try {
        curMember = e.app.findRecordById("members", cur);
      } catch {
        curMember = null;
      }
      if (!isManager && (!curMember || !ownsMember(curMember))) {
        throw new BadRequestError("That's not your booking.");
      }
      slot.set("member", "");
      e.app.save(slot);
      return e.json(200, { ok: true });
    }

    let member;
    try {
      member = e.app.findRecordById("members", data.member);
    } catch {
      throw new BadRequestError("Unknown member.");
    }
    if (member.get("production") !== production.id) {
      throw new BadRequestError("Wrong production.");
    }
    if (!isManager && !ownsMember(member)) {
      throw new BadRequestError("You can only book for yourself or your child.");
    }
    const cur = slot.get("member");
    if (cur && cur !== member.id) {
      throw new BadRequestError("That time was just taken — pick another.");
    }

    // One slot per person per sheet (same title): a new booking moves them.
    const others = e.app.findRecordsByFilter(
      "slots",
      "production = {:p} && title = {:t} && member = {:m}",
      "start",
      50,
      0,
      { p: production.id, t: slot.get("title"), m: member.id },
    );
    for (const o of others) {
      if (o.id !== slot.id) {
        o.set("member", "");
        e.app.save(o);
      }
    }
    slot.set("member", member.id);
    e.app.save(slot);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);
