/// <reference path="../pb_data/types.d.ts" />
//
// Script room v2 + restricted documents:
// - annotations grow a kind (pin | draw | highlight) and a path (normalized
//   points for freehand strokes); text becomes optional since a stroke needs
//   none. Old rows have no kind — clients treat missing as 'pin'.
// - resources grow an audience: 'everyone' (default) or 'team' (production
//   managers only). The file field flips to protected so restriction is
//   real — files are served through short-lived tokens that respect the
//   record's view rule, not by guessable URL.

migrate(
  (app) => {
    const annotations = app.findCollectionByNameOrId("annotations");
    annotations.fields.add(
      new Field({ type: "select", name: "kind", values: ["pin", "draw", "highlight"], maxSelect: 1 }),
    );
    annotations.fields.add(new Field({ type: "json", name: "path", maxSize: 30000 }));
    const text = annotations.fields.getByName("text");
    if (text) text.required = false;
    app.save(annotations);

    const resources = app.findCollectionByNameOrId("resources");
    resources.fields.add(
      new Field({ type: "select", name: "audience", values: ["everyone", "team"], maxSelect: 1 }),
    );
    const file = resources.fields.getByName("file");
    if (file) file.protected = true;
    // Managers see everything; members (and audition visitors, for audition
    // materials while signups are open) only what isn't team-restricted.
    const read =
      "production.managers.id ?= @request.auth.id || (audience != 'team' && ((area = 'audition' && production.auditionOpen = true && @request.auth.id != '') || production.members_via_production.user ?= @request.auth.id))";
    resources.listRule = read;
    resources.viewRule = read;
    app.save(resources);
  },
  (app) => {
    const annotations = app.findCollectionByNameOrId("annotations");
    annotations.fields.removeByName("kind");
    annotations.fields.removeByName("path");
    const text = annotations.fields.getByName("text");
    if (text) text.required = true;
    app.save(annotations);

    const resources = app.findCollectionByNameOrId("resources");
    resources.fields.removeByName("audience");
    const file = resources.fields.getByName("file");
    if (file) file.protected = false;
    const read =
      "(area = 'audition' && production.auditionOpen = true && @request.auth.id != '') || production.managers.id ?= @request.auth.id || production.members_via_production.user ?= @request.auth.id";
    resources.listRule = read;
    resources.viewRule = read;
    app.save(resources);
  },
);
