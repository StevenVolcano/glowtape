/// <reference path="../pb_data/types.d.ts" />
//
// Glow Tape server hooks: passwordless signup, join-by-code, default
// channels, and email mirroring so people who never open the app still get
// the schedule.
//
// NOTE: handlers run in isolated VMs — shared helpers must be require()d
// INSIDE each handler from glowtape_lib.js, never referenced from file scope.

// --- Signup: create an account from just email + name. -----------------------
// The client then immediately requests an OTP code, so the random password is
// never used or seen. Idempotent: an existing email returns ok so the UI can
// always follow with requestOTP.
routerAdd("POST", "/api/glowtape/signup", (e) => {
  const data = new DynamicModel({ email: "", name: "" });
  e.bindBody(data);
  const email = data.email.trim().toLowerCase();
  if (!email.includes("@")) {
    throw new BadRequestError("Please enter a valid email address.");
  }

  try {
    e.app.findAuthRecordByEmail("users", email);
    return e.json(200, { ok: true, existing: true });
  } catch {
    // not found -> create
  }

  const users = e.app.findCollectionByNameOrId("users");
  const record = new Record(users);
  record.set("email", email);
  record.set("name", data.name.trim());
  record.set("verified", true); // possession of the emailed OTP code proves the address
  record.set("emailVisibility", true); // castmates need it on the contact sheet
  record.setRandomPassword();
  e.app.save(record);
  return e.json(200, { ok: true, existing: false });
});

// --- Join a production with its join code. -----------------------------------
routerAdd(
  "POST",
  "/api/glowtape/join",
  (e) => {
    const data = new DynamicModel({ code: "" });
    e.bindBody(data);
    // Accept "ABC123", "ABC123XY", or "ABC123-XY" (role claim codes are the
    // production code plus a 2-character role suffix).
    const code = data.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4) {
      throw new BadRequestError("That join code doesn't look right.");
    }
    const prodCode = code.slice(0, 6);
    const roleSuffix = code.length >= 8 ? code.slice(6, 8) : "";

    let production;
    try {
      production = e.app.findFirstRecordByFilter("productions", "joinCode = {:code}", {
        code: prodCode,
      });
    } catch {
      throw new BadRequestError("No production found for that code. Double-check it with your stage manager.");
    }

    let existing = null;
    try {
      existing = e.app.findFirstRecordByFilter(
        "members",
        "production = {:p} && user = {:u}",
        { p: production.id, u: e.auth.id },
      );
    } catch {
      // not a member yet
    }

    if (roleSuffix) {
      // Claim a pre-cast role.
      let role;
      try {
        role = e.app.findFirstRecordByFilter(
          "members",
          "production = {:p} && roleCode = {:rc}",
          { p: production.id, rc: roleSuffix },
        );
      } catch {
        throw new BadRequestError("That role code doesn't match anything. Double-check it with your stage manager.");
      }
      if (role.get("multi")) {
        // Shared role: the placeholder stays; each claimer gets their own row.
        try {
          e.app.findFirstRecordByFilter(
            "members",
            "claimedFrom = {:r} && user = {:u}",
            { r: role.id, u: e.auth.id },
          );
          return e.json(200, { ok: true, production: production.id, already: true });
        } catch {
          // not claimed by this user yet
        }
        if (existing && !existing.get("position")) e.app.delete(existing);
        else if (existing) {
          throw new BadRequestError(
            "You're already in this production. Ask your stage manager to assign the role in Manage instead.",
          );
        }
        const membersCol = e.app.findCollectionByNameOrId("members");
        const claim = new Record(membersCol);
        claim.set("production", production.id);
        claim.set("user", e.auth.id);
        claim.set("role", role.get("role"));
        claim.set("position", role.get("position"));
        claim.set("claimedFrom", role.id);
        e.app.save(claim);
        return e.json(200, { ok: true, production: production.id, already: false, claimed: role.get("position") });
      }
      if (role.get("user") && role.get("user") !== e.auth.id) {
        throw new BadRequestError("That role code was already used. Check with your stage manager.");
      }
      if (role.get("user") === e.auth.id) {
        return e.json(200, { ok: true, production: production.id, already: true });
      }
      if (existing) {
        // They joined generically earlier; fold that row into the role
        // unless it already carries its own assignment.
        if (existing.get("position")) {
          throw new BadRequestError(
            "You're already in this production. Ask your stage manager to assign the role in Manage instead.",
          );
        }
        e.app.delete(existing);
      }
      role.set("user", e.auth.id);
      e.app.save(role);
      return e.json(200, { ok: true, production: production.id, already: false, claimed: role.get("position") });
    }

    if (existing) {
      return e.json(200, { ok: true, production: production.id, already: true });
    }

    const members = e.app.findCollectionByNameOrId("members");
    const member = new Record(members);
    member.set("production", production.id);
    member.set("user", e.auth.id);
    member.set("role", "performer"); // managers adjust roles afterwards
    e.app.save(member);
    return e.json(200, { ok: true, production: production.id, already: false });
  },
  $apis.requireAuth(),
);

// --- Default channels + join code when a production is created. --------------
onRecordAfterCreateSuccess((e) => {
  if (!e.record.get("joinCode")) {
    // Unambiguous alphabet: no 0/O or 1/I confusion on a printed handout.
    const code = $security.randomStringWithAlphabet(6, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    e.record.set("joinCode", code);
    e.app.save(e.record);
  }

  const channels = e.app.findCollectionByNameOrId("channels");
  // name, audience, defaultMuted (Off Topic starts muted; opt in, not out)
  const defaults = [
    ["All Call", "all", false],
    ["Cast", "cast", false],
    ["Crew", "crew", false],
    ["Production Team", "team", false],
    ["Off Topic", "all", true],
  ];
  for (const [name, audience, defaultMuted] of defaults) {
    const c = new Record(channels);
    c.set("production", e.record.id);
    c.set("name", name);
    c.set("audience", audience);
    c.set("defaultMuted", defaultMuted);
    e.app.save(c);
  }
  e.next();
}, "productions");

// --- Email mirroring. ---------------------------------------------------------
// Announcements go out by email too. (Event mail lives in events.pb.js —
// creation happens via the /api/glowtape/events route so bulk scheduling can
// send a single summary email.)

onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const production = e.app.findRecordById("productions", e.record.get("production"));
    const to = lib.recipients(e.app, production.id, null);
    lib.sendMail(
      e.app,
      to,
      `[${production.get("title")}] ${e.record.get("title")}`,
      `<h2>${e.record.get("title")}</h2><p>${e.record.get("body") || ""}</p><p>— ${production.get("title")} on Glow Tape</p>`,
    );
  } catch (err) {
    e.app.logger().error("glowtape: announcement mail failed", "error", String(err));
  }
  e.next();
}, "announcements");
