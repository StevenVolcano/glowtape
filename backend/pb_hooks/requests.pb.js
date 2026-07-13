/// <reference path="../pb_data/types.d.ts" />
//
// Production requests + semi-private team channels.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

// New request -> one email to the operator's callboard inbox.
onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    let who = "someone";
    try {
      const u = e.app.findRecordById("users", e.record.get("user"));
      who = `${u.get("name")} <${u.email()}>`;
    } catch {
      /* keep 'someone' */
    }
    const operator = e.app.settings().meta.senderAddress;
    lib.sendMail(
      e.app,
      [{ address: operator, name: "Glow Tape operator" }],
      `🎭 Production request: ${e.record.get("title")} (${e.record.get("org")})`,
      [
        `<p><strong>From:</strong> ${who} — ${e.record.get("role")}</p>`,
        `<p><strong>Show:</strong> ${e.record.get("title")} at ${e.record.get("org")}</p>`,
        e.record.get("timeline") ? `<p><strong>Timeline:</strong> ${e.record.get("timeline")}</p>` : "",
        e.record.get("castSize") ? `<p><strong>Cast:</strong> ${e.record.get("castSize")}</p>` : "",
        e.record.get("minors") ? `<p><strong>Includes performers under 18.</strong></p>` : "",
        e.record.get("notes") ? `<p>${e.record.get("notes")}</p>` : "",
        `<p>Review it in the operator console at glowtape.net.</p>`,
      ].join("\n"),
    );
  } catch (err) {
    e.app.logger().error("glowtape: request mail failed", "error", String(err));
  }
  e.next();
}, "production_requests");

// Operator approves: org (found or created) + production + their manager
// membership, then a welcome email with the join code. The production-create
// hook takes care of the join code and default channels.
routerAdd(
  "POST",
  "/api/glowtape/requests/approve",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    if (!e.auth.get("operator")) throw new BadRequestError("Operators only.");

    const data = new DynamicModel({ request: "" });
    e.bindBody(data);
    let request;
    try {
      request = e.app.findRecordById("production_requests", data.request);
    } catch {
      throw new BadRequestError("Unknown request.");
    }
    if (request.get("status") === "approved") {
      throw new BadRequestError("Already approved.");
    }
    const requester = e.app.findRecordById("users", request.get("user"));

    let org;
    try {
      org = e.app.findFirstRecordByFilter("orgs", "name = {:n}", { n: request.get("org") });
    } catch {
      const orgCol = e.app.findCollectionByNameOrId("orgs");
      org = new Record(orgCol);
      org.set("name", request.get("org"));
      e.app.save(org);
    }

    const prodCol = e.app.findCollectionByNameOrId("productions");
    const production = new Record(prodCol);
    production.set("org", org.id);
    production.set("title", request.get("title"));
    production.set("status", "planning");
    e.app.save(production); // create hook adds joinCode + default channels

    const memberCol = e.app.findCollectionByNameOrId("members");
    const member = new Record(memberCol);
    member.set("production", production.id);
    member.set("user", requester.id);
    const role = request.get("role");
    member.set("role", role === "producer" ? "crew" : role);
    member.set("position", role === "producer" ? "Producer" : "");
    member.set("manager", true);
    e.app.save(member); // member hook syncs production.managers

    request.set("status", "approved");
    e.app.save(request);

    const saved = e.app.findRecordById("productions", production.id);
    try {
      lib.sendMail(
        e.app,
        [{ address: requester.email(), name: requester.get("name") }],
        `${request.get("title")} is ready on Glow Tape 🎭`,
        [
          `<h2>${request.get("title")}</h2>`,
          `<p>Your production is set up and you have the Manage tab. The join code for your cast and crew is:</p>`,
          `<p style="font-size:1.5em"><strong>${saved.get("joinCode")}</strong></p>`,
          `<p>Sign in at glowtape.net, open the production, and start building the schedule. The Manage tab's help covers the rest — and the feedback box is always open.</p>`,
        ].join("\n"),
      );
    } catch (err) {
      e.app.logger().error("glowtape: approval mail failed", "error", String(err));
    }

    return e.json(200, { ok: true, production: production.id, joinCode: saved.get("joinCode") });
  },
  $apis.requireAuth(),
);

// One tap from any member: find-or-create their semi-private channel with the
// production team. Never 1:1 — every manager is in the room.
routerAdd(
  "POST",
  "/api/glowtape/team-channel",
  (e) => {
    const data = new DynamicModel({ production: "" });
    e.bindBody(data);

    let member;
    try {
      member = e.app.findFirstRecordByFilter("members", "production = {:p} && user = {:u}", {
        p: data.production,
        u: e.auth.id,
      });
    } catch {
      throw new BadRequestError("You're not in this production.");
    }

    let channel;
    try {
      channel = e.app.findFirstRecordByFilter("channels", "production = {:p} && member = {:m}", {
        p: data.production,
        m: member.id,
      });
    } catch {
      const col = e.app.findCollectionByNameOrId("channels");
      channel = new Record(col);
      channel.set("production", data.production);
      channel.set("member", member.id);
      channel.set("name", `🔒 ${e.auth.get("name")} & team`);
      e.app.save(channel);
    }

    return e.json(200, { ok: true, channel: channel.id });
  },
  $apis.requireAuth(),
);
