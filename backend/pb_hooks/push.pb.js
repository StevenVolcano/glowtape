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

// Line notes are NOT pushed one by one — a run-through would buzz an actor's
// phone a dozen times while they're on stage. They accumulate quietly; when
// the SM taps "Send tonight's line notes" this route sends each actor ONE
// push covering all their un-sent notes and marks them notified, so a second
// tap later in the evening only covers what's new.
routerAdd(
  "POST",
  "/api/glowtape/line-notes/send",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ production: "" });
    e.bindBody(data);
    let production;
    try {
      production = e.app.findRecordById("productions", data.production);
    } catch {
      throw new BadRequestError("Unknown production.");
    }
    if (!lib.canManage(production, e.auth)) {
      throw new BadRequestError("Only the production team can send line notes.");
    }

    const notes = e.app.findRecordsByFilter(
      "line_notes",
      "production = {:p} && notified = false",
      "created",
      500,
      0,
      { p: production.id },
    );
    const byMember = {};
    for (const n of notes) {
      const m = String(n.get("member"));
      (byMember[m] = byMember[m] || []).push(n);
    }

    let people = 0;
    for (const memberId of Object.keys(byMember)) {
      const group = byMember[memberId];
      let member;
      try {
        member = e.app.findRecordById("members", memberId);
      } catch {
        continue; // member deleted since the note was written
      }
      const targets = [];
      if (member.get("user")) targets.push(String(member.get("user")));
      for (const g of lib.toIdArray(member.get("guardians"))) targets.push(g);
      const finalTargets = targets.filter((t) => t && t !== e.auth.id);
      if (finalTargets.length > 0 && lib.pushConfigured()) {
        try {
          const pages = [...new Set(group.map((n) => n.get("page")))].sort((a, b) => a - b);
          lib.sendPush(e.app, finalTargets, {
            title:
              group.length === 1
                ? "🎯 A line note from tonight"
                : `🎯 ${group.length} line notes from tonight`,
            body: `Page${pages.length === 1 ? "" : "s"} ${pages.join(", ")} — waiting on your To-Do tab.`,
            url: `/production/${production.id}/todo`,
            tag: `linenotes-${production.id}-${memberId}`,
          });
          people += 1;
        } catch (err) {
          e.app.logger().error("glowtape: line note push failed", "error", String(err));
        }
      }
      for (const n of group) {
        n.set("notified", true);
        e.app.save(n);
      }
    }
    return e.json(200, { notes: notes.length, people: people });
  },
  $apis.requireAuth(),
);
