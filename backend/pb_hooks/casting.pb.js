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
    const data = new DynamicModel({ production: "" });
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

    let assigned = 0;
    const skipped = [];
    for (const memberId of Object.keys(assignments)) {
      const userId = String(assignments[memberId] || "");
      if (!userId) continue;
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
    }

    draft.set("status", "final");
    e.app.save(draft);

    return e.json(200, { ok: true, assigned, skipped });
  },
  $apis.requireAuth(),
);
