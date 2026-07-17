# CLAUDE.md

This file documents the repository for AI assistants working in this codebase.
Update it as the project evolves. It is written so a fresh session (any model)
can pick up mid-project — read it fully before changing anything.

## Repository Overview

- **Repo**: `StevenVolcano/glowtape` on GitHub. **Live at https://glowtape.net**
  on a $6 DigitalOcean droplet (Ubuntu 24.04, IP 143.198.156.136) behind Caddy.
- **Purpose**: Glow Tape — free production and rehearsal management for the
  Grays Harbor community-theater scene (Driftwood Players, Bishop Center, Stage
  West, Plank Island, 7th Street Kids, schools). Free forever, self-hosted by
  Steven Puvogel (steven@zucchinivolcano.com, Zucchini Volcano LLC), **no AI in
  the product** (the community is AI-averse — all features are deterministic).
- **Stack**: Vite + React 19 + TypeScript PWA frontend; PocketBase v0.30 backend
  (single Go binary, SQLite) with JS migrations (`pb_migrations/`) and JS hooks
  (`pb_hooks/`). PocketBase serves the built frontend from `backend/pb_public/`.
  A tiny Node sidecar (`deploy/push-sender/`) does Web Push crypto.
- **Plan**: `planning/glowtape.md` is the original product plan. Most of phases
  1–2 and chunks of 3–4 are BUILT (see "What's built" below). GitHub issues
  track the remainder.

## What's built (feature map → where the code lives)

