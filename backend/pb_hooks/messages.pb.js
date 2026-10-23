/// <reference path="../pb_data/types.d.ts" />
//
// Chat extras: GIF search (GIPHY), and the server-side checks for GIFs,
// replies and edits on messages.
//
// GIFs: searches go through this server so the GIPHY key stays here and the
// rating is always forced to "g" (youth safety — shows have kids in them).
// A message stores only the GIPHY id; on create the id is looked up again so
// nobody can post a non-G GIF by hand-crafting a request. With no
// GLOWTAPE_GIPHY_API_KEY in /etc/glowtape/env, GIFs are simply off.
//
// NOTE: handlers run in isolated VMs — helpers are defined INSIDE each
// handler (gotcha #1).

routerAdd(
  "GET",
  "/api/glowtape/gifs",
  (e) => {
    const key = ($os.getenv("GLOWTAPE_GIPHY_API_KEY") || "").trim();
    if (!key) return e.json(200, { enabled: false, results: [] });

    const q = String(e.request.url.query().get("q") || "").trim().slice(0, 50);
    const base = "https://api.giphy.com/v1/gifs/";
    const params = `api_key=${encodeURIComponent(key)}&limit=24&rating=g&lang=en`;
    const url = q
      ? `${base}search?${params}&q=${encodeURIComponent(q)}&bundle=messaging_non_clips`
      : `${base}trending?${params}&bundle=messaging_non_clips`;

    let res;
    try {
      res = $http.send({ url, method: "GET", timeout: 10 });
    } catch (err) {
      e.app.logger().warn("glowtape: giphy search failed", "error", String(err));
      throw new BadRequestError("GIF search isn't answering right now. Try again in a minute.");
    }
    if (res.statusCode !== 200) {
      e.app.logger().warn("glowtape: giphy search status", "status", res.statusCode);
      throw new BadRequestError("GIF search isn't answering right now. Try again in a minute.");
    }

    const results = [];
    for (const g of (res.json && res.json.data) || []) {
      if (String(g.rating || "") !== "g") continue;
      const img = (g.images && (g.images.fixed_width_small || g.images.fixed_width)) || null;
      if (!img || !/^[A-Za-z0-9]+$/.test(String(g.id || ""))) continue;
      results.push({
        id: String(g.id),
        title: String(g.title || "").slice(0, 200),
        preview: String(img.webp || img.url || ""),
        width: Number(img.width) || 100,
        height: Number(img.height) || 100,
      });
    }
    return e.json(200, { enabled: true, results });
  },
  $apis.requireAuth(),
);

// New messages: check the GIF (exists, G-rated, title from GIPHY) and that a
// reply points at a message in the same channel.
onRecordCreateRequest((e) => {
  const gif = String(e.record.get("gif") || "");
  e.record.set("gifTitle", "");
  e.record.set("edited", false);

  // Polls: managers of the show only; votes/closing/pinning go through
  // polls.pb.js, so a new message always starts with a clean slate.
  const lib = require(`${__hooks}/glowtape_lib.js`);
  const rawPoll = lib.readJson(e.record, "poll");
  e.record.set("pollVotes", null);
  e.record.set("pollClosed", false);
  e.record.set("pollPinned", false);
  if (rawPoll) {
    const channel = e.app.findRecordById("channels", e.record.get("channel"));
    const productionId = String(channel.get("production") || "");
    if (!productionId) throw new BadRequestError("Polls are for a show's chat.");
    const production = e.app.findRecordById("productions", productionId);
    if (!lib.canManage(production, e.auth)) {
      throw new BadRequestError("Only the show's managers can start a poll.");
    }
    let poll;
    try {
      poll = lib.cleanPoll(rawPoll);
    } catch (err) {
      throw new BadRequestError(String(err.message || err));
    }
    if (gif || e.record.get("image")) throw new BadRequestError("A poll can't carry a photo or GIF.");
    e.record.set("poll", poll);
    e.record.set("pollVotes", {});
    // The question is the message text, so pushes, replies and the
    // operator's report email all read naturally.
    e.record.set("text", `${poll.kind === "times" ? "📅" : "📊"} ${poll.question}`);
  } else {
    e.record.set("poll", null);
  }

  if (gif) {
    if (e.record.get("image")) throw new BadRequestError("Send a photo or a GIF, not both.");
    const key = ($os.getenv("GLOWTAPE_GIPHY_API_KEY") || "").trim();
    if (!key) throw new BadRequestError("GIFs aren't turned on yet.");
    let data = null;
    try {
      const res = $http.send({
        url: `https://api.giphy.com/v1/gifs/${encodeURIComponent(gif)}?api_key=${encodeURIComponent(key)}`,
        method: "GET",
        timeout: 10,
      });
      if (res.statusCode === 200) data = (res.json && res.json.data) || null;
    } catch (err) {
      e.app.logger().warn("glowtape: giphy lookup failed", "error", String(err));
      throw new BadRequestError("Couldn't check that GIF just now. Try again in a minute.");
    }
    if (!data || String(data.rating || "") !== "g") {
      throw new BadRequestError("That GIF isn't available here.");
    }
    e.record.set("gifTitle", String(data.title || "").slice(0, 200));
  }

  const replyTo = String(e.record.get("replyTo") || "");
  if (replyTo) {
    let original;
    try {
      original = e.app.findRecordById("messages", replyTo);
    } catch {
      throw new BadRequestError("The message you're replying to is gone.");
    }
    if (String(original.get("channel")) !== String(e.record.get("channel"))) {
      throw new BadRequestError("You can only reply within the same channel.");
    }
  }

  e.next();
}, "messages");

// Edits: the author may change their words and nothing else, and the message
// gets marked edited so nobody is misled about what was said when.
onRecordUpdateRequest((e) => {
  const before = e.record.original();
  for (const f of ["channel", "author", "image", "gif", "gifTitle", "replyTo", "poll", "pollVotes", "pollClosed", "pollPinned"]) {
    if (String(e.record.getString(f) || "") !== String(before.getString(f) || "")) {
      throw new BadRequestError("Only the text of a message can be changed.");
    }
  }
  if (before.getString("poll") && before.getString("poll") !== "null") {
    throw new BadRequestError("A poll can't be edited once people can vote. Delete it and start a new one.");
  }
  const text = String(e.record.get("text") || "").trim();
  if (!text && !e.record.get("image") && !e.record.get("gif")) {
    throw new BadRequestError("A message can't be empty — delete it instead.");
  }
  if (text !== String(before.get("text") || "").trim()) e.record.set("edited", true);
  else e.record.set("edited", !!before.get("edited"));
  e.next();
}, "messages");
