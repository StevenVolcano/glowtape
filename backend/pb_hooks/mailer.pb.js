/// <reference path="../pb_data/types.d.ts" />
//
// Brevo HTTP-API mail bridge.
//
// Brevo has been deactivating classic SMTP relay on accounts like ours
// (HI2048 hit the same wall and only recovered by switching to the API).
// PocketBase's mailer only speaks SMTP, so this hook intercepts EVERY
// outgoing email — lib.sendMail blasts AND PocketBase's own password
// resets / sign-in codes — and delivers it through Brevo's transactional
// API instead.
//
// Activation: set GLOWTAPE_BREVO_API_KEY in /etc/glowtape/env (typed on
// the droplet, never through chat) and restart. Without the key this hook
// steps aside (e.next()) and plain SMTP behaves exactly as before, so the
// dashboard's "send test email" exercises whichever path is live.
//
// Notes:
// - Brevo requires a non-empty "to"; our cast blasts are bcc-only for
//   privacy, so those get the sender (callboard@) as the visible "to" —
//   meaning one archive copy of each blast lands in the callboard inbox.
// - Recipients are chunked ≤90 per call (Brevo caps at 99).
// - Attachments (nothing sends them today) fall back to SMTP untouched.

onMailerSend((e) => {
  const key = ($os.getenv("GLOWTAPE_BREVO_API_KEY") || "").trim();
  if (!key) {
    e.next();
    return;
  }

  let hasAttachments = false;
  try {
    const att = e.message.attachments;
    if (att) {
      for (const k in att) {
        hasAttachments = true;
        break;
      }
    }
  } catch {
    /* treat as none */
  }
  if (hasAttachments) {
    e.next();
    return;
  }

  const addr = (a) => {
    const out = { email: String(a.address || "") };
    if (a.name) out.name = String(a.name);
    return out;
  };
  const list = (arr) => {
    const out = [];
    if (arr) {
      for (const a of arr) {
        if (a && a.address) out.push(addr(a));
      }
    }
    return out;
  };

  const sender = addr(e.message.from);
  const to = list(e.message.to);
  const cc = list(e.message.cc);
  const bcc = list(e.message.bcc);
  if (to.length + cc.length + bcc.length === 0) return;

  const html = String(e.message.html || "");
  const text = String(e.message.text || "");

  // No object spread here — keep the syntax old-school for goja's sake.
  const buildPayload = (bccSlice) => {
    const p = {
      sender: sender,
      to: to.length ? to : [sender],
      subject: String(e.message.subject || ""),
    };
    if (html) p.htmlContent = html;
    if (text) p.textContent = text;
    if (!html && !text) p.textContent = " ";
    if (cc.length) p.cc = cc;
    if (bccSlice && bccSlice.length) p.bcc = bccSlice;
    return p;
  };

  const payloads = [];
  if (bcc.length > 90) {
    for (let i = 0; i < bcc.length; i += 90) payloads.push(buildPayload(bcc.slice(i, i + 90)));
  } else {
    payloads.push(buildPayload(bcc));
  }

  for (const payload of payloads) {
    const res = $http.send({
      url: "https://api.brevo.com/v3/smtp/email",
      method: "POST",
      headers: {
        "api-key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      timeout: 20,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      e.app.logger().error(
        "glowtape mail: Brevo API send failed",
        "status",
        res.statusCode,
        "body",
        String(res.raw).slice(0, 400),
      );
      throw new BadRequestError("Email couldn't be sent (Brevo API " + res.statusCode + ").");
    }
  }
  e.app.logger().info(
    "glowtape mail: sent via Brevo API",
    "subject",
    String(e.message.subject || ""),
    "recipients",
    to.length + cc.length + bcc.length,
  );
  // Deliberately NOT calling e.next() — that would ALSO hand the message to
  // the SMTP client and double-send (or double-fail).
});
