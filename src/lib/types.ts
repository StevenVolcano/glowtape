export type MemberRole =
  | 'director'
  | 'asst_director'
  | 'stage_manager'
  | 'performer'
  | 'crew'
  | 'guardian'

export const ROLE_LABELS: Record<MemberRole, string> = {
  director: 'Director',
  asst_director: 'Assistant Director',
  stage_manager: 'Stage Manager',
  performer: 'Performer',
  crew: 'Crew',
  guardian: 'Parent / Guardian',
}

export const MANAGER_ROLES: MemberRole[] = ['director', 'asst_director', 'stage_manager']

export interface UserRecord {
  id: string
  email: string
  name: string
  // phone/phoneVerified/smsOptIn and ageBand are HIDDEN fields (migrations
  // 1755500000, 1757600000) — absent from API responses. Own phone status
  // comes from /api/glowtape/phone/status, own age band from /api/glowtape/me.
  phone: string
  phoneVerified: boolean
  smsOptIn: boolean
  ageBand: '' | 'adult' | 'teen'
  operator: boolean
}

export interface FeedbackRecord {
  id: string
  user: string
  kind: 'idea' | 'problem' | 'question' | 'praise'
  message: string
  page: string
  status: '' | 'new' | 'planned' | 'done' | 'declined'
  reply: string
  created: string
  expand?: { user?: UserRecord }
}

// Flip to true when Twilio's toll-free verification clears and texting goes
// live — it reveals the phone/SMS UI (sign-in by text, text reminders).
export const SMS_READY = true

export interface CompanyRecord {
  id: string
  name: string
  ticketUrl?: string
  org?: string // the orgs.id this company runs its productions under, if any
}

export interface AccessCodeRecord {
  id: string
  code: string
  note: string
  expires: string
  active: boolean
  created: string
}

export interface ProductionRecord {
  id: string
  org: string
  title: string
  status: 'planning' | 'rehearsal' | 'performance' | 'closed'
  joinCode: string
  managers: string[]
  eventKinds: string[] | null
  locations: unknown[] | null // strings or {name, address} objects
  writtenBy: string
  description: string
  auditionOpen: boolean
  auditionNotes: string
  auditionQuestions: string[] | null
  breakdownStyle: '' | 'songs' | 'scenes' | 'pages'
  ticketUrl?: string
  quotes: string[] | null // director-entered lines for the Tonight page
  expand?: { org?: OrgRecord }
}

export interface CreditRow {
  year: string
  company: string
  show: string
  role: string
}

export interface ProfileRecord {
  id: string
  user: string
  headshot: string
  pronouns: string
  experience: string
  skills: string
  credits: CreditRow[] | null
  expand?: { user?: UserRecord }
}

export interface CastDraftRecord {
  id: string
  production: string
  assignments: Record<string, string> | null // role member id -> user id
  status: '' | 'draft' | 'final'
}

export interface CommunityEvent {
  id: string
  title: string
  kind: string
  start: string
  end: string
  location: string
  production: string
  productionTitle: string
  org: string
  auditionOpen: boolean
  ticketUrl?: string
}

// Event kinds that appear on the public community calendar.
export function isCommunityKind(kind: string): boolean {
  const k = kind.toLowerCase()
  return k.includes('audition') || k.includes('performance')
}

export interface AnnotationRecord {
  id: string
  production: string
  resource: string
  user: string
  page: number
  x: number
  y: number
  text: string
  scope: 'production' | 'personal'
  kind?: 'pin' | 'draw' | 'highlight' | 'box'
  color?: string
  path?: { x: number; y: number }[] | null
  done: boolean
  created: string
  expand?: { user?: UserRecord }
}

export type LineNoteKind = 'dropped' | 'paraphrased' | 'skipped' | 'jumped' | 'called'

export const LINE_NOTE_LABELS: Record<LineNoteKind, string> = {
  dropped: 'Dropped line',
  paraphrased: 'Paraphrased',
  skipped: 'Skipped ahead',
  jumped: 'Jumped a cue',
  called: 'Called for line',
}

export interface LineNoteRecord {
  id: string
  production: string
  resource: string
  member: string
  author: string
  page: number
  x: number
  y: number
  kind: LineNoteKind
  text: string
  snippet: string
  done: boolean
  notified: boolean
  created: string
  expand?: { author?: UserRecord; member?: MemberRecord; resource?: ResourceRecord }
}

export interface GroupRecord {
  id: string
  production: string
  name: string
  order: number
  auto?: 'cast' | 'crew' | '' // system groups whose membership syncs from roles
}

export interface UnitRecord {
  id: string
  production: string
  name: string
  act: string
  pages: string
  groups: string[] | null
  order: number
  onstage: string[]
  singing: string[]
  dancing: string[]
  notes: string
}

export interface NoteRecord {
  id: string
  production: string
  author: string
  title: string
  body: string
  created: string
  updated: string
  expand?: { author?: UserRecord }
}

