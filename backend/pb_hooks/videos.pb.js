/// <reference path="../pb_data/types.d.ts" />
//
// Video check-ins (migration 1759100000): a manager asks for a short video,
// asked actors record one, reviewers (managers + the request's reviewer
// group) watch and leave notes.
//
// - New request → ONE bcc email + a push to everyone asked.
// - Uploads are quiet (reviewers see them in the To-Do tab).
// - Notes marked reviewed → the actor (+ guardians) get one email + push.
// - Each side may only change its own fields (update guard below).
// - Archiving a show deletes its videos: they're working material, not a
//   keepsake, and they're big.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

// Who a request asks: its members list, or every performer when empty
// (minus roles nobody has claimed yet).
onRecordAfterCreateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const production = e.app.findRecordById("productions", e.record.get("production"));
    let asked = lib.toIdArray(e.record.get("members"));
    if (asked.length === 0) {
      const rows = e.app.findRecordsByFilter(
        "members",
        "production = {:p} && role = 'performer'",
        "",
        500,
        0,
        { p: production.id },
      );
      // only rows someone can record for: an account, or a parent's
      asked = rows
        .filter((m) => m.get("user") || lib.toIdArray(m.get("guardians")).length > 0)
        .map((m) => m.id);
    }
    if (asked.length === 0) {
      e.next();
      return;
    }
    const title = String(e.record.get("title"));
    const instructions = String(e.record.get("instructions") || "").trim();
    const due = e.record.get("due")
      ? `<p>Please send it by <strong>${lib.formatPacific(e.record.get("due")).split(",")[0]}</strong>.</p>`
      : "";
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    lib.sendMail(
      e.app,
      lib.recipients(e.app, production.id, asked),
      `[${production.get("title")}] Please record a short video: ${title}`,
      [
        `<h2>🎥 ${esc(title)}</h2>`,
        `<p><strong>${esc(String(production.get("title")))}</strong></p>`,
        instructions ? `<p>${esc(instructions).replace(/\n/g, "<br>")}</p>` : "",
        due,
        `<p>Open Glow Tape's To-Do tab and tap <strong>🎥 Record</strong>. It uses your phone's camera, stops itself at 3 minutes, and only the managers and reviewers see it.</p>`,
      ].join("\n"),
    );
    lib.sendPush(e.app, lib.recipientUserIds(e.app, production.id, asked), {
      title: `🎥 ${production.get("title")}`,
      body: `Please record a short video: ${title}`.slice(0, 120),
      url: `/production/${production.id}/todo#videos`,
      tag: `video-request-${e.record.id}`,
    });
  } catch (err) {
    e.app.logger().error("glowtape: video request notify failed", "error", String(err));
  }
  e.next();
}, "video_requests");

// Uploads: the member must be one the request asked, and the request open.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const request = e.app.findRecordById("video_requests", e.record.get("request"));
    if (request.get("closed")) throw new BadRequestError("This video request is closed.");
    const asked = lib.toIdArray(request.get("members"));
    const member = e.app.findRecordById("members", e.record.get("member"));
    const ok = asked.length > 0 ? asked.includes(member.id) : member.get("role") === "performer";
    if (!ok) throw new BadRequestError("This video request isn't for you.");
    e.record.set("feedback", "");
    e.record.set("reviewed", false);
    e.record.set("feedbackBy", "");
  }
  e.next();
}, "video_checkins");

// The actor (or guardian) may replace their video; reviewers may write
// notes. Nobody rewires which request/member/show a video belongs to.
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const original = e.record.original();
    const uid = e.auth ? e.auth.id : "";
    const member = e.app.findRecordById("members", original.get("member"));
    const isOwner =
      String(member.get("user")) === uid || lib.toIdArray(member.get("guardians")).includes(uid);
    const production = e.app.findRecordById("productions", original.get("production"));
    let isReviewer = lib.canManage(production, e.auth);
    if (!isReviewer) {
      const request = e.app.findRecordById("video_requests", original.get("request"));
      const gid = String(request.get("reviewGroup") || "");
      if (gid) {
        const rows = e.app.findRecordsByFilter(
          "members",
          "production = {:p} && user = {:u}",
          "",
          20,
          0,
          { p: production.id, u: uid },
        );
        isReviewer = rows.some((m) => lib.toIdArray(m.get("groups")).includes(gid));
      }
    }
    const changed = (f) => String(e.record.get(f)) !== String(original.get(f));
    for (const f of ["production", "request", "member"]) {
      if (changed(f)) throw new BadRequestError("A video can't be moved to another request or person.");
    }
    for (const f of ["video", "seconds", "uploadedBy"]) {
      if (changed(f) && !isOwner) throw new BadRequestError("Only the actor can replace their video.");
    }
    for (const f of ["feedback", "reviewed", "feedbackBy"]) {
      if (changed(f) && !isReviewer) throw new BadRequestError("Only the reviewers can write notes.");
    }
    if (changed("uploadedBy") && String(e.record.get("uploadedBy")) !== uid) {
      throw new BadRequestError("Upload under your own name.");
    }
    if (changed("feedbackBy") && String(e.record.get("feedbackBy")) !== uid) {
      throw new BadRequestError("Sign notes with your own name.");
    }
  }
  e.next();
}, "video_checkins");

// Notes delivered: the first time a video is marked reviewed.
onRecordAfterUpdateSuccess((e) => {
  const lib = require(`${__hooks}/glowtape_lib.js`);
  try {
    const original = e.record.original();
    if (e.record.get("reviewed") && !original.get("reviewed")) {
      const production = e.app.findRecordById("productions", e.record.get("production"));
      const request = e.app.findRecordById("video_requests", e.record.get("request"));
      const memberId = String(e.record.get("member"));
      const title = String(request.get("title"));
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const feedback = String(e.record.get("feedback") || "").trim();
      lib.sendMail(
        e.app,
        lib.recipients(e.app, production.id, [memberId]),
        `[${production.get("title")}] Notes on your video: ${title}`,
        [
          `<h2>🎥 Notes on your video: ${esc(title)}</h2>`,
          `<p><strong>${esc(String(production.get("title")))}</strong></p>`,
          feedback
            ? `<blockquote>${esc(feedback).replace(/\n/g, "<br>")}</blockquote>`
            : "<p>Your video has been reviewed.</p>",
          `<p>Glow Tape's To-Do tab has your video and these notes side by side.</p>`,
        ].join("\n"),
      );
      lib.sendPush(e.app, lib.recipientUserIds(e.app, production.id, [memberId]), {
        title: `🎥 ${production.get("title")}`,
        body: `Notes on your video: ${title}`.slice(0, 120),
        url: `/production/${production.id}/todo#videos`,
        tag: `video-notes-${e.record.id}`,
      });
    }
  } catch (err) {
    e.app.logger().error("glowtape: video notes notify failed", "error", String(err));
  }
  e.next();
}, "video_checkins");

// Archiving a show clears its videos and their notes (the requests stay).
onRecordAfterUpdateSuccess((e) => {
  try {
    if (e.record.get("archived") && !e.record.original().get("archived")) {
      const rows = e.app.findRecordsByFilter("video_checkins", "production = {:p}", "", 1000, 0, {
        p: e.record.id,
      });
      for (const r of rows) e.app.delete(r);
    }
  } catch (err) {
    e.app.logger().error("glowtape: archive video cleanup failed", "error", String(err));
  }
  e.next();
}, "productions");
