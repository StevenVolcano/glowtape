import { pbDate } from '../lib/types.ts'
import type { EventRecord } from '../lib/types.ts'

// List / Week / Month switcher for the Schedule tab. Week and month only
// change how the same filtered events are laid out — the event cards are
// still ScheduleTab's, so every action on them works the same in any view.

export type ScheduleView = 'list' | 'week' | 'month'

export const VIEW_LABELS: Record<ScheduleView, string> = {
  list: 'List',
  week: 'Week',
  month: 'Month',
}

// Per-viewer conveniences only — storage can be blocked, so never throw.
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private window — the choice just won't stick */
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export function startOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

export function eventsByDay(events: EventRecord[]): Map<string, EventRecord[]> {
  const out = new Map<string, EventRecord[]>()
  for (const e of events) {
    const k = dayKey(pbDate(e.start))
    if (!out.has(k)) out.set(k, [])
    out.get(k)!.push(e)
  }
  return out
}

export function ViewChips({ view, onPick }: { view: ScheduleView; onPick: (v: ScheduleView) => void }) {
  return (
    <div className="chips" role="group" aria-label="Schedule layout">
      {(Object.keys(VIEW_LABELS) as ScheduleView[]).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          className={`chip ${view === v ? 'chip-active' : ''}`}
          onClick={() => onPick(v)}
        >
          {VIEW_LABELS[v]}
        </button>
      ))}
    </div>
  )
}

// ◂ / Today / ▸ with the period named in between.
export function PeriodNav({
  label,
  unit,
  onPrev,
  onNext,
  onToday,
  atToday,
}: {
  label: string
  unit: 'week' | 'month'
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  atToday: boolean
}) {
  return (
    <div className="row period-nav" style={{ alignItems: 'center' }}>
      <button type="button" className="chip" aria-label={`Previous ${unit}`} onClick={onPrev}>
        ◂
      </button>
      <h3 className="period-label" aria-live="polite">
        {label}
      </h3>
      <button type="button" className="chip" aria-label={`Next ${unit}`} onClick={onNext}>
        ▸
      </button>
      {!atToday && (
        <button type="button" className="link" onClick={onToday}>
          {unit === 'week' ? 'This week' : 'This month'}
        </button>
      )}
    </div>
  )
}

export function weekLabel(start: Date): string {
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const a = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const b = end.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })
  return `${a} – ${b}`
}

// Tappable month grid: each day with events is a button that picks the day;
// the chosen day's full cards render below it (ScheduleTab does that part).
export function MonthGrid({
  month,
  byDay,
  selected,
  onSelect,
  isMine,
}: {
  month: Date
  byDay: Map<string, EventRecord[]>
  selected: string | null
  onSelect: (key: string) => void
  isMine: (e: EventRecord) => boolean
}) {
  const year = month.getFullYear()
  const m = month.getMonth()
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array<null>(new Date(year, m, 1).getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const today = dayKey(new Date())
  const time = (e: EventRecord) =>
    pbDate(e.start)
      .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      .replace(':00', '')
      .replace(/\s?([AP])M/i, (_, x: string) => x.toLowerCase())

  return (
    <table className="month-grid month-grid-app">
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col">
              <span className="sr-only">{d}</span>
              <span aria-hidden="true" className="wd-wide">
                {d.slice(0, 3)}
              </span>
              <span aria-hidden="true" className="wd-narrow">
                {d.slice(0, 1)}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, wi) => (
          <tr key={wi}>
            {week.map((day, di) => {
              if (!day) return <td key={di} />
              const date = new Date(year, m, day)
              const k = dayKey(date)
              const list = byDay.get(k) ?? []
              const cls = `${k === today ? 'month-today' : ''} ${k === selected ? 'month-selected' : ''}`
              if (list.length === 0) {
                return (
                  <td key={di} className={cls}>
                    <div className="month-day">{day}</div>
                  </td>
                )
              }
              const name = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
              return (
                <td key={di} className={cls}>
                  <button
                    type="button"
                    className="month-cell"
                    aria-pressed={k === selected}
                    aria-label={`${name}: ${list.length} ${list.length === 1 ? 'event' : 'events'} — ${list
                      .map((e) => `${time(e)} ${e.kind || e.title}${e.status === 'cancelled' ? ' (cancelled)' : ''}`)
                      .join(', ')}`}
                    onClick={() => onSelect(k)}
                  >
                    <span className="month-day">{day}</span>
                    {list.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className={`month-event ${isMine(e) ? 'month-mine' : ''} ${
                          e.status === 'cancelled' ? 'month-cancelled' : ''
                        }`}
                      >
                        {time(e)}
                        <span className="month-kind"> {e.kind || e.title}</span>
                      </span>
                    ))}
                    {list.length > 3 && <span className="month-event">+{list.length - 3} more</span>}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
