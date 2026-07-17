import { pbDate } from './types.ts'
import type { ConflictRecord, EventRecord } from './types.ts'

// One place that decides "does this conflict collide with this event?" —
// used by Manage's ⚠ alerts (and future availability tools). Two kinds:
// date ranges (all-day, stored as UTC dates) and weekly busy-hours patterns
// (days-of-week + local times, e.g. work Mon–Fri 9–5).

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function isWeekly(c: ConflictRecord): boolean {
  return Array.isArray(c.days) && c.days.length > 0 && !!c.fromTime && !!c.toTime
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')}${ampm}`
}

// "Mon, Wed, Fri 9:00am–5:00pm"
export function weeklyLabel(c: ConflictRecord): string {
  const days = [...(c.days ?? [])].sort().map((d) => DAY_SHORT[d] ?? '?')
  return `${days.join(', ')} ${formatTime12(c.fromTime)}–${formatTime12(c.toTime)}`
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function conflictHitsEvent(c: ConflictRecord, ev: EventRecord): boolean {
  const s = pbDate(ev.start)
  const evDay = localDay(s)
  const from = String(c.start).slice(0, 10)
  if (isWeekly(c)) {
    if (evDay < from) return false
    if (c.end && evDay > String(c.end).slice(0, 10)) return false
    if (!c.days!.includes(s.getDay())) return false
    const startMin = s.getHours() * 60 + s.getMinutes()
    const e = ev.end ? pbDate(ev.end) : null
    // an event ending on a later day effectively runs to midnight; no end
    // recorded = treat it as a point in time
    const endMin = e ? (localDay(e) === evDay ? e.getHours() * 60 + e.getMinutes() : 24 * 60) : startMin + 1
    return startMin < toMin(c.toTime) && endMin > toMin(c.fromTime)
  }
  const to = String(c.end || c.start).slice(0, 10)
  return evDay >= from && evDay <= to
}
