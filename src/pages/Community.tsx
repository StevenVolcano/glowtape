import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useTitle } from '../lib/useTitle.ts'
import CommunityBoard from '../components/CommunityBoard.tsx'
import { copyrightLine, externalHref, formatWhen, pbDate } from '../lib/types.ts'
import type { CommunityEvent } from '../lib/types.ts'

// The Grays Harbor theater commons: the message board plus a public calendar
// of every audition and performance across all productions.
export default function Community() {
  useTitle('Theater Community')
  const [events, setEvents] = useState<CommunityEvent[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    pb.send('/api/glowtape/community-calendar', { method: 'GET' })
      .then((res) => setEvents(res.events ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  // Group by month for scanning ("what's happening in August?").
  const byMonth = new Map<string, CommunityEvent[]>()
  for (const ev of events) {
    const d = pbDate(ev.start)
    const key = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    byMonth.set(key, [...(byMonth.get(key) ?? []), ev])
  }

  const isAudition = (k: string) => k.toLowerCase().includes('audition')

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
        {!loaded && <p>Loading…</p>}
        {loaded && events.length === 0 && (
          <p className="hint">Nothing on the community calendar yet — check back soon.</p>
        )}
        {[...byMonth.entries()].map(([month, list]) => (
          <div key={month}>
            <h3 className="dept-heading">{month}</h3>
            <ul className="cards">
              {list.map((ev) => (
                <li key={ev.id} className="card">
                  <div className="event-head">
                    <strong>{ev.productionTitle}</strong>
                    <span className="pill">{isAudition(ev.kind) ? '🎤 Auditions' : '🎭 Performance'}</span>
                  </div>
                  <div className="event-line">
                    {formatWhen(ev.start, ev.end)}
                    {ev.location ? ` · ${ev.location}` : ''}
                    {ev.org ? ` · ${ev.org}` : ''}
                  </div>
                  {ev.title && ev.title !== ev.kind && <div className="event-line hint">{ev.title}</div>}
                  {isAudition(ev.kind) &&
                    (ev.auditionOpen ? (
                      <Link className="link" to={`/audition/${ev.production}`}>
                        📝 Sign up to audition
                      </Link>
                    ) : (
                      <span className="hint">Signups aren't open yet — watch this space.</span>
                    ))}
                  {!isAudition(ev.kind) && ev.ticketUrl && (
                    <a
                      className="link"
                      href={externalHref(ev.ticketUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      🎟 Buy tickets
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <CommunityBoard />

      <p className="hint legal-links">
        <a href="/help.html">Help &amp; FAQs</a> · {copyrightLine()}
      </p>
    </main>
  )
}
