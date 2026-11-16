# CLAUDE.md

Standing instructions for AI sessions in this repo. **Keep this file under
2,000 words.** Feature detail goes in `docs/features.md`, schema in
`docs/data-model.md`, server operations in `docs/runbook.md`. When a decision
changes, edit the line it changes; never append "this replaces X below".

## Overview

- **Repo**: `StevenVolcano/glowtape`. **Live at https://glowtape.net** on a $6
  DigitalOcean droplet (Ubuntu 24.04) behind Caddy.
- **Purpose**: free production and rehearsal management for the Grays Harbor
  community-theater scene (Driftwood Players, Bishop Center, Stage West, Plank
  Island, 7th Street Kids, schools). Self-hosted by Steven Puvogel (Zucchini
  Volcano LLC). Every feature is deterministic.
- **Stack**: Vite + React 19 + TypeScript PWA; PocketBase v0.30 (Go, SQLite)
  with JS migrations (`backend/pb_migrations/`, append-only) and JS hooks
  (`backend/pb_hooks/`, shared helpers in `glowtape_lib.js`). PocketBase serves
  the build from `backend/pb_public/`. A Node sidecar (`deploy/push-sender/`)
  does Web Push and WebAuthn crypto on 127.0.0.1:8666.
- **Before touching a feature**, read its row in `docs/features.md`. After
  changing it, update that row and `public/help.html` (the user manual Steven's
  community reads).

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
5. **No dynamic bracket access on collection objects in migrations** —
   `c[prop] = rule` and `const r = c[prop]` silently no-op in the PB JSVM
   (bit us in `1757400000_operator_access.js`: its whole wrap loop did
   nothing; fixed by `1757800000_operator_access_take2.js`). Always use
   static dot access (`c.listRule = ...`), coerce reads with `String()`
   (rules can come back as wrapped objects — never trust `typeof`), and
   test migrations against goja-ish mocks, not plain JS objects.
6. **No Intl in the PB JSVM** — Pacific-time math is manual
   (`lib.pacificOffsetHours/pacificHour/formatPacific`).
7. **JSVM can't do Web Push crypto** — pushes go through the Node sidecar
   (`deploy/push-sender/server.mjs`, systemd unit `glowtape-push`, localhost
   only). Everything is no-op until `GLOWTAPE_VAPID_*` env vars exist.
8. **Locked user fields**: `phone`, `phoneVerified`, `operator` cannot be
   changed via the record API (guard hook in `sms.pb.js`).
9. **Events are edited only through the routes** (`/api/glowtape/events`,
   `/api/glowtape/events/update`) so emails digest correctly and acks/reminders
   reset on date/time/place changes. The only raw-record event update the app
   does is status (cancel/restore), which the cancel hook + push hook watch.
10. **`chown -R glowtape:glowtape backend`** after touching server files;
   services run as user `glowtape`.
