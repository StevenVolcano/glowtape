/// <reference path="../pb_data/types.d.ts" />
//
// Finalize a cast: assign each drafted auditioner to their role's member row
// in one transaction-ish pass. Manager-only; the draft itself lives in the
// manager-only cast_drafts collection, so nothing is visible to the cast
// until this route runs.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

routerAdd(
  "POST",
  "/api/glowtape/casting/finalize",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    // members: optional subset of role (member) ids to cast now — for shows
    // that lock in a lead or two before the rest (Jesus and Judas first).
    // Empty = finalize everything drafted.
    const data = new DynamicModel({ production: "", members: [] });
    e.bindBody(data);

    let production;
    try {
      production = e.app.findRecordById("productions", data.production);
    } catch {
      throw new BadRequestError("Unknown production.");
    }
    if (!lib.toIdArray(production.get("managers")).includes(e.auth.id)) {
      throw new BadRequestError("Only the production team can finalize a cast.");
    }

    let draft;
    try {
      draft = e.app.findFirstRecordByFilter("cast_drafts", "production = {:p}", {
        p: production.id,
      });
    } catch {
      throw new BadRequestError("No draft cast to finalize.");
    }
    const assignments = draft.get("assignments") || {};
    const subset = lib.toIdArray(data.members);

    let assigned = 0;
    const skipped = [];
    for (const memberId of Object.keys(assignments)) {
      if (subset.length > 0 && !subset.includes(memberId)) continue;
      const value = String(assignments[memberId] || "");
      if (!value) continue;
      // Paper-form pick: record the name on the role as an offline member.
      if (value.startsWith("name:")) {
        try {
          const member = e.app.findRecordById("members", memberId);
          if (member.get("production") === production.id && !member.get("user")) {
            member.set("displayName", value.slice(5).slice(0, 80));
            e.app.save(member);
            assigned++;
          }
        } catch {
          skipped.push("missing role row");
        }
        continue;
      }
      const userId = value;
      let member;
      try {
        member = e.app.findRecordById("members", memberId);
      } catch {
        skipped.push("missing role row");
        continue;
      }
      if (member.get("production") !== production.id) continue;
      if (member.get("minor")) {
        skipped.push(`${member.get("displayName") || member.get("position")} (child roles are claimed by parents)`);
        continue;
      }
      if (member.get("user")) {
        skipped.push(`${member.get("position") || "a role"} (already cast)`);
        continue;
      }
      try {
        e.app.findRecordById("users", userId);
      } catch {
        skipped.push(`${member.get("position") || "a role"} (account not found)`);
        continue;
      }
      member.set("user", userId);
      e.app.save(member); // members hooks keep production.managers in sync
      assigned++;

      // Their audition conflicts become real schedule conflicts, so the SM
      // sees them the moment the cast lands. Once per person per production.
      try {
        const already = e.app.findRecordsByFilter(
          "conflicts",
          "production = {:p} && user = {:u}",
          "",
          1,
          0,
          { p: production.id, u: userId },
        );
        if (already.length === 0) {
          const audition = e.app.findFirstRecordByFilter(
            "auditions",
            "production = {:p} && user = {:u}",
            { p: production.id, u: userId },
          );
          const rows = audition.get("conflictDates") || [];
          const confCol = e.app.findCollectionByNameOrId("conflicts");
          for (const r of rows) {
            if (!r || !r.start) continue;
            const c = new Record(confCol);
            c.set("production", production.id);
            c.set("user", userId);
            c.set("start", r.start);
            c.set("end", r.end || r.start);
            c.set("note", String(r.note || "").slice(0, 500));
            e.app.save(c);
          }
        }
      } catch {
        /* no audition on file (e.g. drafted from "already in the show") */
      }
    }

    // Early-casting a subset keeps the rest of the draft open.
    if (subset.length === 0) {
      draft.set("status", "final");
      e.app.save(draft);
    }

    return e.json(200, { ok: true, assigned, skipped });
  },
  $apis.requireAuth(),
);
