/// <reference path="../pb_data/types.d.ts" />
//
// How-to videos (src/pages/HowTo.tsx): users.videosSeen is a JSON array of the
// video slugs someone has watched (80% through or to the end). The Dashboard's
// Getting settled list ticks "Watch the how-to videos" off from it. People
// write their own row through the normal users update rule.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new Field({ name: "videosSeen", type: "json", maxSize: 2000 }));
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("videosSeen");
    app.save(users);
  },
);
