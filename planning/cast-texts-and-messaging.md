# Proposal: cast texts + richer messaging (2026-10-13)

Steven asked for (1) managers texting the whole cast, with an in-app fallback
for anyone without a number or opted out, and (2) more robust messaging incl.
GIFs. Nothing below is built yet — pick, then I build on a branch.

## 1. Cast texts

### What we already have
- **Provider: Twilio, toll-free 888-299-GLOW — already live** (TFV approved
  2026-07-20) for codes + reminders. No new provider, no new monthly number fee.
- **10DLC does not apply**: 10DLC is for local 10-digit numbers. Toll-free uses
  Toll-Free Verification, which we have. BUT our approved use case and opt-in
  page promise *"rehearsal reminders only, up to 2 per rehearsal day"*. Manager
  blasts are a new message type, so before the first blast:
  1. Update `sms-opt-in.html` + the PhoneSettings consent text to cover
     "messages from your show's managers".
  2. Submit an "Update Toll-free registration" in Twilio describing it
     (review typically takes days; sends before approval risk filtering).
  3. Existing opted-in people get a **separate checkbox** ("Also text me
     messages from my show's managers") — off until they tick it. Reminders
     consent is not stretched to cover blasts.

### Cost (verify on Twilio's pricing page; third-party figures)
~$0.008 per segment + carrier fees ≈ **$0.011–0.013 per text**. A 30-person
cast, one-segment (160-char) message ≈ **$0.40 per blast**; 10 blasts/month
across a few shows ≈ **$5–15/month**. Proposed guards: 160 plain characters
max (one segment), per-show cap (e.g. 3 blasts/day), operator can see totals.

### Consent & opt-out
- Inbound Twilio webhook (signature-verified) so **STOP / UNSUBSCRIBE** flips
  `smsOptIn` off in the app (today Twilio blocks STOP at the carrier, but the
  app never learns), **START** re-enables, **HELP** answers with
  callboard@glowtape.net. Webhook URL is set in the Twilio console; secrets stay
  in `/etc/glowtape/env`.
- **Quiet hours 9pm–7am Pacific**: blasts sent then are queued and go out at
  7am (the in-app copy posts immediately).
- Every text: "Glow Tape · <Show>: <message> — Reply STOP to opt out."

### Who sends
Managers (the existing `canManage` gate — "managers" per the wording rule).

### ⚠ The fallback can't be a DM
CLAUDE.md youth-safety invariant: **no DMs, ever**. Instead the fallback posts
into that person's existing **semi-private team channel** (person + their
guardians + all managers — the `team-channel` route already makes these),
plus the usual push + email. Same effect for the recipient, no private 1:1.

### Recipients & send log
- Called set = everyone in the show (or a role group). Children resolve to
  their guardians (`lib.recipientUserIds`), deduped per phone.
- New `text_blasts` collection (manager-only, archive-guarded): sender, body,
  audience, sent-at, and per person: **Texted / In the app (no number /
  opted out) / Failed**. The sender sees that breakdown right after sending
  and in a "Sent texts" list under Messages.

## 2. Richer messaging — pick any (already have: photos, emoji reactions, muting)

| # | Feature | Notes | Size |
|---|---|---|---|
| A | **GIFs** | GIPHY (Tenor's API shut down 2026-06-30). Search proxied through our server so the key stays in env; **rating=g** forced server-side; "Powered by GIPHY" attribution required. Viewers load GIFs from GIPHY's servers (privacy.html gets a line). Needs Steven to create a free GIPHY API key and accept GIPHY's terms. | M |
| B | **Reply to a message** | Quoted snippet above your reply, tap to jump. Lighter than full threads. | S |
| C | **Pinned messages** | Managers pin up to 3 per channel; shown atop the channel. | S |
| D | **Edit / delete your own message** | "(edited)" tag; managers can already remove via report flow. | S |
| E | **@mentions** | @First L. pushes that person even if the channel is muted. | M |
| F | **Unread markers** | "New since you last looked" line + unread dots on channel list. Private to you — no "seen by" surveillance. | M |
| G | **File attachments** | PDFs/docs in chat (size-capped). | S |

My recommendation: texts + **A, B, C, F**. Skipping public read receipts
("seen by") on purpose — announcements already have Got-it acks.
