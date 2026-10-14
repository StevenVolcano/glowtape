/// <reference path="../pb_data/types.d.ts" />
//
// Richer chat: GIFs, replies, and edit/delete of your own messages.
//
// - gif: a GIPHY id (letters/digits only). The picture is shown from GIPHY's
//   own media server; the id is checked server-side (messages.pb.js) against
//   the GIPHY API so only G-rated GIFs can be posted. gifTitle is filled by
//   that hook from GIPHY, never from the client, and becomes the alt text.
// - replyTo: the message being answered, same channel only (hook-checked).
//   Not required, so deleting the original just clears the link.
// - edited: set by the update hook when the author changes their text.
// - deleteRule gains the operator clause the 1757400000 wrap meant to add
//   (it never applied; 1757800000 skipped messages). Moderation only.

const OP = "@request.auth.operator = true";

migrate(
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    messages.fields.add(new Field({ type: "text", name: "gif", max: 40, pattern: "^[A-Za-z0-9]*$" }));
    messages.fields.add(new Field({ type: "text", name: "gifTitle", max: 200 }));
    messages.fields.add(
      new Field({
        type: "relation",
        name: "replyTo",
        collectionId: messages.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    );
    messages.fields.add(new Field({ type: "bool", name: "edited" }));
    const del = String(messages.deleteRule || "");
    if (del && !del.includes("@request.auth.operator")) {
      messages.deleteRule = `(${del}) || ${OP}`;
    }
    app.save(messages);
  },
  (app) => {
    const messages = app.findCollectionByNameOrId("messages");
    messages.fields.removeByName("gif");
    messages.fields.removeByName("gifTitle");
    messages.fields.removeByName("replyTo");
    messages.fields.removeByName("edited");
    const del = String(messages.deleteRule || "");
    const suffix = ` || ${OP}`;
    if (del.startsWith("(") && del.endsWith(suffix)) {
      messages.deleteRule = del.slice(1, del.length - suffix.length - 1);
    }
    app.save(messages);
  },
);
