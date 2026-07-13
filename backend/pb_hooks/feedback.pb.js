/// <reference path="../pb_data/types.d.ts" />
//
// New feedback -> one email to the operator's callboard inbox. Triage happens
// in the in-app operator console; this is just the ping.
//
// NOTE: handlers run in isolated VMs — shared helpers are require()d INSIDE
// each handler from glowtape_lib.js.

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
      `💬 Feedback (${e.record.get("kind")}): ${String(e.record.get("message")).slice(0, 60)}`,
      [
        `<p><strong>From:</strong> ${who}</p>`,
        `<p><strong>Kind:</strong> ${e.record.get("kind")}</p>`,
        e.record.get("page") ? `<p><strong>Where:</strong> ${e.record.get("page")}</p>` : "",
        `<p>${e.record.get("message")}</p>`,
        `<p>Triage it in the operator console at glowtape.net.</p>`,
      ].join("\n"),
    );
  } catch (err) {
    e.app.logger().error("glowtape: feedback mail failed", "error", String(err));
  }
  e.next();
}, "feedback");
