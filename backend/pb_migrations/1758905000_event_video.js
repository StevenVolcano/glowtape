/// <reference path="../pb_data/types.d.ts" />
//
// Video-call meetings: events.videoUrl holds a Zoom/Meet/Teams link. An event
// can meet in a room (location), online (videoUrl), or both. Cleaned by
// lib.cleanVideoUrl in the events routes and the Claude connector.

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.add(new Field({ type: "text", name: "videoUrl", max: 500 }));
    app.save(events);
  },
  (app) => {
    const events = app.findCollectionByNameOrId("events");
    events.fields.removeByName("videoUrl");
    app.save(events);
  },
);
