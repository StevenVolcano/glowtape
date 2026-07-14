import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useTitle } from '../lib/useTitle.ts'
import CommunityBoard from '../components/CommunityBoard.tsx'
import { TAGLINE } from '../lib/types.ts'
import { copyrightLine, externalHref, formatWhen, pbDate } from '../lib/types.ts'
import type { CommunityEvent } from '../lib/types.ts'

// The Grays Harbor theater commons: the message board plus a public calendar
// of every audition and performance across all productions.
type CalendarView = 'hide' | 'default' | 'all'

const VIEW_LABELS: Record<CalendarView, string> = {
  hide: 'Hide',
  default: 'This month & next',
  all: 'All dates',
}

export default function Community() {
  useTitle('Theater Community')
  const [events, setEvents] = useState<CommunityEvent[]>([])
  const [view, setView] = useState<CalendarView>(
    () => (localStorage.getItem('gt-community-view') as CalendarView) || 'default',
  )
  const [loaded, setLoaded] = useState(false)

  function pickView(v: CalendarView) {
    setView(v)
    localStorage.setItem('gt-community-view', v)
  }

  useEffect(() => {
    pb.send('/api/glowtape/community-calendar', { method: 'GET' })
      .then((res) => setEvents(res.events ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const isAudition = (k: string) => k.toLowerCase().includes('audition')

  // Default view: this calendar month and the next one.
  const now = new Date()
  const nowYm = now.getFullYear() * 12 + now.getMonth()
  const inDefaultWindow = (ev: CommunityEvent) => {
    const d = pbDate(ev.start)
    const ym = d.getFullYear() * 12 + d.getMonth()
    return ym === nowYm || ym === nowYm + 1
  }
  const shown = view === 'default' ? events.filter(inDefaultWindow) : view === 'all' ? events : []
  const hiddenLater = view === 'default' ? events.length - shown.length : 0

  // Group by month for scanning ("what's happening in August?"), then within a
  // month collapse a show's run (or its audition nights) into one card with
  // several dates, instead of a card per night. Events arrive sorted by start.
  const byMonth = new Map<string, Map<string, CommunityEvent[]>>()
  for (const ev of shown) {
    const d = pbDate(ev.start)
    const month = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    const groupKey = `${ev.production}|${isAudition(ev.kind) ? 'aud' : 'perf'}`
    if (!byMonth.has(month)) byMonth.set(month, new Map())
    const groups = byMonth.get(month)!
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), ev])
  }

  return (
    <main className="page">
      <header className="topbar">
        <Link to="/" className="link">
          ← Home
        </Link>
        <span className="brand-small">Glow Tape</span>
      </header>

      <h1>Theater Community</h1>
      <p className="hint">
        All of Grays Harbor theater in one place — what's on, who's holding auditions, and the
        community board.
      </p>

      <section>
        <h2>Community calendar</h2>
        <p className="hint">
          Every audition and performance across all productions. Directors: anything you
          schedule with an Auditions or Performance event type shows up here automatically.
        </p>
        <div className="chips" role="group" aria-label="Calendar view">
          {(['hide', 'default', 'all'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={`chip ${view === v ? 'chip-active' : ''}`}
              onClick={() => pickView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        {!loaded && view !== 'hide' && <p>Loading…</p>}
        {loaded && view !== 'hide' && events.length === 0 && (
          <p className="hint">Nothing on the community calendar yet — check back soon.</p>
        )}
        {loaded && view === 'default' && events.length > 0 && shown.length === 0 && (
          <p className="hint">
            Nothing this month or next — tap <em>All dates</em> to see what's further out.
          </p>
        )}
        {hiddenLater > 0 && shown.length > 0 && (
          <p className="hint">
            Showing this month and next — <em>All dates</em> has {hiddenLater} more further
            out.
          </p>
        )}
        {[...byMonth.entries()].map(([month, groups]) => (
          <div key={month}>
            <h3 className="dept-heading">{month}</h3>
            <ul className="cards">
              {[...groups.entries()].map(([groupKey, dates]) => {
                const first = dates[0]
                const audition = isAudition(first.kind)
                return (
                  <li key={groupKey} className="card">
                    <div className="event-head">
                      <strong>{first.productionTitle}</strong>
                      <span className="pill">{audition ? '🎤 Auditions' : '🎭 Performance'}</span>
                    </div>
                    {first.org && <div className="event-line hint">{first.org}</div>}
                    <ul className="plain-list" style={{ marginTop: '0.4rem', gap: '0.3rem' }}>
                      {dates.map((ev) => (
                        <li key={ev.id}>
                          📅 {formatWhen(ev.start, ev.end)}
                          {ev.location ? ` · ${ev.location}` : ''}
                          {ev.title && ev.title !== ev.kind ? ` · ${ev.title}` : ''}
                        </li>
                      ))}
                    </ul>
                    {audition &&
                      (first.auditionOpen ? (
                        <Link className="link" to={`/audition/${first.production}`}>
                          📝 Sign up to audition
                        </Link>
                      ) : (
                        <span className="hint">Signups aren't open yet — watch this space.</span>
                      ))}
                    {!audition && first.ticketUrl && (
                      <a
                        className="link"
                        href={externalHref(first.ticketUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        🎟 Buy tickets
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>

      <CommunityBoard />
      <p className="hint legal-links">
        <em>{TAGLINE}</em>
      </p>

      <p className="hint legal-links">
        <a href="/help.html">Help &amp; FAQs</a> · {copyrightLine()}
      </p>
    </main>
  )
}
