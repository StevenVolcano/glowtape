# Glow Tape — Project Documentation
*Prepared 2026-07-17 for the Memory_Alpha_Redacted archive.*

## What it is

**Glow Tape** (glowtape.net) is a production and rehearsal management app for
community theater, built and operated by Steven Puvogel / Zucchini Volcano LLC.
The name is the metaphor: it helps you find your way backstage. Free forever
for Grays Harbor productions; always free for cast, crew, and families
everywhere; theater companies outside Grays Harbor contribute a modest
cost-recovery amount (no billing built — honor system).

Serves: Driftwood Players, GHC/Bishop Center, Stage West Community Theater,
Plank Island, Willapa Players, 7th Street Kids, and local schools. First big
production run: **Come From Away**.

**The constitution:** ease of use for tech-averse users of every age is
non-negotiable. No passwords (emailed 6-digit codes), no app store (PWA),
no ads, no AI, no data selling. Paper printouts are first-class citizens.
Big type, big targets, plain words, no mystery icons.

## What it does (feature tour)

- **Auditions**: public community calendar announces them; signup form shows
  the show description, author credit, production team, roles as checkboxes
  with per-role casting notes, every performance date + strike with a required
  availability confirmation, structured conflicts (dates + why), custom
  questions. Printable paper form mirrors it. Signups aggregate in-app (no
  per-signup emails). One-tap add-all-audition-times to phone calendar.
- **Casting**: private worksheet (invisible until finalized), dropdowns fed by
  signups + people already in the show + paper-form names, double-cast flags,
  conflict display, early-cast individual roles ("Jesus and Judas first"),
  finalize attaches people to roles and imports their audition conflicts into
  the schedule.
- **Scheduling**: show breakdown (songs/scenes/pages) with who's-in-what
  drives who's-called; role groups (Group A / Leads / Dancers) multi-select on
  roles, units, and events; multi-type rehearsals (Dance + Vocals); per-type
  schedule views and printouts; weekly bulk create; digest-email bulk edits;
  conflicts collected up front; Got-it acknowledgments that reset on changes;
  phone-calendar sync (per-event + subscribed feed).
- **Rehearsal nights**: roll call, late/sick self-reporting (guardians report
  for kids), day-of alerts to staff, nightly 10pm rehearsal report email
  (attendance, overdue tasks, notes).
- **Communication**: announcements with read-tracking, department channels,
  semi-private "message the production team" channels (never 1:1 with the
  whole team always included), community board, web push notifications, quiet
  hours 9pm–7am, chat names as "First L. (Role)", red ⚑ Report to operator.
- **Script room**: PDF scripts/librettos/scores rendered in-app with pin
  annotations — 📌 production notes (staff-created, everyone sees) and 📝
  personal notes (author-only), each with a done checkbox and a per-document
  list that jumps to pages.
- **Paperwork**: props/costumes/set/cue trackers with CSV import/export;
  department to-dos; program bios requested/written/compiled; contact sheet
  (production team only — enforced at the API); community profiles with
  stage-history credits (company dropdown curated by the operator).
- **Operator console** (Steven only, /operator): production requests as a
  guided approval workflow, direct show setup (works even when the director
  has no account yet — emails a manager claim code), feedback triage,
  community access codes, organizations, theater companies + ticket links.

## Architecture

- **Backend**: PocketBase v0.30 (single Go binary, SQLite) on a $6/month
  DigitalOcean droplet (Ubuntu 24.04, IP 143.198.156.136) behind Caddy.
  Business logic in JS hooks (`backend/pb_hooks/`), schema in append-only JS
  migrations (`backend/pb_migrations/`). Every hook handler runs in an
  isolated JS VM — shared helpers live in `glowtape_lib.js` and are
  `require()`d inside each handler.
- **Frontend**: Vite + React 19 + TypeScript PWA, served from
  `backend/pb_public/`, built on deploy. Service worker for offline shell and
  web push. pdf.js (self-hosted) for the script room, lazy-loaded.
- **Web push**: PocketBase's JSVM can't do the crypto, so a tiny Node sidecar
  (`deploy/push-sender/`, systemd unit `glowtape-push`, localhost:8666) sends
  via the `web-push` package. VAPID keys live only in `/etc/glowtape/env`.
- **Email**: SMTP via PocketBase mailer, sender callboard@glowtape.net.
- **SMS**: Twilio toll-free 888-299-GLOW (+1-888-299-4569) — code complete but
  dormant behind a `SMS_READY=false` flag pending toll-free verification
  (in prioritized review as of 2026-07-17; window to 07-23).
- **Deploys**: `glowtape-update` on the droplet (self-updating script: pulls
  main, builds, applies migrations, restarts services). Steven runs it from
  his phone via the DigitalOcean web console.
- **Backups**: weekly DO droplet snapshots + nightly DB backup timer.
- **Repo**: github.com/StevenVolcano/glowtape (branch `main` deploys; the
  deep technical handoff doc for AI assistants is `CLAUDE.md` in the repo
  root — data model, gotchas, runbook, backlog).

## Security & privacy posture

- Contact details sealed at the API (not just the UI): user emails invisible,
  phone fields hidden from all API responses; managers/operator read contacts
  through gated routes only.
- Photos re-encoded on upload — EXIF/GPS stripped, size capped.
- Youth safety: no under-13 logins (guardians hold children's roles and get
  every notice), age bands never birthdates, no DMs anywhere in the app, teen
  headshot ban, photo-consent flags, quiet hours.
- Secrets never pass through chat or the repo — generated directly on the
  droplet into `/etc/glowtape/env`.
- Local-first data: JSON export/import for productions.

## Operational status (as of 2026-07-17)

- Live at glowtape.net; push notifications live; email live.
- SMS pending Twilio toll-free verification: entity issue solved (LLC business
  profile approved), one opt-in-evidence rejection (30513) answered with an
  upgraded public consent page (glowtape.net/sms-opt-in.html), resubmitted
  07-16, verdict pending. When approved: build phone self-status/opt-in
  routes, flip `SMS_READY` in `src/lib/types.ts`, un-"coming soon" the help.
- Related future project: a check-in/notification app for an LGBTQ teen group;
  lessons-learned report seeding it is in the repo at
  `docs/lessons-learned-safety-app.md` (key insight: Glow Tape's
  parental-visibility safety model inverts for that population).

## Key URLs

- App: https://glowtape.net · Help: /help.html · Pitch page: /why-glowtape.html
- Director setup guide: /director-guide.html · Handout: /handout.html
- SMS consent evidence: /sms-opt-in.html
- Admin (PocketBase dashboard, superuser only): https://glowtape.net/_/