| Feature | Frontend | Backend |
|---|---|---|
| Passwordless sign-in (email or SMS code), invite-gated signup (production/role/community codes, `?code=` invite URLs) | `pages/SignIn.tsx`, `pages/Home.tsx` | `pb_hooks/glowtape.pb.js`, `sms.pb.js` |
| Schedule: events w/ kinds, preset places w/ addresses, bulk weekly create (1 email), bulk edit "Fix up the schedule" (1 digest), cancel/restore, Got-it acks, conflicts, roll call, late/sick self-report (guardians report for children) | `pages/ScheduleTab.tsx`, `components/EventForm.tsx`, `pages/AdminTab.tsx` | `pb_hooks/events.pb.js`, `attendance.pb.js` |
| **Show breakdown**: units (by song / scene / pages per `productions.breakdownStyle`), on-stage/singing/dancing member groups, CSV import/export, drives who's-called on events. **Role groups** (migration `1755600000`): `groups` collection per production; members.groups / units.groups / events.calledGroups multi-relations; Manage → Groups section + group chips per role; EventForm group picker + units resolve via `resolveUnitMemberIds` (breakdown.ts) — groups fill `called` at save, ↻ re-sync is group-aware. **Multi-type events**: kind is picked as chips and stored joined " + " (all kind-substring checks still work); ScheduleTab type filter + print carries `?kind=` (SchedulePrint filters, headline names the type) | `components/BreakdownView.tsx` (in Sheets tab), `lib/breakdown.ts`, unit picker in `EventForm.tsx` | migration `1754500000`, `units` accepted by `events.pb.js` routes |
| Messages: channels (+custom, Off Topic default-muted), photos, emoji reactions, per-channel muting, community board (production=''), semi-private team channels (member+guardians+managers), ⚑ report-to-operator, chat linkification, note links show titles, authors shown as "First L. (Role)" | `pages/MessagesTab.tsx`, `components/ChannelView.tsx`, `CommunityBoard.tsx` | `pb_hooks/safety.pb.js`, team-channel route in `requests.pb.js` |
| Announcements (pinned, emailed, acked) | `MessagesTab.tsx`, `AdminTab.tsx` | announcement hook in `glowtape.pb.js` |
| To-Do: tasks by department, assignee email, bio-request workflow (audience: performers/team/everyone) + bio editor + compiled program view | `pages/TasksTab.tsx`, `BiosView.tsx`, `AdminTab.tsx` | `pb_hooks/tasks.pb.js` |
| Sheets: props/costumes/set/light-cues/sound-cues trackers, inline edit, CSV import/export, print | `pages/TrackersTab.tsx`, `lib/trackers.ts` | migration `1753800000` |
| Notes: rehearsal notes, search, stable URLs, post-to-chat | `pages/NotesTab.tsx` | migration `1754300000` |
| Resources: docs/links per production, 'show' + 'audition' areas | `components/ResourceList.tsx`, `AdminTab.tsx` | migration `1754000000` |
| **Script room** (phase 3, built for Come From Away): PDF viewer (pdfjs-dist, LAZY route `script/:resourceId` — keep it lazy, the chunk is ~480KB) with pin annotations at (page, x, y fractions): scope 'production' (📌 staff-created, all members see) vs 'personal' (📝 author-only, enforced by collection rules), done flag to mark notes off, per-document note list that jumps to pages (pins only). **v2** (migration `1755800000`): annotations.kind pin|draw|highlight + path JSON (normalized points); toolbar modes read/note/draw/highlight/erase; strokes painted on an overlay canvas, erase = tap-near + confirm (own marks, or manager on production marks); manager checkbox makes new notes AND strokes production-wide. **Restricted docs**: resources.audience everyone|team (list/view rules exclude team docs from non-managers) and the resources FILE FIELD IS PROTECTED — plain file URLs 404; ALL resource file opens go through `lib/files.ts` openResourceFile (fresh pb.files.getToken at click time; ScriptRoom fetches token before getDocument). Entry: 📖 Open with notes link on PDF resources (show area). Managers-only create production-scope (rule-enforced) | `pages/ScriptRoom.tsx`, `ResourceList.tsx`, `lib/files.ts` | migrations `1755700000_annotations.js`, `1755800000_draw_restricted_docs.js` |
| Auditions: prepare-first flow (details/questions/preview/share always editable; boxed "Open signups" go-live toggle at the bottom of Manage → Auditions), custom questions, signups aggregate on Manage (NO emails per signup, by request), printable blank form, role checkboxes, performances+strike commitment list with REQUIRED availability checkbox (stored in `answers["Available for all performances and strike"]`), multi-event .ics calendar-add on signup; productions.writtenBy (author credit under the title) + productions.description (show blurb, top of form) + members.roleNotes (per-role casting notes shown under each role checkbox; edited inline in People & roles for uncast roles; audition-info returns roles as [{name,notes}] — NOT strings); conflicts entered as schedule-style rows (auditions.conflictDates JSON [{start,end,note}] + flattened text summary in `conflicts` for review/casting display; legacy free-text shown read-only); casting finalize copies conflictDates into real `conflicts` records once per person | `pages/AuditionForm.tsx`, `AuditionPrint.tsx`, `AdminTab.tsx`, `lib/calendar.ts` downloadMultiIcs | migrations `1753900000` + `1755200000` + `1755300000` + `1755400000`, `community.pb.js` audition-info returns `performances` + `team` (production team [{name,role}] ordered director→asst→SM→other managers, names only), import in `casting.pb.js` |
| Community profiles (headshot/pronouns/experience/skills; teens: no headshot); credits table Company column = dropdown from `companies` collection (operator-curated, seeded w/ 6 Grays Harbor companies) with "Somewhere else…" prompt→freeform-text escape (cell self-heals back to select when cleared) | `pages/Profile.tsx` | migration `1754700000_companies.js` |
| Pre-cast roles w/ claim codes (join+2 chars), shared/multi roles, child roles claimed by guardians | `AdminTab.tsx` MembersSection | join route in `glowtape.pb.js`, `members.pb.js` |
| Youth safety: under-13s have no logins (guardian-managed member records), age band only (never birthdate), no DMs, photo-consent flags, teen no-headshot, quiet hours | throughout | `1753500000_youth_safety.js`, signup age gate |
| SMS reminders (~10h + ~2h, quiet hours 9pm–7am Pacific, early calls announced 7–9pm the evening before), phone verify, sign-in by text — **UI hidden behind `SMS_READY` flag in `lib/types.ts` (currently false): flip to true when Twilio clears** to reveal sign-in chips + phone form; until then "coming soon" cards | `components/PhoneSettings.tsx`, `pages/SignIn.tsx` | `pb_hooks/sms.pb.js` — **dormant until Twilio approves; see Operational status** |
| Web push notifications (messages w/ mutes, announcements, schedule changes, cancellations, task assigns, late/sick→managers) | `components/PushSettings.tsx`, `public/sw.js` | `pb_hooks/push.pb.js`, `glowtape_lib.js` sendPush → Node sidecar `deploy/push-sender/` on 127.0.0.1:8666 |
| Calendar: per-event Google/ICS + personal ICS feed (guardians get children's) | `lib/calendar.ts`, `ScheduleTab.tsx` | `pb_hooks/calendar.pb.js` |
| Feedback (idea/problem/question/praise → operator email + in-app status) | `components/FeedbackSection.tsx` | `pb_hooks/feedback.pb.js` |
| Attendance history (per-member tallies, Manage-only) + nightly rehearsal report email (10pm PT, days with events: roll call, overdue tasks, today's notes) | AttendanceHistorySection in `AdminTab.tsx` | `pb_hooks/reports.pb.js` |
| Director setup checklist (data-derived, top of To-Do for managers; links jump to Manage anchors via `ManageJumpNav` hash-scroll) + printable `public/director-guide.html`; QR codes for join/audition links (`qrcode` npm pkg, local) | `components/SetupGuide.tsx`, `ManageJumpNav.tsx`, `QrCode.tsx` | — |
| Operator console (`/operator`, needs `users.operator` flag — set in PB dashboard; `auth.tsx` authRefreshes on load so flag changes propagate without re-login): production-request approval, feedback triage, community access codes, theater-company list (link a company to its `orgs` row by id + optional box-office ticket link), jump-chip nav (shared `JumpNav` in `ManageJumpNav.tsx`, section ids requests/onboard/feedback/codes/orgs/companies); org add/rename with production counts (delete superuser-only); request approval is a numbered workflow — org picked BY ID from a select (auto-matched to the request's org text, '' = create new from typed name; approve route takes optional orgId), title, optional reply, confirm; NEW `/api/glowtape/operator/onboard` route + 'Set up a production directly' form: org select-or-new + title + director name/email/role → creates org+production, attaches an existing account as manager OR leaves a manager role placeholder and emails the claim code (joinCode-XX) | `pages/Operator.tsx` | approve route in `requests.pb.js`, migration `1755000000_operator_orgs.js` (orgs create/update = operator) |
| Self-service email change (code to the NEW address proves inbox ownership, then `setEmail`; reuses `phone_codes` w/ purpose `email-change`, email string in the `phone` column) | `components/EmailSettings.tsx` (Home) | `pb_hooks/email.pb.js` |
| Casting extras: dropdowns offer auditioners + 🎭 already-in-show people + ✍ paper-form freeform (`name:`-prefixed values → offline member displayName); "✓ Cast now" early-casts one role via finalize `members:[id]` subset (draft stays open/private); Strike + Cast Party in DEFAULT_EVENT_KINDS | `pages/CastingTab.tsx` | `casting.pb.js` subset logic |
| UX conventions: ALL placeholders italic (global `::placeholder` CSS) and realistic samples say "Example:" / "— for example:" — keep new placeholders on this convention; `.golive` CSS class = bordered can't-miss go-live box | `src/styles.css`, everywhere | — |
| Production requests (director asks; operator edits+approves → org+production+manager membership created) | `pages/RequestProduction.tsx` | `pb_hooks/requests.pb.js` |
| Community page `/community`: board + public calendar of audition/performance-kind events via `/api/glowtape/community-calendar` route (safe fields only); audition events link to the signup form; performance events show a 🎟 Buy-tickets link when set (`productions.ticketUrl` in Manage → Tickets wins, else the org's company box-office link resolved by `companies.org` relation id — no name matching; no link → no button); EventForm shows 🌍 notice on public kinds (`isCommunityKind`) + open-auditions nudge. Audition form is fed by `/api/glowtape/audition-info` (roles-on-offer checkboxes from uncast performer positions, audition-kind events, questions — auditioners aren't members, so a route, not rules) | `pages/Community.tsx`, `AuditionForm.tsx`, `AuditionPrint.tsx` | `pb_hooks/community.pb.js` |
| Casting tab (manager-only): draft cast from audition signups in `cast_drafts` (manager-only collection), double-cast ⚠ + conflicts inline, finalize route assigns users to member rows after warning | `pages/CastingTab.tsx` | `pb_hooks/casting.pb.js`, migration `1754600000` |
| Schedule extras: manager "View as member" filter, print view (list + month grids) at `schedule/print[/:memberId]`, ack-all with confirm; contact sheet columns manager-only — **API-level since migration `1755500000`**: users.phone/phoneVerified/smsOptIn are hidden fields, emailVisibility=false for all (signup no longer sets it); managers read contacts via GET `/api/glowtape/contacts?production=` and the operator via POST `/api/glowtape/operator/emails` (both in `contacts.pb.js`). CAVEAT: when SMS_READY flips, PhoneSettings can no longer read own phone/smsOptIn from the auth record — it needs a self-status route and an opt-in route first. members.contactEmail/Phone (offline folks, member-record fields) remain production-member-visible (recipients() emails them, never SMS); profiles.credits table (Year/Company/Show/Role) | `pages/SchedulePrint.tsx`, `ScheduleTab.tsx`, `PeopleTab.tsx`, `Profile.tsx` | migration `1754600000`, `glowtape_lib.js` recipients |
| Accessibility: WCAG 2.2 AA pass done (labels, live regions, contrast tokens, per-view titles via `lib/useTitle.ts`) | throughout | — |

Static docs in `public/`: `help.html` (the user manual — keep in sync with
features!), `handout.html` (printable read-through sheet), `director-guide.html`
(printable setup checklist), `why-glowtape.html` (printable pitch page for
directors/companies: features, philosophy, pricing, links to request form),
`youth-safety.html`, `privacy.html`, `terms.html`, `sms-opt-in.html`. All carry
auto-year copyright (© 2026 Zucchini Volcano LLC).

**Pricing story (2026-07, per Steven)**: free forever for Grays Harbor
productions; ALWAYS free for cast/crew/families everywhere; non-Harbor theater
companies contribute a modest cost-recovery amount (not profit). This wording
lives in terms.html, help.html ("What does it cost?"), why-glowtape.html,
RequestProduction.tsx, and Home.tsx — keep them consistent. No billing is
implemented; it's a manual/honor arrangement for now.

## Critical gotchas (violating these breaks production)

1. **PocketBase hook handlers run in isolated VMs.** Top-level functions in
   `*.pb.js` files do NOT exist when handlers fire (ReferenceError at runtime,
   loads fine). ALL shared helpers live in `backend/pb_hooks/glowtape_lib.js`;
   every handler must `const lib = require(\`${__hooks}/glowtape_lib.js\`)`
   INSIDE its own body. Multi-relation values from `record.get()` are
   VM-wrapped — copy via `lib.toIdArray()` before array methods.
2. **PB datetimes** are `"YYYY-MM-DD HH:MM:SS.sssZ"` (space, not T). Always
   parse via `pbDate()` (`src/lib/types.ts`); Safari rejects the raw format.
   Display: `formatWhen`/`formatPacific` for times; `formatDay` for DATE-ONLY
   values (renders the UTC day on purpose); `formatStamp` for created/updated
   timestamps (local day). Never swap those two.
3. **Migration ordering**: API rules referencing back-relations
   (`members_via_production.user`) are validated at collection save — create
   collections first, set rules after referenced collections exist (see the
   structure-first/rules-last pattern in `1752200000_init_glowtape.js`).
4. **react-router v7 splat routes**: relative links inside `/production/:id/*`
   resolve against the full URL and stack segments. All tab links/redirects use
   absolute paths built from `/production/${production.id}`.
5. **No Intl in the PB JSVM** — Pacific-time math is manual
   (`lib.pacificOffsetHours/pacificHour/formatPacific`).
6. **JSVM can't do Web Push crypto** — pushes go through the Node sidecar
   (`deploy/push-sender/server.mjs`, systemd unit `glowtape-push`, localhost
   only). Everything is no-op until `GLOWTAPE_VAPID_*` env vars exist.
7. **Locked user fields**: `phone`, `phoneVerified`, `operator` cannot be
   changed via the record API (guard hook in `sms.pb.js`).
8. **Events are edited only through the routes** (`/api/glowtape/events`,
   `/api/glowtape/events/update`) so emails digest correctly and acks/reminders
   reset on date/time/place changes. The only raw-record event update the app
   does is status (cancel/restore), which the cancel hook + push hook watch.
9. **`chown -R glowtape:glowtape backend`** after touching server files;
   services run as user `glowtape`.

## Data model (collections)

`users` (+phone/phoneVerified/smsOptIn/ageBand/teenUntil/operator) ·
`orgs` (name, locations JSON) ·
`productions` (org, title, status, joinCode, managers[denormalized user ids],
eventKinds, locations, auditionOpen/Notes/Questions, breakdownStyle) ·
`members` (production, user?, role, position, roleCode, manager, multi,
claimedFrom, minor, displayName, guardians[], noPhotos, bio) — THE identity
row; pre-cast roles have empty user; children never have users ·
`events` (called[member ids; empty=everyone], calledNote, kind, status,
units[]) · `acks` · `conflicts` · `attendance` (event+member unique) ·
`units` (breakdown: name/act/pages/order + onstage/singing/dancing member
relations + notes) ·
`channels` (production=''→community; member set→semi-private team channel) ·
`channel_prefs` (muted) · `messages` (+image) · `reactions` ·
`announcements` + `announcement_acks` ·
`tasks` (kind='bio' for bio requests) · `tracker_items` · `notes` ·
`resources` (area show|audition) · `profiles` · `auditions` (unique
production+user) · `companies` (operator-curated dropdown for profile
credits; freeform text still allowed) · `cast_drafts` (manager-only
worksheet) · `production_requests` · `feedback` · `access_codes` ·
`phone_codes` (hashed, expiring) · `reminders_sent` (event+user+kind unique —
SMS dedupe) · `calendar_tokens` · `push_subscriptions` (endpoint unique).

Recipient resolution (email/SMS/push): a called member resolves to their own
user PLUS all guardians; `claimedFrom` links claimed shared-role rows back to
the called placeholder. Use `lib.recipients` (emails) / `lib.recipientUserIds`
(user ids for push) — never hand-roll it.

## Operational status & runbook (as of 2026-07-13)

- **Deploy**: Steven runs `glowtape-update` in the DO web console (root). It
  self-updates, pulls main, builds, installs units, restarts everything. He
  deploys from his phone; never ask him to run anything interactive.
- **Web push**: LIVE — VAPID keys generated on the droplet 2026-07-13 (in
  `/etc/glowtape/env`, never in chat/repo).
- **SMS**: DORMANT. Twilio toll-free verification for 888-299-GLOW (+18882994569)
  was rejected (30530 entity mismatch — submitted against the old Individual
  Trust Hub profile). Waiting for the Zucchini Volcano LLC business profile
  (BU3adf7105071eee02fa9457898a7ae7a2) to be approved, then resubmit "Update
  Toll-free registration". Priority review window ends 2026-07-20. Twilio env
  vars are already on the server; SMS code paths log instead of sending until
  `GLOWTAPE_SMS_PROVIDER` works end-to-end.
- **Email**: LIVE via Brevo SMTP, sender callboard@glowtape.net (Squarespace
  forwards to steven@). DMARC deliberately skipped (conflicts with Squarespace
  forwarding; DKIM is in place).
- **Operator flag**: set on Steven's user record via the PB dashboard (needed
  for `/operator`).
- **Backups**: nightly systemd timer → `glowtape-backup` (pb_data snapshots).
  `backend/pb_data` is THE thing to back up.
- **Secrets rule (standing, from Steven): credentials never pass through chat.**
  Compose commands that write secrets directly into `/etc/glowtape/env` on the
  droplet; never print or ask for secret values.

## Remaining backlog (GitHub issues + tails)

Next up when SMS clears: flip `SMS_READY` in `lib/types.ts` to true + revert
the two "coming soon" help.html paragraphs (sign-in + text reminders).
Open: #4 tails (illustrated iOS install card, SM one-pager),
#5 tail (attendance history view per member), #6 tails (schedule milestones,
tracker rows→tasks), #7 gamification (exploratory, opt-in), #9 tail (guardian self-service co-guardians;
EXIF stripping DONE — `lib/images.ts` scrubImage canvas re-encode on chat photos + headshots). Not yet filed:
rehearsal reports (nightly digest; DONE), script-room tails (stroke undo, group-audience docs, split-call times), community
hub extras (cross-org calendar, lend/borrow). Issues #1/#3/#5/#6-core are built
but may still be open — close them when touching the tracker.

