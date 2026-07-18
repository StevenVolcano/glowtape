import { useState } from 'react'
import { useProduction } from '../pages/Production.tsx'
import { conflictHitsEvent, formatTime12, isWeekly, weeklyLabel } from '../lib/conflicts.ts'
import { groupMemberIds } from '../lib/breakdown.ts'
import { memberName, pbDate } from '../lib/types.ts'
import type { ConflictRecord, EventRecord, GroupRecord } from '../lib/types.ts'

// "When can Group A rehearse?" — pick who, a time slot, and a window; every
// day in the window gets a verdict from the conflicts people entered (date
// ranges, repeating series, weekly work/class hours) plus what's already on
// the schedule. Pure lookup over data already loaded — nothing is saved.

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const plusDaysIso = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function FindTime({
  conflicts,
  events,
  groups,
}: {
  conflicts: ConflictRecord[]
  events: EventRecord[]
  groups: GroupRecord[]
}) {
  const { members } = useProduction()
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [fromTime, setFromTime] = useState('18:00')
  const [toTime, setToTime] = useState('21:00')
  const [startDate, setStartDate] = useState(todayIso())
  const [untilDate, setUntilDate] = useState(plusDaysIso(21))

  const candidates = members.filter((m) => (m.user || m.minor) && m.role !== 'guardian')

  const chosen =
    who === 'all'
      ? candidates
      : who === 'pick'
        ? candidates.filter((m) => picked.has(m.id))
        : (() => {
            const ids = groupMemberIds([who.slice('group:'.length)], members)
            return candidates.filter((m) => ids.includes(m.id))
          })()

  const noAccount = chosen.filter((m) => !m.user)

  // Day-by-day verdicts, capped so a stray year-long window stays cheap.
  const rows: { day: string; label: string; busy: string[]; scheduled: string[] }[] = []
  if (open && startDate && untilDate && fromTime < toTime) {
    for (
      let d = new Date(`${startDate}T12:00:00`), n = 0;
      localDay(d) <= untilDate && n < 60;
      d.setDate(d.getDate() + 1), n++
    ) {
      const day = localDay(d)
      const slot = {
        start: `${day}T${fromTime}:00`,
        end: `${day}T${toTime}:00`,
      } as EventRecord
      const busy: string[] = []
      for (const m of chosen) {
        if (!m.user) continue
        for (const c of conflicts) {
          if (c.user !== m.user) continue
          if (conflictHitsEvent(c, slot)) {
            const why = isWeekly(c) ? `${c.note || 'busy'} ${weeklyLabel(c)}` : c.note || 'conflict'
            busy.push(`${m.displayName || memberName(m)} (${why})`)
            break
          }
        }
      }
      const scheduled = events
        .filter((e) => e.status !== 'cancelled' && localDay(pbDate(e.start)) === day)
        .map((e) => e.title)
      rows.push({
        day,
        label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        busy,
        scheduled,
      })
    }
  }

  const clearDays = rows.filter((r) => r.busy.length === 0 && r.scheduled.length === 0).length

  return (
    <section id="findtime">
      <h2>🗓 When can we rehearse?</h2>
      {!open && (
        <>
          <p className="hint">
            Pick a group of people and a time slot, and see which days are clear — using
            everyone's conflicts, work hours, and what's already scheduled.
          </p>
          <button type="button" onClick={() => setOpen(true)}>
            Find a time
          </button>
        </>
      )}
      {open && (
        <div className="stack">
          <div className="chips">
            <button
              type="button"
              className={`chip ${who === 'all' ? 'chip-active' : ''}`}
              aria-pressed={who === 'all'}
              onClick={() => setWho('all')}
            >
              Everyone
            </button>
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`chip ${who === `group:${g.id}` ? 'chip-active' : ''}`}
                aria-pressed={who === `group:${g.id}`}
                onClick={() => setWho(`group:${g.id}`)}
              >
                {g.name}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${who === 'pick' ? 'chip-active' : ''}`}
              aria-pressed={who === 'pick'}
              onClick={() => setWho('pick')}
            >
              Pick people…
            </button>
          </div>
          {who === 'pick' && (
            <div className="chips">
              {candidates.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`chip ${picked.has(m.id) ? 'chip-active' : ''}`}
                  aria-pressed={picked.has(m.id)}
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(m.id)) next.delete(m.id)
                      else next.add(m.id)
                      return next
                    })
                  }
                >
                  {m.displayName || memberName(m)}
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <label>
              From
              <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </label>
            <label>
              To
              <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
            </label>
            <label>
              Between
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              And
              <input
                type="date"
                value={untilDate}
                onChange={(e) => setUntilDate(e.target.value)}
              />
            </label>
          </div>
          {chosen.length === 0 ? (
            <p className="hint">Nobody selected yet.</p>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              Checking {chosen.length} {chosen.length === 1 ? 'person' : 'people'},{' '}
              {formatTime12(fromTime)}–{formatTime12(toTime)} · {clearDays}{' '}
              {clearDays === 1 ? 'day is' : 'days are'} completely clear.
              {noAccount.length > 0 &&
                ` (No conflict info for ${noAccount
                  .map((m) => m.displayName || memberName(m))
                  .join(', ')} — no account.)`}
            </p>
          )}
          <ul className="plain-list">
            {rows.map((r) => (
              <li key={r.day}>
                {r.busy.length === 0 ? '✅' : '⚠️'} <strong>{r.label}</strong>
                {r.busy.length > 0 && <> — {r.busy.join(', ')}</>}
                {r.scheduled.length > 0 && (
                  <span className="hint"> · 🎭 already scheduled: {r.scheduled.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </section>
  )
}
