/// <reference path="../pb_data/types.d.ts" />
//
// Program bios. Each member gets a per-production bio they (or their
// guardian) can edit; a members-update guard hook restricts non-managers to
// the bio field only. tasks.kind lets the bio-request flow dedupe its tasks.

migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.add(new Field({ name: "bio", type: "text", max: 1200 }));
    members.updateRule =
      "production.managers.id ?= @request.auth.id || user = @request.auth.id || guardians.id ?= @request.auth.id";
    app.save(members);

    const tasks = app.findCollectionByNameOrId("tasks");
    tasks.fields.add(new Field({ name: "kind", type: "text", max: 20 }));
    app.save(tasks);
  },
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    members.fields.removeByName("bio");
    members.updateRule = "production.managers.id ?= @request.auth.id";
    app.save(members);
    const tasks = app.findCollectionByNameOrId("tasks");
    tasks.fields.removeByName("kind");
    app.save(tasks);
  },
);
