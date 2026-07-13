/// <reference path="../pb_data/types.d.ts" />
//
// Community profiles + audition signups (issue #8).
//
// - profiles: one per user — headshot, pronouns, experience, skills. Readable
//   by any signed-in community member; only the owner edits. (Teens skip the
//   headshot in the UI per the youth-safety model; under-13s have no logins.)
// - productions gain auditionOpen / auditionNotes / auditionQuestions, and the
//   list/view rules open up so anyone signed in can see audition-open shows.
// - auditions: one signup per (production, user) with answers to the
//   production's custom questions.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const productions = app.findCollectionByNameOrId("productions");

    // --- profiles ---------------------------------------------------------
    const profiles = new Collection({
      type: "base",
      name: "profiles",
      fields: [
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        {
          type: "file",
          name: "headshot",
          maxSelect: 1,
          maxSize: 10485760,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"],
          thumbs: ["400x0", "100x100"],
        },
        { type: "text", name: "pronouns", max: 40 },
        { type: "text", name: "experience", max: 2000 },
        { type: "text", name: "skills", max: 400 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_profiles_user ON profiles (user)"],
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != '' && user = @request.auth.id",
      updateRule: "user = @request.auth.id",
      deleteRule: "user = @request.auth.id",
    });
    app.save(profiles);

    // --- productions: audition fields + visible-when-open rules -----------
    productions.fields.add(new Field({ name: "auditionOpen", type: "bool" }));
    productions.fields.add(new Field({ name: "auditionNotes", type: "text", max: 1000 }));
    productions.fields.add(new Field({ name: "auditionQuestions", type: "json", maxSize: 4000 }));
    const visible =
      "@request.auth.id != '' && (auditionOpen = true || managers.id ?= @request.auth.id || members_via_production.user ?= @request.auth.id)";
    productions.listRule = visible;
    productions.viewRule = visible;
    app.save(productions);

    // --- auditions --------------------------------------------------------
    const auditions = new Collection({
      type: "base",
      name: "auditions",
      fields: [
        { type: "relation", name: "production", collectionId: productions.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "roles", max: 400 },
        { type: "text", name: "conflicts", max: 1000 },
        { type: "json", name: "answers", maxSize: 8000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_auditions_prod_user ON auditions (production, user)"],
      listRule: "user = @request.auth.id || production.managers.id ?= @request.auth.id",
      viewRule: "user = @request.auth.id || production.managers.id ?= @request.auth.id",
      createRule: "@request.auth.id != '' && user = @request.auth.id && production.auditionOpen = true",
      updateRule: "user = @request.auth.id && production.auditionOpen = true",
      deleteRule: "user = @request.auth.id || production.managers.id ?= @request.auth.id",
    });
    app.save(auditions);
  },
  (app) => {
    for (const name of ["auditions", "profiles"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
    const productions = app.findCollectionByNameOrId("productions");
    const memberOnly =
      "@request.auth.id != '' && (managers.id ?= @request.auth.id || members_via_production.user ?= @request.auth.id)";
    productions.listRule = memberOnly;
    productions.viewRule = memberOnly;
    productions.fields.removeByName("auditionOpen");
    productions.fields.removeByName("auditionNotes");
    productions.fields.removeByName("auditionQuestions");
    app.save(productions);
  },
);
