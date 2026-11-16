# Glow Tape: data model

Moved out of CLAUDE.md on 2026-11-16. Migrations in `backend/pb_migrations/` are the source of truth; this is the map.


`users` (+phone/phoneVerified/smsOptIn/ageBand/teenUntil/operator) ·
`orgs` (name, locations JSON) ·
`productions` (org, title, status, joinCode, managers[denormalized user ids],
eventKinds, locations, auditionOpen/Notes/Questions, breakdownStyle, ticketUrl,
quotes, archived[read-only-when-true; enforced by `archive.pb.js`], noBios[migration `1758100000`: whole bio workflow off — Manage → Program bios checkbox; hides Dashboard/Getting-settled bio nudges, To-Do BioEditor + bio-kind tasks, ProgramPacket bios; `bios/request` route refuses]) ·
`members` (production, user?, role, position, roleCode, manager, multi,
claimedFrom, minor, displayName, guardians[], noPhotos, bio) — THE identity
row; pre-cast roles have empty user; children never have users ·
`events` (called[member ids; empty=everyone], calledNote, kind, status,
units[]) · `acks` · `conflicts` · `attendance` (event+member unique; readable by managers/operator + that member's own user/guardians only) ·
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