11. **Archived-show read-only** (`productions.archived`) is enforced in
    `pb_hooks/archive.pb.js` via `onRecord{Create,Update,Delete}Request` guards
    over every production-scoped content collection — these fire only on API
    record requests, NOT on programmatic `app.save()` or internal cascades, so
    the app's own bookkeeping is never blocked. Content written through a custom
    route (events, casting/finalize, slots/book, attendance/*, bios/request,
    members/contact, team-channel, line-notes/send) bypasses the request guard,
    so each of those routes calls `lib.assertNotArchived(production)`. If you
    add a production-scoped collection, add it to `archive.pb.js`'s list; if you
    add a write route, call `assertNotArchived` — otherwise it stays writable on
    archived shows. `channel_prefs` (muting) is intentionally left writable.
12. **No `null` defaults in `new DynamicModel({...})`** — PB types each field
    from its default, so `null` leaves it untyped and `e.bindBody()` panics
    (nil pointer → bare 500). Use `""`/`0`/`[]`/`false`, or read
    `e.requestInfo().body` when "left out" must differ from "" (contacts.pb.js).

13. **Every API rule that mentions `@request.auth` starts with
    `@request.auth.id != '' &&`** (migration `1759200000_signed_in_only.js`,
    2026-10-24). Unclaimed role rows and children have `user = ''`, and a
    signed-out request has `@request.auth.id = ''`, so a bare
    `members_via_production.user ?= @request.auth.id` or
    `member.user = @request.auth.id` clause matches ANYONE on the internet —
    before the fix the record API served members, events, messages, notes,
    children's conflicts/attendance to signed-out requests and let them edit
    or delete unclaimed member rows. New collections and rule rewrites must
    keep the guard at the front.

14. **JSON fields in hooks**: `record.get()` on a json field returns raw bytes
    that goja reports as an array of numbers. Parse `String(v)` (or
    `lib.readJson`); never trust `Array.isArray`.
15. **Rule quirks in PB 0.30**: in filters, `dmUsers.id ?= 'literal'` returns
    nothing (use `dmUsers ~ id`). goja regex is RE2: no repeat counts over
    1000. Any migration that rewrites a collection's rules must re-append the
    operator (Stagehand) clause.
16. **pdfjs-dist is pinned to v4.10.38**; v5+ renders blank on current phone
    browsers. Keep the script-room route lazy (the chunk is ~480KB).
17. **Hidden fields**: users.phone/smsOptIn/ageBand/teenUntil and
    members.contactEmail/contactPhone are API-hidden. Read and write them only
    through their routes (`/api/glowtape/me`, `phone/status`, `contacts`,
    `members/contact`), never from the auth record.

## Conventions

- **Ease-of-use constitution** (non-negotiable): no passwords, works in a plain
  browser tab, every notification mirrors to email, people see only their
  productions, everything important prints, big tap targets, plain English for
  all ages.
- **Accessibility is a maintained bar** (WCAG 2.2 AA): label every input, name
  icon-only buttons, `role="status"`/`"alert"` on feedback, `aria-pressed` on
  toggle chips, `aria-expanded` on disclosures, contrast ≥ 4.5:1 text / 3:1
  controls, `useTitle()` on new pages, 44px targets. Placeholders are italic
  and samples start "Example:".
- **Youth safety invariants**: no DMs involving anyone under 18, no under-13
  logins, no birthdates, no health fields; private channels always include all
  managers and guardians. Say so in any new documentation.
- **"Managers", not "production team"** for anything gated by Manage access.
  "Production team" is only the real team list and the role group of that name.
- **One email per human action**; bulk operations send one digest.
- Chat identity is "First L. (Role)" via `chatName()`.
- Recipients (email/SMS/push) always go through `lib.recipients` /
  `lib.recipientUserIds`: a member resolves to their user plus all guardians.
- Never build features that distribute licensed scripts.
- **AI wording**: don't promise "no AI". The one promise kept: user data is
  never used for AI training. No AI-powered features unless Steven asks.
- **Pricing wording** (free for Grays Harbor; always free for cast, crew and
  families; cost recovery for other companies) must match across terms.html,
  help.html, why-glowtape.html, RequestProduction.tsx and Home.tsx.
- Never commit secrets. Server env lives in `/etc/glowtape/env`; credentials
  never pass through chat (write commands that set them on the droplet).

## Development workflow

```sh
npm install
npm run setup-backend   # once: downloads the pocketbase binary
npm run backend         # :8090
npm run dev             # :5173, proxies /api to the backend
npm run build           # typecheck + build (MUST pass before pushing)
node --check backend/pb_hooks/<file>.pb.js
```

Verify hooks and migrations against the real PocketBase binary, not mocks. The
sandbox can't reach the live server; Steven verifies deploys from his phone.
Deploy: Steven runs `glowtape-update` on the droplet (pulls `main`, builds,
restarts). Never ask him to run anything interactive.

## Branches and commits

- Feature branches `claude/<task-slug>`, then ff-merge to `main` and push
  (Steven deploys from main). If the session assigns a branch, use it instead.
  Never force-push.
- Imperative subject < 72 chars, no trailing period; the *why* in the body.
