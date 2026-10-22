import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useTitle } from '../lib/useTitle.ts'
import PhoneSettings from '../components/PhoneSettings.tsx'
import EmailSettings from '../components/EmailSettings.tsx'
import PasskeySettings from '../components/PasskeySettings.tsx'
import FeedbackSection from '../components/FeedbackSection.tsx'
import PushSettings from '../components/PushSettings.tsx'
import ReminderSettings from '../components/ReminderSettings.tsx'
import { TAGLINE, copyrightLine, pbDate } from '../lib/types.ts'
import type { ProductionRecord } from '../lib/types.ts'

type PhaseEvent = { production: string; kind: string; start: string; end: string }

// Where a show is, read off its schedule so nobody has to keep a status up to
// date: before the first rehearsal → planning, before opening → rehearsals,
// through the last performance → performances, after it → closed.
function showPhase(events: PhaseEvent[], now = new Date()): string {
  const rehearsals = events.filter((e) => !/performance|audition|strike|party/i.test(e.kind))
  const performances = events.filter((e) => /performance/i.test(e.kind))
  const firstRehearsal = rehearsals.length ? pbDate(rehearsals[0].start) : null
  const opening = performances.length ? pbDate(performances[0].start) : null
  const last = performances[performances.length - 1]
  const closing = last ? pbDate(last.end || last.start) : null
  if (closing && now > closing) return 'closed'
  if (opening && now >= opening) return 'performances'
  if (firstRehearsal && now >= firstRehearsal) return 'rehearsals'
  return 'planning'
}

