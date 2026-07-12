/// <reference path="../pb_data/types.d.ts" />
//
// Keep productions.managers in sync with member `manager` flags — on every
// create/update/delete, from any path (role edits, role-code claims,
// dashboard changes). The denormalized managers list is what all API rules
// check, so this is the single place Manage access is granted.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

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
