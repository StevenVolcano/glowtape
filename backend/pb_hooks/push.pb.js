/// <reference path="../pb_data/types.d.ts" />
//
// Web push triggers. Everything is best-effort and silently skipped until
// VAPID keys are configured (see DEPLOY.md).
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

// The public VAPID key the browser needs to subscribe.
routerAdd(
  "GET",
  "/api/glowtape/push/key",
  (e) => {
    const key = $os.getenv("GLOWTAPE_VAPID_PUBLIC");
    if (!key) throw new NotFoundError("Push isn't set up yet.");
    return e.json(200, { key });
  },
  $apis.requireAuth(),
);

// New chat message -> everyone who can see the channel, minus the author and
// anyone who muted it (default-muted channels only push to explicit opt-ins).
onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    if (!lib.pushConfigured()) {
      e.next();
      return;
    }
    const channel = e.app.findRecordById("channels", e.record.get("channel"));
    const authorId = String(e.record.get("author"));
    let authorName = "Someone";
    try {
      authorName = e.app.findRecordById("users", authorId).get("name") || "Someone";
    } catch {
      /* keep default */
    }

    // Who could see it?
    let targets = null; // null = every subscribed user (community channels)
    let where = "Community";
    let url = "/";
    const productionId = String(channel.get("production") || "");
    if (productionId) {
      const production = e.app.findRecordById("productions", productionId);
      where = production.get("title");
      url = `/production/${productionId}/messages`;
      const memberId = String(channel.get("member") || "");
      const groupId = String(channel.get("group") || "");
      if (memberId) {
        // Semi-private team channel: the member + guardians + managers.
        const member = e.app.findRecordById("members", memberId);
        targets = [String(member.get("user") || "")]
          .concat(lib.toIdArray(member.get("guardians")))
          .concat(lib.toIdArray(production.get("managers")));
      } else if (groupId) {
        // Group channel: the group's members (+ their guardians) + managers.
        targets = lib.toIdArray(production.get("managers"));
        const rows = e.app.findRecordsByFilter("members", "production = {:p}", "", 500, 0, {
          p: productionId,
        });
        for (const m of rows) {
          if (!lib.toIdArray(m.get("groups")).includes(groupId)) continue;
          if (m.get("user")) targets.push(String(m.get("user")));
          for (const g of lib.toIdArray(m.get("guardians"))) targets.push(g);
        }
      } else {
        targets = lib.recipientUserIds(e.app, productionId, null);
      }
    }

    // Mutes: explicit prefs win; on default-muted channels, only opted-in
    // users get pushed at all.
    const prefs = e.app.findRecordsByFilter("channel_prefs", "channel = {:c}", "", 500, 0, {
      c: channel.id,
    });
    const mutedBy = {};
    const unmutedBy = {};
    for (const p of prefs) {
      if (p.get("muted")) mutedBy[String(p.get("user"))] = 1;
      else unmutedBy[String(p.get("user"))] = 1;
    }
    const defaultMuted = !!channel.get("defaultMuted");
    const allowed = (uid) => {
      if (uid === authorId) return false;
      if (defaultMuted) return !!unmutedBy[uid];
      return !mutedBy[uid];
    };

    if (targets === null) {
      // Community channel: fetch all subscriptions' users via sendPush(null),
      // but mutes still apply — so resolve the user list from subscriptions.
      const subs = e.app.findRecordsByFilter("push_subscriptions", "id != ''", "", 2000, 0);
      const seen = {};
      targets = [];
      for (const s of subs) {
        const uid = String(s.get("user"));
        if (!seen[uid]) {
          seen[uid] = 1;
          targets.push(uid);
        }
      }
    }
    const finalTargets = targets.filter(allowed);
    if (finalTargets.length === 0) {
      e.next();
      return;
    }

    const text = String(e.record.get("text") || "");
    lib.sendPush(e.app, finalTargets, {
      title: `#${channel.get("name")} — ${where}`,
      body: `${authorName}: ${text ? text.slice(0, 120) : "📷 photo"}`,
      url,
      tag: `channel-${channel.id}`,
    });
  } catch (err) {
    e.app.logger().warn("glowtape: message push failed", "error", String(err));
  }
  e.next();
}, "messages");