## Development Workflow

```sh
npm install
npm run setup-backend   # once: downloads pocketbase binary (may be blocked by sandbox proxy)
npm run backend         # :8090
npm run dev             # :5173 — proxies /api to the backend
npm run build           # typecheck + production build (MUST pass before pushing)
node --check backend/pb_hooks/<file>.pb.js   # syntax-check hooks (no runtime here)
```

The Claude Code sandbox cannot reach the live server (proxy 403s) — Steven
verifies deployments from his phone and reports back, often with screenshots.

## Branch & Commit Conventions

- Feature branches `claude/<task-slug>`; commit there, then ff-merge to `main`
  and `git push origin main` — this session-long pattern is Steven-approved
  (he deploys from main). Never force-push.
- Commits: imperative mood, subject < 72 chars, no trailing period; explain
  *why* in the body.

## Code & Product Conventions

- **Ease-of-use constitution** (non-negotiable): no passwords, works in a plain
  browser tab, every notification mirrors to email, people see only their
  productions, everything important prints cleanly, big tap targets, plain
  English for all ages, no jargon.
- **Accessibility is a maintained bar**: label every input (aria-label or
  <label>), name icon-only buttons, `role="status"`/`"alert"` on feedback
  text, `aria-pressed` on toggle chips, `aria-expanded` on disclosures,
  th scope, contrast ≥ 4.5:1 text / 3:1 controls (tokens `--ctrl`, `--ok`
  already tuned), `useTitle()` on new pages.
