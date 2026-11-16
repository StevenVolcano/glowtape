# Glow Tape: operations runbook

Moved out of CLAUDE.md on 2026-11-16.

- **Deploy**: Steven runs `glowtape-update` in the DO web console (root). It
  self-updates, pulls main, builds, installs units, restarts everything. He
  deploys from his phone; never ask him to run anything interactive.
- **Web push**: LIVE — VAPID keys generated on the droplet 2026-07-13 (in
  `/etc/glowtape/env`, never in chat/repo).
- **SMS**: DORMANT. Twilio toll-free verification for 888-299-GLOW (+18882994569)
  was rejected (30530 entity mismatch — submitted against the old Individual
  Trust Hub profile). Waiting for the Zucchini Volcano LLC business profile
  (BU3adf7105071eee02fa9457898a7ae7a2) to be approved, then resubmit "Update
- **SMS**: LIVE. Twilio toll-free verification for 888-299-GLOW was approved
  2026-07-20 and `SMS_READY` is true in `src/lib/types.ts`. The cast-text
  feature (2026-10-13) needs the toll-free registration's use case to name
  "urgent messages from my show's managers"; check that it was updated.
  Toll-free registration". Priority review window ends 2026-07-20. Twilio env
  vars are already on the server; SMS code paths log instead of sending until
  `GLOWTAPE_SMS_PROVIDER` works end-to-end.
- **Email**: LIVE via **Brevo HTTP API** (`pb_hooks/mailer.pb.js` binds
  `onMailerSend`, intercepting ALL mail incl. PB password resets/OTPs;
  activated by `GLOWTAPE_BREVO_API_KEY` in /etc/glowtape/env — without it the
  hook e.next()s to plain SMTP). Brevo deactivated classic SMTP relay on the
  shared Zucchini Volcano account (2026-08; HI2048 hit it first). Sender
  callboard@glowtape.net (Squarespace forwards to steven@); bcc-only blasts
  put the sender in "to" (Brevo requires one), so callboard@ gets an archive
  copy of each blast; recipients chunked ≤90/call; attachments fall back to
  SMTP. DMARC deliberately skipped (conflicts with Squarespace forwarding;
  DKIM is in place). NOTE: Brevo free tier = ~300 emails/day SHARED with
  HI2048, each recipient counts.
- **Operator flag**: set on Steven's user record via the PB dashboard (needed
  for `/operator` and Stagehand access to every production).
- **Backups**: nightly systemd timer → `glowtape-backup` (pb_data snapshots).
  `backend/pb_data` is THE thing to back up.
- **Secrets rule (standing, from Steven): credentials never pass through chat.**
  Compose commands that write secrets directly into `/etc/glowtape/env` on the
  droplet; never print or ask for secret values.

## Backlog

Open: #4 tails (illustrated iOS install card, SM one-pager), #6 tails
(schedule milestones, tracker rows→tasks), #7 gamification (exploratory,
opt-in), #9 tail (guardian self-service co-guardians). Not yet filed:
script-room tails (stroke undo, group-audience docs, split-call times),
community hub extras (cross-org calendar, lend/borrow). Issues #1/#3/#5/#6-core
are built but may still be open; close them when touching the tracker.