export interface ResourceRecord {
  id: string
  production: string
  area: 'show' | 'audition'
  title: string
  url: string
  file: string
  audience?: 'everyone' | 'team'
  order: number
}

export interface AuditionRecord {
  id: string
  production: string
  user: string
  roles: string
  conflicts: string
  conflictDates: { start: string; end: string; note: string }[] | null
  answers: Record<string, string> | null
  created: string
  expand?: { user?: UserRecord }
}

export interface OrgRecord {
  id: string
  name: string
  locations: unknown[] | null
}

export interface Place {
  name: string
  address: string
}

export function normalizePlaces(list: unknown): Place[] {
  if (!Array.isArray(list)) return []
  return list
    .map((x) =>
      typeof x === 'string'
        ? { name: x, address: '' }
        : {
            name: String((x as Place)?.name ?? ''),
            address: String((x as Place)?.address ?? ''),
          },
    )
    .filter((p) => p.name)
}

// Production's own places first, then the company's, deduped by name.
export function productionPlaces(p: ProductionRecord): Place[] {
  const merged = [...normalizePlaces(p.locations), ...normalizePlaces(p.expand?.org?.locations)]
  const seen = new Set<string>()
  return merged.filter((pl) => {
    const key = pl.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function placeLine(places: Place[], name: string): string {
  if (!name) return ''
  const hit = places.find((pl) => pl.name.toLowerCase() === name.toLowerCase())
  return hit?.address ? `${hit.name}, ${hit.address}` : name
}

export function mapsUrl(places: Place[], name: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeLine(places, name))}`
}

// A safe href for an operator-typed external link: prepend https:// when they
// paste a bare domain ("driftwood.org/tickets"), leave real schemes alone.
export function externalHref(url: string): string {
  const u = (url || '').trim()
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

export const DEFAULT_EVENT_KINDS = [
  'Auditions',
  'Rehearsal',
  'Table Read',
  'Blocking',
  'Music',
  'Choreography',
  'Run-Through',
  'Tech',
  'Dress',
  'Performance',
  'Strike',
  'Cast Party',
  'Work Party',
]

// Native share sheet when available (mobile), clipboard otherwise.
export async function shareInvite(code: string, title: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const url = `${window.location.origin}/?code=${encodeURIComponent(code)}`
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Glow Tape', text: `Join ${title} on Glow Tape`, url })
      return 'shared'
    } catch {
      return 'cancelled'
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}

export const TAGLINE = 'Glow Tape helps you find your way backstage.'

export function copyrightLine(): string {
  const y = new Date().getFullYear()
  return `© ${y > 2026 ? '2026–' + y : '2026'} Zucchini Volcano LLC`
}

export interface MemberRecord {
  id: string
  production: string
  user: string // '' = pre-cast placeholder role
  role: MemberRole
  groups: string[] | null
  roleNotes: string
  position: string
  roleCode: string
  manager: boolean // grants the Manage tab; synced server-side to productions.managers
  multi: boolean // shared role placeholder (Ensemble, Crew) — claimable by many
  claimedFrom: string // claimer rows point back at their shared placeholder
  minor: boolean // guardian-managed child: never has a login
  displayName: string // child's shown name (first name + last initial)
  guardians: string[] // guardian user ids — each sees everything this member sees
  noPhotos: boolean // photo-consent flag (guardian/manager set)
  // Hidden fields since migration 1757600000 — absent from API responses.
  // Managers read them via GET /api/glowtape/contacts (offline map) and write
  // via POST /api/glowtape/members/contact.
  contactEmail: string // manager-entered, for members not on Glow Tape
  contactPhone: string
  bio: string // program bio, editable by the member/guardian
  expand?: { user?: UserRecord; guardians?: UserRecord[] }
}

export function memberName(m: MemberRecord): string {
  if (m.user) return m.expand?.user?.name || '…'
  return m.displayName || m.position || 'Role'
}

// "Steven Puvogel" -> "Steven P." — how people are identified in chat.
export function firstLastInitial(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.trim()
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

// What the operator is called inside productions they're not a member of.
// One string to change if the title ever stops being fun.
export const STAGEHAND_TITLE = 'Glow Tape Stagehand'

// Chat byline within a show: "Steven P. (Director)" / "Anna K. (Golde)".
// Guardians read as Parent/Guardian; the character name (position) wins over
// the generic role label. Without a member match (community channels), just
// the shortened name.
export function chatName(fullName: string, member?: MemberRecord | null): string {
  const short = firstLastInitial(fullName)
  if (!member) return short
  const role = member.position || ROLE_LABELS[member.role] || ''
  return role ? `${short} (${role})` : short
}

export interface EventRecord {
  id: string
  production: string
  title: string
  start: string
  end: string
  location: string
  notes: string
  called: string[]
  calledNote: string
  status: '' | 'scheduled' | 'cancelled'
  kind: string
  calledGroups: string[] | null
  units: string[] // breakdown units being rehearsed (called is still authoritative)
  signinCode: string // non-empty = door check-in is on for this event
  timeline: TimelineItem[] | null // run-of-show segments; clock times computed from start
  bringCategories: string[] | null // non-empty = potluck sign-up list is on
}

export interface BringItemRecord {
  id: string
  production: string
  event: string
  user: string
  item: string
  category: string
  created: string
  expand?: { user?: UserRecord }
}

// A run-of-show segment: durations only — clock times always roll forward
// from the event start, so edits shift everything after them.
export interface TimelineItem {
  title: string
  minutes: number
}

export interface TimelineTemplateRecord {
  id: string
  production: string
  name: string
  items: TimelineItem[] | null
  created: string
}

export interface TaskRecord {
  id: string
  production: string
  title: string
  department: string
  assignee: string
  due: string
  done: boolean
  kind: string // 'bio' for auto-generated bio requests
}

export interface TrackerItemRecord {
  id: string
  production: string
  tracker: 'props' | 'costumes' | 'set' | 'light_cues' | 'sound_cues'
  name: string
  a: string
  b: string
  c: string
  status: string
  notes: string
  order: number
}

export interface AttendanceRecord {
  id: string
  event: string
  member: string
  status: 'present' | 'late' | 'absent'
  note: string
}

export interface AckRecord {
  id: string
  event: string
  user: string
}

export interface SlotRecord {
  id: string
  production: string
  title: string
  start: string
  minutes: number
  location: string
  member: string // '' = open, otherwise booked by this member
  created: string
}

export interface ShowReportRecord {
  id: string
  production: string
  event: string
  author: string
  audience: number
  houseOpen: string
  curtainUp: string
  curtainDown: string
  technical: string
  incidents: string
  notes: string
  created: string
}

export interface ConflictRecord {
  id: string
  production: string
  user: string
  // Set = this conflict is ABOUT that member row (a parent entered it for
  // their child); empty = the author's own, applying to all their rows.
  member: string
  start: string
  end: string
  note: string
  series: string // shared id across a recurring series' materialized rows
  // Weekly busy hours ("work Mon–Fri 9–5"): days + both times present makes
  // this a weekly pattern; start/end become the effective from/until dates.
  days: number[] | null // 0=Sunday … 6=Saturday
  fromTime: string // "17:00"
  toTime: string // "21:00"
  expand?: { user?: UserRecord }
}

export interface ChannelRecord {
  id: string
  production: string
  name: string
  group?: string
  // 'cast'/'crew' are legacy — such channels became 🔒 group channels
  // (migration 1757500000); only 'all' and 'team' can exist now.
  audience: 'all' | 'cast' | 'crew' | 'team'
  archived: boolean
  defaultMuted: boolean
  member: string // set = semi-private: that member + guardians + managers only
}

export interface ProductionRequestRecord {
  id: string
  user: string
  org: string
  title: string
  role: 'director' | 'asst_director' | 'stage_manager' | 'producer'
  timeline: string
  castSize: string
  minors: boolean
  notes: string
  status: '' | 'new' | 'approved' | 'declined'
  reply: string
  created: string
  expand?: { user?: UserRecord }
}

export interface ChannelPrefRecord {
  id: string
  channel: string
  user: string
  muted: boolean
}

export interface MessageRecord {
  id: string
  channel: string
  author: string
  text: string
  image: string
  created: string
  expand?: { author?: UserRecord }
}

export interface ReactionRecord {
  id: string
  message: string
  user: string
  emoji: string
}

export interface AnnouncementRecord {
  id: string
  production: string
  author: string
  title: string
  body: string
  pinned: boolean
  created: string
  expand?: { author?: UserRecord }
}

export interface AnnouncementAckRecord {
  id: string
  announcement: string
  user: string
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})
const dayFmtUTC = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

// PocketBase returns "2026-07-15 19:00:00.000Z"; Safari refuses the space.
export function pbDate(value: string): Date {
  return new Date(value.replace(' ', 'T'))
}

export function formatWhen(start: string, end?: string): string {
  const s = pbDate(start)
  let out = `${dateFmt.format(s)}, ${timeFmt.format(s)}`
  if (end) {
    out += ` – ${timeFmt.format(pbDate(end))}`
  }
  return out
}

// For all-day values (conflicts, due dates): format in UTC so
// "2026-07-15 00:00:00Z" reads as July 15 everywhere, not July 14 in Pacific.
export function formatDay(iso: string): string {
  return dayFmtUTC.format(pbDate(iso))
}

// For real timestamps (created/updated): the viewer's local calendar day —
// a note written Sunday evening must not say Monday just because UTC rolled.
export function formatStamp(iso: string): string {
  return pbDate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
