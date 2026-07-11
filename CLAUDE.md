# CLAUDE.md

This file documents the repository for AI assistants working in this codebase.
Update it as the project evolves.

## Repository Overview

- **Repo**: `StevenVolcano/glowtape` on GitHub
- **Purpose**: Glow Tape (glowtape.net) — free production and rehearsal management
  for the Grays Harbor community-theater scene (Driftwood Players, Bishop Center,
  Stage West, Plank Island, 7th Street Kids, schools). Schedules with who-is-called
  and acknowledgments, conflict collection, channels/announcements, contact sheets,
  SMS reminders, calendar feeds. Free forever, self-hosted, no AI in the product
  (the community is AI-averse — all features are deterministic).
- **Stack**: Vite + React + TypeScript PWA frontend; PocketBase backend (single
  binary, SQLite) with JS migrations and hooks. One VPS runs everything.
- **Plan**: `planning/glowtape.md` is the product plan — read it before adding
  features. Phases: 1 pilot core (built) → 2 trackers/reports → 3 script room &
  line tools → 4 community hub.

## Repository Structure

```
/
├── CLAUDE.md
├── planning/glowtape.md   # product plan, decisions, roadmap, research summary
├── index.html / vite.config.ts / tsconfig.json / package.json
├── backend/
│   ├── README.md          # run/deploy/SMS setup + first-run verification checklist
│   ├── pb_migrations/     # schema (applied automatically by PocketBase)
│   ├── pb_hooks/          # glowtape.pb.js (signup/join/email), sms.pb.js, calendar.pb.js
│   └── pb_data/           # runtime DB + files (gitignored — THE thing to back up)
├── public/                # PWA manifest, service worker, icons
├── scripts/
│   ├── get-pocketbase.sh  # downloads the pocketbase binary into backend/
│   └── make-icons.mjs     # regenerates PNG icons (no image deps)
└── src/
    ├── lib/               # pb client, types/formatting, auth context, calendar helpers
    ├── pages/             # SignIn, Home, Production shell + Schedule/Messages/People/Admin tabs
    └── components/        # PhoneSettings, shared pieces
```

## Domain Notes

- **Ease-of-use constitution** (see plan §5, non-negotiable): no passwords (email/SMS
  one-time codes), fully functional in a plain browser tab, every notification
  mirrors to email, people see only productions they're in, everything important
  prints cleanly, big tap targets, no jargon in UI copy.
- **Authorization model**: `productions.managers` is a denormalized user-id list
  (directors/ADs/SMs) kept in sync by the app; API rules check it plus membership
  back-relations. Channel audience filtering is UI-only in the pilot.
- **SMS is dormant by default**: activates via `GLOWTAPE_SMS_PROVIDER` env vars
  (see `backend/README.md`). Reminders at ~10h and ~2h; codes only to verified
  phones; phone fields locked server-side.
- **Script licensing**: never build features that distribute scanned licensed
  scripts. Per-production private materials, rights checkbox, public domain first.
  See plan §4.
- **Backend was authored without a live server** — `backend/README.md` has the
  first-run verification checklist. Until it's been walked once, treat migration/
  hook runtime behavior as unverified.
- PocketBase datetimes are `"YYYY-MM-DD HH:MM:SS.sssZ"` (space, not T) — always
  parse via `pbDate()` in `src/lib/types.ts`; Safari rejects the raw format.

## Development Workflow

```sh
npm install
npm run setup-backend   # once: downloads pocketbase binary
npm run backend         # :8090 — create superuser on first run
npm run dev             # :5173 — proxies /api to the backend
npm run build           # typecheck + production build (run before pushing)
```

## Branch & Commit Conventions

- Feature branches: `feature/<short-description>` or `claude/<task-slug>`
- Never push directly to `main` without review (initial scaffold commit excepted)
- Always push with `git push -u origin <branch-name>`
- Commits: imperative mood, subject < 72 chars, no trailing period; explain *why*
  in the body when non-obvious

## Code Conventions

- Prefer clarity over cleverness; match surrounding style
- Comments only for non-obvious *why*; delete dead code
- UI copy is plain English for all ages ("Who's called", not "Roster matrix")
- Never commit secrets; SMS/SMTP credentials live in server env vars only
- Keep changes minimal and scoped to what was requested

## AI Assistant Instructions

- Read this file and skim `planning/glowtape.md` at the start of every session
- Update "Repository Structure" when adding directories or major files
- Do not create documentation files unless explicitly asked
- Do not add AI-powered features — deterministic behavior only, per the plan
- Do not push to `main` or force-push without explicit user approval
