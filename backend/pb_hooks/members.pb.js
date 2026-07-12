/// <reference path="../pb_data/types.d.ts" />
//
// Keep productions.managers in sync with member `manager` flags — on every
// create/update/delete, from any path (role edits, role-code claims,
// dashboard changes). The denormalized managers list is what all API rules
// check, so this is the single place Manage access is granted.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

// Members can update their own row (rule allows self/guardian) but only the
// bio field — role, manager flag, guardians, etc. stay manager-territory.
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    let isManager = false;
    try {
      const production = e.app.findRecordById("productions", e.record.get("production"));
      isManager = !!e.auth && lib.toIdArray(production.get("managers")).includes(e.auth.id);
    } catch {
      /* fall through to strict check */
    }
    if (!isManager) {
      const original = e.record.original();
      const locked = [
        "production", "user", "role", "position", "roleCode", "manager",
        "multi", "claimedFrom", "minor", "displayName", "guardians", "noPhotos",
      ];
      for (const f of locked) {
        if (String(e.record.get(f)) !== String(original.get(f))) {
          throw new BadRequestError("Only your bio can be edited here — ask a manager for other changes.");
        }
      }
    }
  }
  e.next();
}, "members");

onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  lib.syncProductionManagers(e.app, e.record.get("production"));
  e.next();
}, "members");

onRecordAfterUpdateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  lib.syncProductionManagers(e.app, e.record.get("production"));
  e.next();
}, "members");

onRecordAfterDeleteSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  lib.syncProductionManagers(e.app, e.record.get("production"));
  e.next();
}, "members");
