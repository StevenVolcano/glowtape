/// <reference path="../pb_data/types.d.ts" />
//
// "Production team" in the app meant the people with Manage access, which
// read wrong once shows listed a music director or choreographer on the team
// without that access. The wording is "Managers" now; this renames each show's
// seeded manager-only channel to match. Channels someone renamed are left alone.

migrate(
  (app) => {
    const rows = app.findRecordsByFilter("channels", "name = {:n} && audience = 'team'", "", 0, 0, {
      n: "🔒 Production Team",
    });
    for (const c of rows) {
      c.set("name", "🔒 Managers");
      app.save(c);
    }
  },
  (app) => {
    const rows = app.findRecordsByFilter("channels", "name = {:n} && audience = 'team'", "", 0, 0, {
      n: "🔒 Managers",
    });
    for (const c of rows) {
      c.set("name", "🔒 Production Team");
      app.save(c);
    }
  },
);
