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
  auditionOpen: boolean
  auditionNotes: string
  auditionQuestions: string[] | null
  breakdownStyle: '' | 'songs' | 'scenes' | 'pages'
  expand?: { org?: OrgRecord }
}

export interface ProfileRecord {
  id: string
  user: string
  headshot: string
  pronouns: string
  experience: string
  skills: string
  expand?: { user?: UserRecord }
}

export interface UnitRecord {
  id: string
  production: string
  name: string
  act: string
  pages: string
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
  order: number
}

export interface AuditionRecord {
  id: string
  production: string
  user: string
  roles: string
  conflicts: string
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

export function copyrightLine(): string {
  const y = new Date().getFullYear()
  return `© ${y > 2026 ? '2026–' + y : '2026'} Zucchini Volcano LLC`
}

export interface MemberRecord {
  id: string
  production: string
  user: string // '' = pre-cast placeholder role
  role: MemberRole
  position: string
  roleCode: string
  manager: boolean // grants the Manage tab; synced server-side to productions.managers
  multi: boolean // shared role placeholder (Ensemble, Crew) — claimable by many
  claimedFrom: string // claimer rows point back at their shared placeholder
  minor: boolean // guardian-managed child: never has a login
  displayName: string // child's shown name (first name + last initial)
  guardians: string[] // guardian user ids — each sees everything this member sees
  noPhotos: boolean // photo-consent flag (guardian/manager set)
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
  units: string[] // breakdown units being rehearsed (called is still authoritative)
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

export interface ConflictRecord {
  id: string
  production: string
  user: string
  start: string
  end: string
  note: string
  expand?: { user?: UserRecord }
}

export interface ChannelRecord {
  id: string
  production: string
  name: string
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
