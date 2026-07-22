/// <reference path="../pb_data/types.d.ts" />
//
// Contact details are hidden from the general API (see migration
// 1755500000). These routes are the two sanctioned ways to read them:
// production managers get their production's contacts, the operator gets
// submitter emails for the console. Hooks run superuser-side, so hidden
// fields and invisible emails are readable here — the gate is the check.
//
// NOTE: handlers run in isolated VMs — helpers are require()d INSIDE each.

routerAdd(
  "GET",
  "/api/glowtape/contacts",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const productionId = e.request.url.query().get("production");
    let production;
    try {
      production = e.app.findRecordById("productions", productionId);
    } catch {
      throw new BadRequestError("Unknown production.");
    }
    if (!lib.canManage(production, e.auth)) {
      throw new BadRequestError("Only the production team can see contact details.");
    }

    // Everyone attached to this production: members' users, their guardians,
    // and audition signups (auditioners usually aren't members yet).
    const userIds = new Set();
    const members = e.app.findRecordsByFilter(
      "members",
      "production = {:p}",
      "created",
      500,
      0,
      { p: production.id },
    );
    for (const m of members) {
      if (m.get("user")) userIds.add(m.get("user"));
      for (const g of lib.toIdArray(m.get("guardians"))) userIds.add(g);
    }
    const auditions = e.app.findRecordsByFilter(
      "auditions",
      "production = {:p}",
      "created",
      500,
      0,
      { p: production.id },
    );
    for (const a of auditions) {
      if (a.get("user")) userIds.add(a.get("user"));
    }

    const users = {};
    for (const id of userIds) {
      try {
        const u = e.app.findRecordById("users", id);
        users[id] = {
          email: u.email(),
          phone: u.get("phoneVerified") ? u.get("phone") : "",
        };
      } catch {
        /* user gone */
      }
    }
    return e.json(200, { users });
  },
  $apis.requireAuth(),
);

routerAdd(
  "POST",
  "/api/glowtape/operator/emails",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    if (!e.auth.get("operator")) {
      throw new BadRequestError("Operator only.");
    }
    const data = new DynamicModel({ users: [] });
    e.bindBody(data);
    const out = {};
    for (const id of lib.toIdArray(data.users).slice(0, 500)) {
      try {
        out[id] = e.app.findRecordById("users", id).email();
      } catch {
        /* user gone */
      }
    }
    return e.json(200, { users: out });
  },
  $apis.requireAuth(),
);
