# Lessons from Glow Tape → a check-in & notification app for an LGBTQ teen group

A working document distilled from building and operating glowtape.net
(2026). Glow Tape's job was coordination; the new app's job is **safety and
anonymity**. Most of the engineering carries over directly. The *safety
model* does not — in one critical place it inverts. That inversion is the
most important thing in this report, so it goes first.

---

## 1. The big inversion: guardians are not the safety mechanism here

Glow Tape's youth-safety model is built on **parental visibility**: no
under-13 accounts, guardians hold children's roles, guardians get every
notification, no DMs anywhere, "private" messages always include the whole
production team. The threat model was *unsupervised adult–child contact*,
and transparency to parents was the defense.

For LGBTQ teens, **the home can be the threat**. A closeted teen whose
parent reads their phone can be outed by an app icon, a push notification,
a text on a family bill, or a browser history entry. Every Glow Tape
mechanism that deliberately routed information *to* guardians would here
route it to potentially the most dangerous person in the teen's life.

So: keep the *discipline* of Glow Tape's youth-safety thinking (invariants
written down, enforced server-side, never bypassable from the client), but
derive new invariants from the new threat model. Candidate replacements:

- **Vetted adult facilitators** replace guardians as the accountable
  adults. No adult–teen 1:1 private channels — same rule as Glow Tape
  (there it was "all managers included"; here "at least two facilitators
  included" or group-visible).
- **The teen controls disclosure.** Nothing the app does should reveal
  membership to anyone the teen didn't choose — not parents, not peers.
- **Age gating still matters** (a group for 13–18 needs to keep adults
  out as much as it once kept them looped in). Vetting via the group's
  real-world intake, not via the app collecting identity documents.

Legal footnote for the deep-dive later: facilitators may be mandatory
reporters in WA; a check-in feature that can receive crisis disclosures
needs a written protocol (and prominent links to trained services — e.g.
The Trevor Project, 988) *before* launch, not after the first incident.

## 2. Anonymity is a data-collection decision, not a feature

Glow Tape collects little (name, email, age band — never birthdate, never
health info) and that restraint paid off repeatedly. Go much further here:

- **Chosen name only.** No legal names anywhere. No "first name, last
  initial" convention — that was for a cast list; here even that is too
  identifying. Let people be "River" and nothing else.
- **No photos at all.** Glow Tape banned teen headshots; this app should
  have no image upload, period (photos out people, and EXIF strips are
  easy to get wrong — we deferred EXIF stripping in Glow Tape and it's
  still on the backlog; don't create that liability at all).
- **Age band, never birthdate** — carried over directly; it worked.
- **The database should be boring to steal.** Design so that a full DB
  dump reveals: some chosen names, some email addresses, check-in
  timestamps. If a field would be dangerous in a subpoena, breach, or a
  stolen laptop, don't collect it. You cannot leak what you don't store.
- **Check-ins should evaporate.** Glow Tape keeps attendance forever
  (directors want history). Here, auto-delete check-in records on a short
  clock (days, not months) — a cron hook, same pattern as Glow Tape's
  reminder cron. Long-term "who attended what" is a membership ledger;
  nobody needs it and someone could be hurt by it.
- **Log hygiene.** Glow Tape stores request IPs on verification codes for
  rate limiting, and Caddy logs IPs by default. For this app: hash or
  drop IPs, shorten log retention, and turn off anything that builds an
  attendance-correlated access log. (Also check the droplet's automatic
  backups — Glow Tape snapshots weekly; snapshots of evaporating data
  un-evaporate it. Exclude or encrypt.)

## 3. The phone itself is the exposure surface

Lessons that were conveniences in Glow Tape become safety features here:

- **Notification text must be innocuous.** Glow Tape pushes say the show
  and the message. Here every push should read like nothing: a neutral
  app name, generic body ("You have an update"), detail only after
  opening. We already route all push through one helper
  (`lib.sendPush`) — one choke point makes a "no sensitive content in
  notifications" rule enforceable in one place. Copy that architecture.
- **SMS is disqualifying for this population.** Beyond the Twilio pain
  (below): texts appear on family bills, in carrier records, and on lock
  screens of monitored phones. Glow Tape's SMS layer should simply not
  exist here. Web push (which we built and have working) is the safer
  channel — no phone number collected, no carrier trail, revocable
  per-device.
- **PWA over app store — even more true here.** No app purchase history,
  no icon that announces itself, works in a private browsing tab.
  Trade-off learned on Glow Tape: iOS only allows push for
  home-screen-installed PWAs — an installed icon is visible on the
  phone. Let each teen choose their exposure: installed-with-push or
  browser-only-no-push. Make that choice explicit in onboarding.
- **Quick exit.** Standard for DV/LGBTQ resources, no analog in Glow
  Tape: a one-tap button that swaps the tab to a boring site and clears
  sensitive on-screen state. Cheap to build, expected by this audience.
- **Assume shared/monitored devices.** Glow Tape caches the session in
  localStorage forever (fine for theater). Here: short sessions, an easy
  sign-out, an optional PIN re-check, and no names on screen until past
  it. Also skip "remember my email" affordances.
- **Email is identity — and email can be monitored.** Passwordless OTP
  by email (Glow Tape's model, which users loved — zero password-reset
  support ever) is still probably right, but let members use whatever
  address they choose, never verify identity against it beyond inbox
  possession, and keep sender name/subject lines neutral. The email
  *changing* flow we just built (code to the new inbox proves ownership)
  transfers directly and matters more here.

## 4. Engineering lessons that transfer directly (the boring gold)

Stack: **PocketBase (Go binary + SQLite) + Vite/React PWA + Caddy on a $6
DigitalOcean droplet** ran a full production app with push notifications,
cron jobs, and email for ~$8/month all-in. Total operational sovereignty —
no third-party service sees the data except the email relay. For an
anonymity-critical app, self-hosting is not just cheap, it's the point.
Specific carryovers, with the scars that taught them:

1. **PocketBase JS hooks run each handler in an isolated VM.** Shared
   helpers must live in one lib file and be `require()`d *inside every
   handler*. We lost hours to this; start with the `glowtape_lib.js`
   pattern (one lib, `toIdArray`, `pbNow`, mail/push senders, code
   hashing).
2. **Migrations are append-only; create structure first, set rules
   last.** Rules referencing back-relations validate at save time.
3. **Datetimes**: PB stores `YYYY-MM-DD HH:MM:SS.sssZ` (space, not T) —
   Safari's `Date` parser rejects it. One `pbDate()` helper everywhere;
   separate helpers for date-only vs timestamp rendering (UTC vs local
   day — we shipped a visible bug conflating them). No `Intl` in the
   JSVM; timezone math is manual.
4. **Server-side enforcement only.** Everything safety-critical in Glow
   Tape is a collection rule or a route check; the client is decoration.
   Glow Tape has one known UI-only privacy seam (contact columns) —
   acceptable for theater, not acceptable here. Budget the schema time
   to make every privacy rule a real API rule.
5. **Sensitive user fields need an update guard.** We protect
   `phone/phoneVerified/operator` in a users-update hook so clients
   can't self-escalate. The new app will have more such fields (role,
   vetted-facilitator flag); same pattern.
6. **One recipient-resolution helper.** All email/push fan-out goes
   through `lib.recipients`/`lib.recipientUserIds`. When the rules about
   *who may be contacted* are safety rules, having exactly one code path
   is what makes them auditable.
7. **Web push needs a Node sidecar** (PB's JSVM can't do the crypto):
   `deploy/push-sender/` — localhost-only HTTP shim, systemd unit,
   returns 503 until VAPID keys exist so the app degrades gracefully.
   Lift it wholesale, including the lockfile (npm ci fails without one —
   learned in production).
8. **Self-updating deploy script** (`glowtape-update`: git pull, cmp
   itself, re-exec if changed, build, restart). Before the self-update
   step existed, a stale installed copy silently skipped new deploy
   steps. Steven deploys from a phone; that constraint kept operations
   honest and it should be the bar here too.
9. **Feature flags for not-yet-ready integrations** (`SMS_READY`): ship
   the code dark, flip one constant later. Any external dependency with
   an approval process gets a flag from day one.
10. **Service-worker staleness is real**: after each deploy someone is
    on the old shell. Version the SW and show an update nudge rather
    than debugging ghosts.
11. **Credentials never pass through chat/repo** — secrets are generated
    on the server into `/etc/glowtape/env`; placeholders elsewhere. For
    this app that rule graduates from hygiene to ethics.
12. **Quiet hours** (9pm–7am, with the "say 'tomorrow' the evening
    before" sweep) — carry over; teens sleep too, and a 7am buzz from a
    sensitive app on a nightstand a parent can see is its own exposure.

## 5. Ease-of-use lessons (the "constitution" holds)

The tech-averse-first rules translate intact, and matter doubly for
stressed teenagers:

- Passwordless email codes: zero support burden, works for every age.
- Big type, big targets, plain words, no mystery icons; WCAG AA contrast
  from day one is cheap; retrofitting isn't.
- **Placeholders must not look like content** — italic + "Example:"
  prefix everywhere (users genuinely thought forms were pre-filled).
- Progressive disclosure over accordions/wizards; one scrolling page
  with a jump-nav beat clever collapsing UI every time.
- **Make the go-live/commit step unmissable** (bordered `.golive` box) —
  users scroll past quiet checkboxes; we learned this twice.
- Friendly, specific error and empty states ("No signups yet — they'll
  collect here") prevented most "is it broken?" questions.
- Keep the in-app help page in lockstep with features; ours is the
  single most-linked page in the app.
- Build the feedback button into v1. The best Glow Tape features came
  from user messages within days of launch.

## 6. Operational lessons

- **Toll-free SMS verification takes weeks and can bounce** (entity
  mismatch between number owner and Trust Hub profile burned ~a month).
  Irrelevant here if SMS is dropped — one more reason to drop it.
- **Email deliverability needs SPF/DKIM/DMARC on a domain you control**
  and a consistent sender; set up before the first user, and tell users
  the sender address for their contacts list.
- Weekly whole-droplet snapshots + a nightly DB backup timer; test a
  restore once. (And see §2: backups vs. data-evaporation policy.)
- Run OS updates on a schedule; we let a kernel update queue linger.
- A single **operator console** inside the app (feedback triage,
  approvals, curated lists) kept day-to-day admin off the raw database
  dashboard — build it early; it's also where a safety app's moderation
  tools will live.
- The operator/admin flag is set in the DB dashboard only, and the app
  **re-fetches the auth record on every load** — flags flipped
  server-side propagate without a re-login (bug we hit and fixed).

## 7. Suggested starting decisions for the new app

1. Same stack (PocketBase + React PWA + Caddy + droplet), new isolated
   droplet and domain with a **neutral name** — separate blast radius
   from Glow Tape, innocuous on a lock screen and in history.
2. Web push only; no SMS layer at all; notification bodies generic.
3. Data floor: chosen name, email (any), age band, check-in timestamps
   with auto-delete. Nothing else. No photos, no legal names, no
   addresses, no health/identity fields.
4. Write the **safety invariants file first** (the new app's equivalent
   of Glow Tape's youth-safety list) and enforce every line as a rule or
   route check: no adult–teen 1:1s, minimum-two-facilitators visibility,
   no membership disclosure, notification-content rules, retention
   clocks.
5. Quick-exit button, short sessions, optional PIN, neutral email
   sender, quiet hours — in v1, not v2.
6. Crisis protocol and resource links (Trevor Project, 988) agreed with
   the group's facilitators before the check-in feature ships.
7. Port wholesale: `glowtape_lib` structure, push sidecar, deploy
   script, migration conventions, placeholder/UX conventions, operator
   console skeleton, feedback workflow.

*Written 2026-07-13 from the Glow Tape build (glowtape.net). The deeper
threat-model workshop for the new app should start from §1–§3.*
