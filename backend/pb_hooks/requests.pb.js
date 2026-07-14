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

    const data = new DynamicModel({ request: "", orgId: "" });
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

    // The console workflow picks an existing org by id; falling back to
    // find-or-create by the request's org text keeps old clients working.
    let org;
    if (data.orgId) {
      try {
        org = e.app.findRecordById("orgs", data.orgId);
      } catch {
        throw new BadRequestError("Unknown organization.");
      }
    } else {
      try {
        org = e.app.findFirstRecordByFilter("orgs", "name = {:n}", { n: request.get("org") });
      } catch {
        const orgCol = e.app.findCollectionByNameOrId("orgs");
        org = new Record(orgCol);
        org.set("name", request.get("org"));
        e.app.save(org);
      }
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

// Operator sets up a production directly — for the director who asked by
// phone or email and has no in-app request (or no account yet). Creates the
// org and production, then either attaches the director's existing account
// as manager or leaves a manager role placeholder whose claim code is
// emailed to them; signing up with it lands them in the show with Manage.
routerAdd(
  "POST",
  "/api/glowtape/operator/onboard",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    if (!e.auth.get("operator")) throw new BadRequestError("Operators only.");

    const data = new DynamicModel({
      orgId: "",
      org: "",
      title: "",
      name: "",
      email: "",
      role: "",
    });
    e.bindBody(data);
    const title = String(data.title || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const dirName = String(data.name || "").trim();
    if (!title) throw new BadRequestError("The show needs a title.");
    if (!email.includes("@")) throw new BadRequestError("Enter the director's email.");
    if (!dirName) throw new BadRequestError("Enter the director's name.");

    let org;
    if (data.orgId) {
      try {
        org = e.app.findRecordById("orgs", data.orgId);
      } catch {
        throw new BadRequestError("Unknown organization.");
      }
    } else {
      const orgName = String(data.org || "").trim();
      if (!orgName) throw new BadRequestError("Pick or name an organization.");
      try {
        org = e.app.findFirstRecordByFilter("orgs", "name = {:n}", { n: orgName });
      } catch {
        const orgCol = e.app.findCollectionByNameOrId("orgs");
        org = new Record(orgCol);
        org.set("name", orgName);
        e.app.save(org);
      }
    }

    const prodCol = e.app.findCollectionByNameOrId("productions");
    const production = new Record(prodCol);
    production.set("org", org.id);
    production.set("title", title);
    production.set("status", "planning");
    e.app.save(production); // create hook adds joinCode + default channels
    const saved = e.app.findRecordById("productions", production.id);
    const joinCode = saved.get("joinCode");

    const role = ["director", "asst_director", "stage_manager"].includes(data.role)
      ? data.role
      : "director";

    let existingUser = null;
    try {
      existingUser = e.app.findAuthRecordByEmail("users", email);
    } catch {
      /* no account yet */
    }

    const memberCol = e.app.findCollectionByNameOrId("members");
    const member = new Record(memberCol);
    member.set("production", production.id);
    member.set("role", role);
    member.set("manager", true);
    let directorCode = "";
    if (existingUser) {
      member.set("user", existingUser.id);
    } else {
      directorCode = $security.randomStringWithAlphabet(2, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
      member.set("roleCode", directorCode);
      member.set("displayName", dirName);
    }
    e.app.save(member); // member hook syncs production.managers

    try {
      if (existingUser) {
        lib.sendMail(
          e.app,
          [{ address: email, name: existingUser.get("name") }],
          `${title} is ready on Glow Tape 🎭`,
          [
            `<h2>${title}</h2>`,
            `<p>Your production is set up and your account has the Manage tab. The join code for your cast and crew is:</p>`,
            `<p style="font-size:1.5em"><strong>${joinCode}</strong></p>`,
            `<p>Sign in at glowtape.net and open the production — the setup checklist on the To-Do tab walks you through the rest.</p>`,
          ].join("\n"),
        );
      } else {
        lib.sendMail(
          e.app,
          [{ address: email, name: dirName }],
          `${title} is ready for you on Glow Tape 🎭`,
          [
            `<h2>${title}</h2>`,
            `<p>Your production is set up on Glow Tape — the free production hub for Grays Harbor theater. Create your account at <strong>glowtape.net</strong> using this code:</p>`,
            `<p style="font-size:1.5em"><strong>${joinCode}-${directorCode}</strong></p>`,
            `<p>You'll land straight in your show with the Manage tab. The join code for your cast and crew is <strong>${joinCode}</strong> — the setup checklist on the To-Do tab covers everything else. No password, ever: a 6-digit code arrives by email each time you sign in.</p>`,
          ].join("\n"),
        );
      }
    } catch (err) {
      e.app.logger().error("glowtape: onboard mail failed", "error", String(err));
    }

    return e.json(200, {
      ok: true,
      production: production.id,
      joinCode: joinCode,
      directorCode: directorCode ? joinCode + "-" + directorCode : "",
      existingAccount: !!existingUser,
    });
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
