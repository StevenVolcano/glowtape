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
  const data = new DynamicModel({ email: "", name: "", code: "", age: 0 });
  e.bindBody(data);
  const email = data.email.trim().toLowerCase();
  if (!email.includes("@")) {
    throw new BadRequestError("Please enter a valid email address.");
  }
  const age = Math.floor(Number(data.age) || 0);
  if (age < 1 || age > 120) {
    throw new BadRequestError("Please enter your age.");
  }
  if (age < 13) {
    throw new BadRequestError(
      "Ask a parent or guardian to add you to your show — a grown-up in your production can set everything up, and they'll get your whole schedule.",
    );
  }

  try {
    e.app.findAuthRecordByEmail("users", email);
    return e.json(200, { ok: true, existing: true });
  } catch {
    // not found -> create, but only with a valid code
  }

  const code = data.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  let codeOk = false;
  if (code.length >= 4) {
    // Operator-issued community code?
    try {
      const ac = e.app.findFirstRecordByFilter("access_codes", "code = {:c} && active = true", {
        c: code,
      });
      const exp = String(ac.get("expires") || "");
      codeOk = !exp || exp > new Date().toISOString().replace("T", " ");
    } catch {
      /* not a community code */
    }
    // Production join code or role claim code?
    if (!codeOk && code.length >= 6) {
      try {
        e.app.findFirstRecordByFilter("productions", "joinCode = {:c}", { c: code.slice(0, 6) });
        codeOk = true;
      } catch {
        /* not a production code either */
      }
    }
  }
  if (!codeOk) {
    throw new BadRequestError(
      "Glow Tape is invite-based: creating an account needs a current code from your production or the community organizer.",
    );
  }

  const users = e.app.findCollectionByNameOrId("users");
  const record = new Record(users);
  record.set("email", email);
  record.set("name", data.name.trim());
  record.set("verified", true); // possession of the emailed OTP code proves the address
  // emailVisibility stays false: managers read contacts via the gated route.
  // Age band only — the age itself is deliberately NOT stored (issue #9).
  if (age < 18) {
    record.set("ageBand", "teen");
    const roll = new Date();
    roll.setFullYear(roll.getFullYear() + (18 - age));
    record.set("teenUntil", roll.toISOString().replace("T", " "));
  } else {
    record.set("ageBand", "adult");
  }
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
      if (role.get("minor")) {
        // Guardian claim: the child never gets a login — the claiming adult
        // is added as a guardian (multiple guardians welcome; each claims
        // with the same code) and gets their own member row so they see
        // everything the child's membership generates.
        const gs = lib.toIdArray(role.get("guardians"));
        if (!gs.includes(e.auth.id)) {
          gs.push(e.auth.id);
          role.set("guardians", gs);
          e.app.save(role);
        }
        if (!existing) {
          const membersCol = e.app.findCollectionByNameOrId("members");
          const g = new Record(membersCol);
          g.set("production", production.id);
          g.set("user", e.auth.id);
          g.set("role", "guardian");
          g.set("position", "Guardian of " + (role.get("displayName") || "a cast member"));
          e.app.save(g);
        }
        return e.json(200, {
          ok: true,
          production: production.id,
          already: false,
          guardianOf: role.get("displayName"),
        });
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
        claim.set("manager", !!role.get("manager"));
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

// --- Default groups + channels + join code when a production is created. -----
onRecordAfterCreateSuccess((e) => {
  if (!e.record.get("joinCode")) {
    // Unambiguous alphabet: no 0/O or 1/I confusion on a printed handout.
    const code = $security.randomStringWithAlphabet(6, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    e.record.set("joinCode", code);
    e.app.save(e.record);
  }

  // Cast/Crew are auto groups (membership syncs from roles) so their default
  // channels are real 🔒 group channels, server-enforced like any other.
  const groupsCol = e.app.findCollectionByNameOrId("groups");
  const mkGroup = (name, auto, order) => {
    const g = new Record(groupsCol);
    g.set("production", e.record.id);
    g.set("name", name);
    g.set("auto", auto);
    g.set("order", order);
    e.app.save(g);
    return g;
  };
  const castGroup = mkGroup("Cast", "cast", 1);
  const crewGroup = mkGroup("Crew", "crew", 2);

  const channels = e.app.findCollectionByNameOrId("channels");
  // name, audience, defaultMuted (Off Topic starts muted; opt in, not out), group
  const defaults = [
    ["All Call", "all", false, ""],
    ["🔒 Cast", "all", false, castGroup.id],
    ["🔒 Crew", "all", false, crewGroup.id],
    ["🔒 Production Team", "team", false, ""],
    ["Off Topic", "all", true, ""],
  ];
  for (const [name, audience, defaultMuted, group] of defaults) {
    const c = new Record(channels);
    c.set("production", e.record.id);
    c.set("name", name);
    c.set("audience", audience);
    c.set("defaultMuted", defaultMuted);
    if (group) c.set("group", group);
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
