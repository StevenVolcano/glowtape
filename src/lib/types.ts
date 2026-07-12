export type MemberRole = 'director' | 'asst_director' | 'stage_manager' | 'performer' | 'crew'

export const ROLE_LABELS: Record<MemberRole, string> = {
  director: 'Director',
  asst_director: 'Assistant Director',
  stage_manager: 'Stage Manager',
  performer: 'Performer',
  crew: 'Crew',
}

export const MANAGER_ROLES: MemberRole[] = ['director', 'asst_director', 'stage_manager']

export interface UserRecord {
  id: string
  email: string
  name: string
  phone: string
  phoneVerified: boolean
  smsOptIn: boolean
}

export interface ProductionRecord {
  id: string
  org: string
  title: string
  status: 'planning' | 'rehearsal' | 'performance' | 'closed'
  joinCode: string
  managers: string[]
  eventKinds: string[] | null
  locations: string[] | null
}

export const DEFAULT_EVENT_KINDS = [
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
  multi: boolean // shared role placeholder (Ensemble, Crew) — claimable by many
  claimedFrom: string // claimer rows point back at their shared placeholder
  expand?: { user?: UserRecord }
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

// For all-day values (conflicts): format in UTC so "2026-07-15 00:00:00Z"
// reads as July 15 everywhere, not July 14 in Pacific time.
export function formatDay(iso: string): string {
  return dayFmtUTC.format(pbDate(iso))
}
