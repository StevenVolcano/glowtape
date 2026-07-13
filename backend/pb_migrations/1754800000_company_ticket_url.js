/// <reference path="../pb_data/types.d.ts" />
//
// Give each theater company an optional ticket link. The operator sets it in
// the operator console; the community calendar attaches it to that company's
// performance events so the public can buy tickets in one tap. Optional and
// empty by default — companies without an online box office just don't show
// a link.

migrate(
  (app) => {
    const companies = app.findCollectionByNameOrId("companies");
    companies.fields.add(new Field({ name: "ticketUrl", type: "text", max: 300 }));
    app.save(companies);
  },
  (app) => {
    const companies = app.findCollectionByNameOrId("companies");
    companies.fields.removeByName("ticketUrl");
    app.save(companies);
  },
);
