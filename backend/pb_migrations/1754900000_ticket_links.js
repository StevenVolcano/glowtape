/// <reference path="../pb_data/types.d.ts" />
//
// Ticket links, ID-linked instead of matched by name.
//
// - companies.org: point a curated company at the org that actually runs
//   productions here, so the community calendar resolves a performance's box
//   office by relation id (Driftwood the dropdown entry ↔ Driftwood the org),
//   never by a fragile name compare.
// - productions.ticketUrl: a manager can set a show-specific ticket link under
//   Manage. It wins over the company link; with neither set, no button shows.

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("orgs");
    const companies = app.findCollectionByNameOrId("companies");
    companies.fields.add(
      new Field({ name: "org", type: "relation", collectionId: orgs.id, maxSelect: 1, cascadeDelete: false }),
    );
    app.save(companies);

    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.add(new Field({ name: "ticketUrl", type: "text", max: 300 }));
    app.save(productions);
  },
  (app) => {
    const companies = app.findCollectionByNameOrId("companies");
    companies.fields.removeByName("org");
    app.save(companies);

    const productions = app.findCollectionByNameOrId("productions");
    productions.fields.removeByName("ticketUrl");
    app.save(productions);
  },
);
