/// <reference path="../pb_data/types.d.ts" />
//
// Feedback + operator console.
//
// - users.operator: flips on the in-app operator console (set it on Steven's
//   account in the PocketBase dashboard — once, and never again needed there).
// - feedback: ideas/problems/questions from anyone signed in. People see
//   their own submissions and the status the operator sets.
// - access_codes open up to operators so community codes can be rotated from
//   the console instead of the dashboard.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new Field({ name: "operator", type: "bool" }));
    app.save(users);

    const feedback = new Collection({
      type: "base",
      name: "feedback",
      fields: [
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "select", name: "kind", values: ["idea", "problem", "question", "praise"], required: true, maxSelect: 1 },
        { type: "text", name: "message", required: true, max: 2000 },
        { type: "text", name: "page", max: 200 },
        { type: "select", name: "status", values: ["new", "planned", "done", "declined"], maxSelect: 1 },
        { type: "text", name: "reply", max: 1000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      listRule: "user = @request.auth.id || @request.auth.operator = true",
      viewRule: "user = @request.auth.id || @request.auth.operator = true",
      createRule: "@request.auth.id != '' && user = @request.auth.id && (status = '' || status = 'new')",
      updateRule: "@request.auth.operator = true",
      deleteRule: "@request.auth.operator = true || user = @request.auth.id",
    });
    app.save(feedback);

    const codes = app.findCollectionByNameOrId("access_codes");
    const operatorOnly = "@request.auth.operator = true";
    codes.listRule = operatorOnly;
    codes.viewRule = operatorOnly;
    codes.createRule = operatorOnly;
    codes.updateRule = operatorOnly;
    codes.deleteRule = operatorOnly;
    app.save(codes);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("feedback"));
    const codes = app.findCollectionByNameOrId("access_codes");
    codes.listRule = null;
    codes.viewRule = null;
    codes.createRule = null;
    codes.updateRule = null;
    codes.deleteRule = null;
    app.save(codes);
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("operator");
    app.save(users);
  },
);