export default function Home() {
  useTitle('Home')
  const { user, signOut } = useAuth()
  const [productions, setProductions] = useState<ProductionRecord[]>([])
  const [memberProdIds, setMemberProdIds] = useState<Set<string>>(new Set())
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [phaseEvents, setPhaseEvents] = useState<PhaseEvent[]>([])

  async function load() {
    // Audition-open shows are visible to everyone signed in, so membership
    // has to come from the members collection, not the production list.
    const [list, mems] = await Promise.all([
      pb.collection('productions').getFullList<ProductionRecord>({ sort: '-created' }),
      pb.collection('members').getFullList<{ production: string }>({
        filter: pb.filter('user = {:u} || guardians ?= {:u}', { u: user?.id }),
        fields: 'production',
      }),
    ])
    setProductions(list)
    setMemberProdIds(new Set(mems.map((m) => m.production)))
    setLoaded(true)
    pb.collection('events')
      .getFullList<PhaseEvent>({
        filter: "status != 'cancelled'",
        sort: 'start',
        fields: 'production,kind,start,end',
      })
      .then(setPhaseEvents)
      .catch(() => {})
  }
  const phaseOf = (productionId: string) =>
    showPhase(phaseEvents.filter((e) => e.production === productionId))

  useEffect(() => {
    async function boot() {
      const pending = localStorage.getItem('gt-pending-code')
      if (pending) {
        localStorage.removeItem('gt-pending-code')
        try {
          await pb.send('/api/glowtape/join', { method: 'POST', body: { code: pending } })
        } catch {
          // a community access code isn't a production code — that's fine
        }
      }
      await load()
    }
    boot().catch(() => setLoaded(true))
  }, [])

  async function join(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await pb.send('/api/glowtape/join', { method: 'POST', body: { code: joinCode } })
      setJoinCode('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work.')
    } finally {
      setBusy(false)
    }
  }

  const mine = productions.filter(
    (p) => p.managers.includes(user?.id ?? '') || memberProdIds.has(p.id),
  )
  const active = mine.filter((p) => !p.archived)
  const past = mine.filter((p) => p.archived)
  const openAuditions = productions.filter((p) => p.auditionOpen && !mine.includes(p))
  // The operator's production list includes every show on the server (API
  // rules let the Stagehand in anywhere); the rest go in their own section.
  const stagehand = user?.operator ? productions.filter((p) => !mine.includes(p)) : []

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand-small">Glow Tape</span>
        <button className="link" onClick={signOut}>
          Sign out
        </button>
      </header>

      <h1>Hi, {user?.name || 'there'}</h1>

      <section>
        <h2>Your productions</h2>
        {!loaded ? (
          <p>Loading…</p>
        ) : active.length === 0 ? (
          <p className="hint">
            {past.length > 0
              ? 'No active productions right now — your past shows are below.'
              : "You're not in a production yet. Enter the join code your director or stage manager gave you below."}
          </p>
        ) : (
          <ul className="cards">
            {active.map((p) => (
              <li key={p.id}>
                <Link className="card card-link" to={`/production/${p.id}/schedule`}>
                  <strong>{p.title}</strong>
                  <span className="pill">{phaseOf(p.id)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2>Past shows</h2>
          <p className="hint">Archived productions — open to look back, read-only.</p>
          <ul className="cards">
            {past.map((p) => (
              <li key={p.id}>
                <Link className="card card-link" to={`/production/${p.id}/schedule`}>
                  <strong>{p.title}</strong>
                  <span className="pill">📦 archived</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openAuditions.length > 0 && (
        <section>
          <h2>Auditions</h2>
          <ul className="cards">
            {openAuditions.map((p) => (
              <li key={p.id}>
                <Link className="card card-link" to={`/audition/${p.id}`}>
                  <strong>{p.title}</strong>
                  <span className="pill">auditions open</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="hint">
            Tap a show to sign up. Filling out <Link to="/profile">your profile</Link> first helps
            the directors.
          </p>
        </section>
      )}

      <section>
        <h2>Join a production</h2>
        <form onSubmit={join} className="row">
          <input
            aria-label="Join code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Join code — for example: TR7PDQ"
          />
          <button type="submit" disabled={busy || joinCode.trim().length < 4}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section>
        <h2>Theater Community</h2>
        <ul className="cards">
          <li>
            <Link className="card card-link" to="/community">
              <strong>🎪 The community board &amp; calendar</strong>
              <span className="pill">all theaters</span>
            </Link>
          </li>
        </ul>
        <p className="hint">
          Auditions and performances across Grays Harbor, plus the community message board.
        </p>
      </section>

      <section>
        <h2>More</h2>
        <ul className="plain-list">
          {!window.matchMedia('(display-mode: standalone)').matches && (
            <li>
              📲 <a href="/help.html#install">Put Glow Tape on your home screen</a>{' '}
              <span className="hint">
                — it works like an app; setup takes a minute on iPhone or Android
              </span>
            </li>
          )}
          <li>
            🎭 <Link to="/profile">My profile</Link>{' '}
            <span className="hint">— your acting résumé: experience, skills, headshot</span>
          </li>
          <li>
            🎬 <Link to="/request-production">Request a production</Link>{' '}
            <span className="hint">— directing a show? Free for Grays Harbor theaters</span>
          </li>
        </ul>
      </section>

      <FeedbackSection />

      {user?.operator && (
        <section>
          <h2>Operator</h2>
          <p className="hint">
            <Link to="/operator">⚙ Open the operator console</Link> — production requests
            and direct show setup, feedback triage, access codes, organizations, and the
            theater-company list.
          </p>
          {stagehand.length > 0 && (
            <>
              <h3>🔧 All productions (Stagehand access)</h3>
              <ul className="cards">
                {stagehand.map((p) => (
                  <li key={p.id}>
                    <Link className="card card-link" to={`/production/${p.id}/dashboard`}>
                      <strong>{p.title}</strong>
                      <span className="pill">{phaseOf(p.id)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="hint">
                Shows you're not part of — open them to help with setup or troubleshooting.
              </p>
            </>
          )}
        </section>
      )}

      <PushSettings />

      {user && <ReminderSettings user={user} />}

      {user && <EmailSettings user={user} />}
      {user && <PasskeySettings />}
      {user && <PhoneSettings user={user} />}

      <p className="hint legal-links">
        <em>{TAGLINE}</em>
        <br />
        <a href="/help.html">Help &amp; FAQs</a> · <a href="/youth-safety.html">Youth safety</a> ·{' '}
        <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a>
        <br />
        {copyrightLine()}
      </p>
    </main>
  )
}
