/// <reference path="../pb_data/types.d.ts" />
//
// Attendance becomes managers-only, the way help.html already promises.
// The original read rule (1753200000) let any member of the show list every
// attendance row — who was late, who was missing, the "sick" notes people
// typed when calling in. The app never showed castmates those rows, but the
// API served them. Now: managers, the operator, and the person the row is
// about (their own account or a guardian of that member — so "you reported:
// running late" and the door check-in page keep working). Write rules are
// unchanged (managers only; self-service goes through the attendance routes).

const OP = "@request.auth.operator = true";
const memberRead =
  "event.production.managers.id ?= @request.auth.id || event.production.members_via_production.user ?= @request.auth.id";

const oldRead = `(${memberRead}) || ${OP}`;
const newRead =
  "event.production.managers.id ?= @request.auth.id || member.user = @request.auth.id || " +
  `member.guardians.id ?= @request.auth.id || ${OP}`;

migrate(
  (app) => {
    const attendance = app.findCollectionByNameOrId("attendance");
    attendance.listRule = newRead;
    attendance.viewRule = newRead;
    app.save(attendance);
  },
  (app) => {
    const attendance = app.findCollectionByNameOrId("attendance");
    attendance.listRule = oldRead;
    attendance.viewRule = oldRead;
    app.save(attendance);
  },
);
