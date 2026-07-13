/// <reference path="../pb_data/types.d.ts" />
//
// companies: the shared list of local theater companies offered as a dropdown
// in the profile's stage-history table (with a freeform escape hatch for
// anywhere else). The operator curates the list from the operator console;
// everyone signed in can read it. Seeded with the Grays Harbor companies.

migrate(
  (app) => {
    const operatorOnly = "@request.auth.operator = true";
    const companies = new Collection({
      type: "base",
      name: "companies",
      fields: [
        { type: "text", name: "name", required: true, max: 120 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_companies_name ON companies (name)"],
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: operatorOnly,
      updateRule: operatorOnly,
      deleteRule: operatorOnly,
    });
    app.save(companies);

    const saved = app.findCollectionByNameOrId("companies");
    const seed = [
      "Driftwood Players",
      "GHC/Bishop Center",
      "Stage West Community Theater",
      "Plank Island",
      "Willapa Players",
      "7th Street Kids",
    ];
    for (const name of seed) {
      const rec = new Record(saved);
      rec.set("name", name);
      app.save(rec);
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("companies"));
  },
);
