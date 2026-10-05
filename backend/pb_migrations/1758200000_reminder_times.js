/// <reference path="../pb_data/types.d.ts" />
//
// People choose their own reminder times (up to 3): users.reminderTimes is a
// JSON array of keys — eve (7pm the night before), morn (8am the day of),
// 10h, 4h, 2h, 1h, 30m. Empty/null = the old default ["10h", "2h"]; an
// explicit [] = no reminders. The same choice drives texts AND app
// notifications (sms.pb.js cron). reminders_sent.kind learns the new keys.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new Field({ name: "reminderTimes", type: "json", maxSize: 2000 }));
    app.save(users);

    const sent = app.findCollectionByNameOrId("reminders_sent");
    const kind = sent.fields.getByName("kind");
    kind.values = ["10h", "2h", "eve", "morn", "4h", "1h", "30m"];
    app.save(sent);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("reminderTimes");
    app.save(users);
    const sent = app.findCollectionByNameOrId("reminders_sent");
    sent.fields.getByName("kind").values = ["10h", "2h"];
    app.save(sent);
  },
);
