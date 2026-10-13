/// <reference path="../pb_data/types.d.ts" />
//
// Text the whole cast. A manager writes one short message; each person gets
// it as a text if they've verified a phone and said yes to texts
// (users.smsOptIn — the same yes as call reminders; the consent wording
// covers both, per Steven 2026-10-13). Everyone else gets it as a private Glow Tape message in their
// member's 🔒 "& managers" channel (the youth-safe stand-in for a DM: the
// member, their guardians and all managers can read it), which pushes like any
// message, plus one email so nobody misses it.
//
// Rails: managers only, not on archived shows, nothing during 9pm-7am Pacific
// quiet hours, at most MAX_PER_DAY sends per show per 24 hours, and each
// person is texted at most once per send (a parent of two kids gets one text).
//
// NOTE: handlers run in isolated VMs — constants live inside the handler.

routerAdd(
  "POST",
  "/api/glowtape/cast-text",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const MAX_LEN = 300;
    const MAX_PER_DAY = 3;

    const data = new DynamicModel({ production: "", text: "", audience: "" });
    e.bindBody(data);

    let production;
    try {
      production = e.app.findRecordById("productions", data.production);
    } catch {
      throw new NotFoundError("That production doesn't exist.");
    }
    if (!lib.canManage(production, e.auth)) {
      throw new ForbiddenError("Only managers can text the cast.");
    }
    lib.assertNotArchived(production);

    const text = String(data.text || "").trim();
    if (!text) throw new BadRequestError("Write a message first.");
    if (text.length > MAX_LEN) {
      throw new BadRequestError(`Keep it to ${MAX_LEN} characters so it fits in a text (yours is ${text.length}).`);
    }
    const audience = data.audience === "everyone" ? "everyone" : "cast";

    const hour = lib.pacificHour();
    if (hour >= 21 || hour < 7) {
      throw new BadRequestError(
        "It's quiet hours (9pm–7am), so Glow Tape won't text anyone right now. Send it after 7am, or post an announcement instead.",
      );
    }

    const recent = e.app.findRecordsByFilter(
      "text_blasts",
      "production = {:p} && created >= {:since}",
      "",
      MAX_PER_DAY,
      0,
      { p: production.id, since: lib.pbNow(-24 * 3600e3) },
    );
    if (recent.length >= MAX_PER_DAY) {
      throw new BadRequestError(
        `This show has already sent ${MAX_PER_DAY} cast texts in the last 24 hours — that's the limit, so people keep trusting them. Post an announcement instead.`,
      );
    }

    const smsOn = lib.smsConfigured();
    const title = String(production.get("title"));
    const smsBody = "Glow Tape — " + title + ": " + text + " Reply STOP to opt out.";
    const label = audience === "everyone" ? "everyone in the show" : "the whole cast";
    const channelText = "📣 To " + label + ": " + text;

    const users = {}; // uid -> user record | null
    const result = {}; // uid -> "texted" | "app"
    const loadUser = (uid) => {
      if (users[uid] === undefined) {
        try {
          users[uid] = e.app.findRecordById("users", uid);
        } catch {
          users[uid] = null;
        }
      }
      return users[uid];
    };

    const texted = [];
    const inApp = [];
    const unreachable = [];
    const emailTo = [];
    const channels = e.app.findCollectionByNameOrId("channels");
    const messages = e.app.findCollectionByNameOrId("messages");

    const rows = e.app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
      p: production.id,
    });
    for (const m of rows) {
      if (audience === "cast" && String(m.get("role")) !== "performer") continue;
      const own = String(m.get("user") || "");
      // People by their own name when they have an account; children and
      // unclaimed roles by displayName / role.
      let name = String(m.get("displayName") || m.get("position") || "Someone");
      if (own && loadUser(own)) name = String(users[own].get("name") || name);
      const uids = [];
      if (own) uids.push(own);
      for (const g of lib.toIdArray(m.get("guardians"))) if (!uids.includes(g)) uids.push(g);
      if (uids.length === 0) {
        // An unclaimed role or someone not on Glow Tape. Shared-role
        // placeholders aren't people, so they're not worth reporting.
        if (!m.get("multi")) unreachable.push(name);
        continue;
      }

      let needsApp = false;
      for (const uid of uids) {
        if (uid === e.auth.id) continue;
        if (result[uid] === undefined) {
          const u = loadUser(uid);
          if (!u) continue;
          const textable =
            smsOn && u.get("smsOptIn") && u.get("phoneVerified") && u.get("phone");
          if (textable && lib.sendSms(e.app, u.get("phone"), smsBody)) {
            result[uid] = "texted";
            texted.push(u.get("name") || "Someone");
          } else {
            result[uid] = "app";
            emailTo.push({ address: u.email(), name: u.get("name") });
          }
        }
        if (result[uid] === "app") needsApp = true;
      }
      if (!needsApp) continue;

      // Into this member's private channel with the managers (find or make
      // it, same shape as the /api/glowtape/team-channel route).
      let channel;
      try {
        channel = e.app.findFirstRecordByFilter("channels", "production = {:p} && member = {:m}", {
          p: production.id,
          m: m.id,
        });
      } catch {
        channel = new Record(channels);
        channel.set("production", production.id);
        channel.set("member", m.id);
        channel.set("audience", "all"); // required since 1757500000; the member gate does the hiding
        channel.set("name", `🔒 ${name} & managers`);
        e.app.save(channel);
      }
      const msg = new Record(messages);
      msg.set("channel", channel.id);
      msg.set("author", e.auth.id);
      msg.set("text", channelText);
      // The messages push hook notifies the member + guardians; the flag
      // keeps it from pinging every other manager once per member.
      e.app.store().set("castText:" + channel.id, true);
      try {
        e.app.save(msg);
      } finally {
        e.app.store().remove("castText:" + channel.id);
      }
      inApp.push(name);
    }

    if (emailTo.length > 0) {
      const esc = (s) =>
        String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      try {
        lib.sendMail(
          e.app,
          emailTo,
          `[${title}] A message from the managers`,
          `<p>${esc(text)}</p><p>— ${esc(e.auth.get("name") || "Your managers")}, ${esc(title)} on Glow Tape</p>` +
            `<p style="color:#544e63">You're getting this by email because you haven't said yes to texts from Glow Tape. ` +
            `To get these by text, open Glow Tape → Home → Text reminders.</p>`,
        );
      } catch (err) {
        e.app.logger().error("glowtape: cast-text mail failed", "error", String(err));
      }
    }

    const log = new Record(e.app.findCollectionByNameOrId("text_blasts"));
    log.set("production", production.id);
    log.set("author", e.auth.id);
    log.set("text", text);
    log.set("audience", audience);
    log.set("texted", texted.length);
    log.set("inApp", inApp.length);
    e.app.save(log);

    return e.json(200, { ok: true, smsOn: smsOn, texted, inApp, unreachable });
  },
  $apis.requireAuth(),
);
