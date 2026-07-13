/// <reference path="../pb_data/types.d.ts" />
//
// Report a message: any signed-in user can flag a message they can read, and
// the report goes to the Glow Tape operator's inbox (the callboard address) —
// deliberately not to production managers, since a manager could be the
// problem being reported.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

routerAdd(
  "POST",
  "/api/glowtape/messages/report",
  (e) => {
    const lib = require(`${__hooks}/glowtape_lib.js`);
    const data = new DynamicModel({ message: "", reason: "" });
    e.bindBody(data);

    let message;
    try {
      message = e.app.findRecordById("messages", data.message);
    } catch {
      throw new BadRequestError("Unknown message.");
    }
    const channel = e.app.findRecordById("channels", message.get("channel"));

    let where = "Community board";
    if (channel.get("production")) {
      try {
        const production = e.app.findRecordById("productions", channel.get("production"));
        where = production.get("title");
      } catch {
        where = "(deleted production)";
      }
    }

    let authorLine = "(unknown author)";
    try {
      const author = e.app.findRecordById("users", message.get("author"));
      authorLine = `${author.get("name")} <${author.email()}>`;
    } catch {
      /* author account deleted */
    }

    const reason = String(data.reason || "").slice(0, 500);
    const operator = e.app.settings().meta.senderAddress;
    lib.sendMail(
      e.app,
      [{ address: operator, name: "Glow Tape operator" }],
      `⚑ Message reported in ${where} / #${channel.get("name")}`,
      [
        `<h2>A message was reported</h2>`,
        `<p><strong>Where:</strong> ${where} — #${channel.get("name")}</p>`,
        `<p><strong>Written by:</strong> ${authorLine}</p>`,
        `<p><strong>Message:</strong> ${message.get("text") || "(photo only)"}${
          message.get("image") ? " [has photo]" : ""
        }</p>`,
        reason ? `<p><strong>Reporter says:</strong> ${reason}</p>` : "",
        `<p><strong>Reported by:</strong> ${e.auth.get("name")} &lt;${e.auth.email()}&gt;</p>`,
        `<p>Message id: ${message.id} (find it in the PocketBase dashboard to remove it).</p>`,
      ].join("\n"),
    );

    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);
