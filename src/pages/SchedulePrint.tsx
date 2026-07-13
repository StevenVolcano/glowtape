import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useProduction } from './Production.tsx'
import { copyrightLine, memberName, pbDate } from '../lib/types.ts'
import type { EventRecord, MemberRecord } from '../lib/types.ts'

// A print-friendly schedule: chronological list plus monthly calendar grids.
// /schedule/print prints everything; /schedule/print/:memberId prints one
// person's calls (their own, a child's, or — for managers — anyone's).
export default function SchedulePrint() {
  const { production, members } = useProduction()
  const { memberId } = useParams()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showPastOnScreen, setShowPastOnScreen] = useState(false)

  const member = memberId ? members.find((m) => m.id === memberId) ?? null : null

  useEffect(() => {
    pb.collection('events')
      .getFullList<EventRecord>({
        filter: pb.filter("production = {:p} && status != 'cancelled'", { p: production.id }),
        sort: 'start',
      })
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [production.id])

  const calledFor = (e: EventRecord, m: MemberRecord) =>
    e.called.length === 0 ||
    e.called.includes(m.id) ||
    (!!m.claimedFrom && e.called.includes(m.claimedFrom))

  const mine = member ? events.filter((e) => calledFor(e, member)) : events
  // Past items hide on screen only — the printout always has the full run.
  const nowMs = Date.now()
  const isPast = (e: EventRecord) => pbDate(e.end || e.start).getTime() < nowMs
  const pastCount = mine.filter(isPast).length

  // Month grids spanning the schedule.
  const months: { label: string; year: number; month: number }[] = []
  for (const e of mine) {
    const d = pbDate(e.start)
    if (!months.some((m) => m.year === d.getFullYear() && m.month === d.getMonth())) {
      months.push({
        label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        year: d.getFullYear(),
        month: d.getMonth(),
      })
    }
  }

  function eventsOn(year: number, month: number, day: number): EventRecord[] {
    return mine.filter((e) => {
      const d = pbDate(e.start)
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    })
  }

  const time = (e: EventRecord) =>
    pbDate(e.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="print-schedule">
      <div className="row space-between no-print">
        <Link className="link" to={`/production/${production.id}/schedule`}>
          ← Back to the schedule
        </Link>
        <button onClick={() => window.print()}>🖨 Print</button>
      </div>

      <h2>
        {production.title} — schedule{member ? ` for ${memberName(member)}` : ''}
      </h2>
      {pastCount > 0 && (
        <p className="hint no-print">
          <button
            className="link"
            aria-pressed={showPastOnScreen}
            onClick={() => setShowPastOnScreen(!showPastOnScreen)}
          >
            {showPastOnScreen
              ? 'Hide past events on screen'
              : `Show ${pastCount} past event${pastCount === 1 ? '' : 's'} on screen`}
          </button>{' '}
          — the printout always includes the whole run.
        </p>
      )}
      {!loaded && <p>Loading…</p>}
      {loaded && mine.length === 0 && <p className="hint">Nothing on the schedule.</p>}

      <table className="contact-sheet">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">What</th>
            <th scope="col">Where</th>
          </tr>
        </thead>
        <tbody>
          {mine.map((e) => {
            const d = pbDate(e.start)
            const end = e.end ? pbDate(e.end) : null
            return (
              <tr key={e.id} className={!showPastOnScreen && isPast(e) ? 'print-only' : ''}>
                <td>{d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                <td>
                  {time(e)}
                  {end ? `–${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                </td>
                <td>
                  {e.kind && e.kind !== e.title ? `${e.kind}: ` : ''}
                  {e.title}
                </td>
                <td>{e.location}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {months.map(({ label, year, month }) => {
        const first = new Date(year, month, 1)
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        const cells: (number | null)[] = [
          ...Array<null>(first.getDay()).fill(null),
          ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
        ]
        while (cells.length % 7 !== 0) cells.push(null)
        const weeks: (number | null)[][] = []
        for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
        const monthAllPast = mine
          .filter((e) => {
            const d = pbDate(e.start)
            return d.getFullYear() === year && d.getMonth() === month
          })
          .every(isPast)
        return (
          <div
            key={label}
            className={`month-block ${!showPastOnScreen && monthAllPast ? 'print-only' : ''}`}
          >
            <h3>{label}</h3>
            <table className="month-grid">
              <thead>
                <tr>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <th key={d} scope="col">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, di) => (
                      <td key={di}>
                        {day && (
                          <>
                            <div className="month-day">{day}</div>
                            {eventsOn(year, month, day).map((e) => (
                              <div key={e.id} className="month-event">
                                {time(e)} {e.kind || e.title}
                              </div>
                            ))}
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      <p className="hint">
        Printed from glowtape.net — the app and email always have the latest changes. ·{' '}
        {copyrightLine()}
      </p>
    </div>
  )
}