// Announcements -> the whole production.
onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    if (lib.pushConfigured()) {
      const productionId = String(e.record.get("production"));
      const production = e.app.findRecordById("productions", productionId);
      const targets = lib
        .recipientUserIds(e.app, productionId, null)
        .filter((u) => u !== String(e.record.get("author")));
      lib.sendPush(e.app, targets, {
        title: `📣 ${production.get("title")}`,
        body: String(e.record.get("title") || "").slice(0, 120),
        url: `/production/${productionId}/messages`,
        tag: `announce-${e.record.id}`,
      });
    }
  } catch (err) {
    e.app.logger().warn("glowtape: announcement push failed", "error", String(err));
  }
  e.next();
}, "announcements");

// Task assigned -> the assignee (and a child assignee's guardians).
onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const assignee = e.record.get("assignee");
    if (lib.pushConfigured() && assignee) {
      const productionId = String(e.record.get("production"));
      const production = e.app.findRecordById("productions", productionId);
      lib.sendPush(e.app, lib.recipientUserIds(e.app, productionId, [String(assignee)]), {
        title: `[${production.get("title")}] Task for you`,
        body: String(e.record.get("title") || "").slice(0, 120),
        url: `/production/${productionId}/todo`,
        tag: `task-${e.record.id}`,
      });
    }
  } catch (err) {
    e.app.logger().warn("glowtape: task push failed", "error", String(err));
  }
  e.next();
}, "tasks");

// Event cancelled -> everyone called.
onRecordAfterUpdateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const was = e.record.original().get("status");
    if (lib.pushConfigured() && e.record.get("status") === "cancelled" && was !== "cancelled") {
      const productionId = String(e.record.get("production"));
      const production = e.app.findRecordById("productions", productionId);
      const called = lib.toIdArray(e.record.get("called"));
      lib.sendPush(
        e.app,
        lib.recipientUserIds(e.app, productionId, called.length ? called : null),
        {
          title: `❌ ${production.get("title")}: cancelled`,
          body: `${e.record.get("title")} — ${lib.formatPacific(e.record.get("start"))}`,
          url: `/production/${productionId}/schedule`,
          tag: `event-${e.record.id}`,
        },
      );
    }
  } catch (err) {
    e.app.logger().warn("glowtape: cancel push failed", "error", String(err));
  }
  e.next();
}, "events");

// Line note delivered: the actor (and their guardians) hear about it the
// moment the SM writes it — quiet hours are handled by the push layer's
// absence of urgency; these arrive with rehearsal already in progress.
onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    if (!lib.pushConfigured()) {
      e.next();
      return;
    }
    const member = e.app.findRecordById("members", e.record.get("member"));
    const targets = [];
    if (member.get("user")) targets.push(String(member.get("user")));
    for (const g of lib.toIdArray(member.get("guardians"))) targets.push(g);
    const authorId = String(e.record.get("author"));
    const finalTargets = targets.filter((t) => t && t !== authorId);
    if (finalTargets.length === 0) {
      e.next();
      return;
    }
    const KINDS = {
      dropped: "Dropped line",
      paraphrased: "Paraphrased",
      skipped: "Skipped ahead",
      jumped: "Jumped a cue",
      called: "Called for line",
    };
    const kind = KINDS[e.record.get("kind")] || "Line note";
    const productionId = String(e.record.get("production"));
    lib.sendPush(e.app, finalTargets, {
      title: `🎯 Line note — p. ${e.record.get("page")}`,
      body: kind + (e.record.get("text") ? `: ${String(e.record.get("text")).slice(0, 90)}` : ""),
      url: `/production/${productionId}/script/${e.record.get("resource")}?page=${e.record.get("page")}`,
      tag: `linenote-${e.record.id}`,
    });
  } catch (err) {
    e.app.logger().error("glowtape: line note push failed", "error", String(err));
  }
  e.next();
}, "line_notes");
