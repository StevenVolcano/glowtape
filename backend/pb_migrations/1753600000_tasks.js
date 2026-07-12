/// <reference path="../pb_data/types.d.ts" />
//
// Production to-dos (issue #6). Deliberately minimal: title, department,
// optional assignee (a member — child assignees notify their guardians),
// optional due date, done. No statuses, no priorities, no subtasks — if a
// production needs more, they have a stage manager.

migrate(
  (app) => {
    const productions = app.findCollectionByNameOrId("productions");
    const members = app.findCollectionByNameOrId("members");

    const memberRead =
      "production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";

    const tasks = new Collection({
      type: "base",
      name: "tasks",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "title", required: true, max: 200 },
        { type: "text", name: "department", max: 60 },
        { type: "relation", name: "assignee", collectionId: members.id, maxSelect: 1, cascadeDelete: false },
        { type: "date", name: "due" },
        { type: "bool", name: "done" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: memberRead,
      viewRule: memberRead,
      createRule: "production.managers.id ?= @request.auth.id",
      // managers, or the assignee themselves (checking off their own work),
      // or a guardian of a child assignee
      updateRule:
        "production.managers.id ?= @request.auth.id || assignee.user = @request.auth.id || assignee.guardians.id ?= @request.auth.id",
      deleteRule: "production.managers.id ?= @request.auth.id",
    });
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId("tasks");
    if (tasks) app.delete(tasks);
  },
);