- **One email per human action** — bulk operations send a single digest.
- Chat identity: "First L. (Role)" via `chatName()` in `lib/types.ts`.
- **Youth safety invariants**: no DMs ever (team channels always include all
  managers + guardians), no under-13 logins, no birthdates, no health fields,
  emphasize safety in any new documentation.
- Never build features that distribute licensed scripts (plan §4).
- Update `public/help.html` whenever a user-facing feature changes — it is the
  product manual and Steven's community reads it.
- No AI-powered features. No new documentation files unless asked.
- Never commit secrets; server env lives in `/etc/glowtape/env` only.

## Repository Structure

```
/
├── CLAUDE.md
├── planning/glowtape.md    # original product plan (partly superseded — this file wins)
├── index.html / vite.config.ts / tsconfig.json / package.json
├── backend/
│   ├── README.md           # run/deploy/SMS setup + first-run checklist
│   ├── pb_migrations/      # schema, ordered by timestamp prefix — append-only
│   ├── pb_hooks/           # glowtape_lib.js (SHARED HELPERS) + glowtape.pb.js,
│   │                       # events, sms, calendar, members, attendance, tasks,
│   │                       # safety, feedback, requests, push (.pb.js each)
│   └── pb_data/            # runtime DB + files (gitignored)
├── deploy/                 # cloud-init, server-setup.sh, Caddyfile, systemd units,
│   │                       # glowtape-update (self-updating), backup timer, DEPLOY.md
│   └── push-sender/        # Node web-push sidecar (package-lock committed — npm ci)
├── public/                 # manifest, sw.js (offline shell + push), icons,
│                           # help/handout/youth-safety/privacy/terms/sms-opt-in .html
├── scripts/                # get-pocketbase.sh, make-icons.mjs
└── src/
    ├── lib/                # pb.ts, types.ts (records+helpers), auth.tsx, calendar.ts,
    │                       # trackers.ts, breakdown.ts, useTitle.ts
    ├── pages/              # SignIn, Home, Profile, AuditionForm, AuditionPrint,
    │                       # RequestProduction, Operator, Production shell +
    │                       # Schedule/Messages/Tasks/Trackers/Notes/People/Admin tabs, BiosView
    └── components/         # ChannelView, CommunityBoard, EventForm, ResourceList,
                            # BreakdownView, PhoneSettings, PushSettings, FeedbackSection
```
