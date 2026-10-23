/// <reference path="../pb_data/types.d.ts" />
//
// Emailed sign-in codes last 2 hours instead of 5 minutes. Some inboxes
// (Comcast, 2026-10) hold our mail long enough that the code was dead on
// arrival. The longer window is paired with a 5-wrong-tries cap per code in
// pb_hooks/otp_guard.pb.js so a 6-digit code still can't be guessed.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.duration = 7200;
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.duration = 300;
    app.save(users);
  },
);
