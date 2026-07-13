import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import ResourceList from '../components/ResourceList.tsx'
import { useTitle } from '../lib/useTitle.ts'
import { formatWhen } from '../lib/types.ts'
import { downloadMultiIcs } from '../lib/calendar.ts'
import type { AuditionRecord } from '../lib/types.ts'

interface AuditionEvent {
  start: string
  end: string
  location: string
  title: string
  kind?: string
}

interface AuditionInfo {
  open: boolean
  title: string
  notes: string
  questions: string[]
  roles: string[]
  events: AuditionEvent[]
  performances: AuditionEvent[]
}

// Stored in answers so directors see the confirmation on every signup.
const AVAILABLE_KEY = 'Available for all performances and strike'

// Audition signup. Everything an auditioner needs comes from one route
// (they usually aren't production members yet): the details, the roles on
// offer as checkboxes, the scheduled audition times, and the director's
// questions. One form per person; coming back edits the same signup.
export default function AuditionForm() {
  const { id } = useParams()
  const { user } = useAuth()
  const [info, setInfo] = useState<AuditionInfo | null>(null)
  const [existing, setExisting] = useState<AuditionRecord | null>(null)
  const [checkedRoles, setCheckedRoles] = useState<string[]>([])
  const [otherRoles, setOtherRoles] = useState('')
  const [conflicts, setConflicts] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [available, setAvailable] = useState(false)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [justSignedUp, setJustSignedUp] = useState(false)
  useTitle(info ? `Audition: ${info.title}` : 'Audition')

  useEffect(() => {
    async function load() {
      if (!id) return
      const res: AuditionInfo = await pb.send(
        `/api/glowtape/audition-info?production=${encodeURIComponent(id)}`,
        { method: 'GET' },
      )
      setInfo(res)
      try {
        const a = await pb
          .collection('auditions')
          .getFirstListItem<AuditionRecord>(
            pb.filter('production = {:p} && user = {:u}', { p: id, u: user?.id }),
          )
        setExisting(a)
        // Split the stored roles string back into checkboxes + "other".
        const parts = (a.roles || '')
          .split(/,\s*/)
          .map((r) => r.trim())
          .filter(Boolean)
        const known = parts.filter((r) => res.roles.includes(r))
        setCheckedRoles(known)
        setOtherRoles(parts.filter((r) => !res.roles.includes(r)).join(', '))
        setConflicts(a.conflicts)
        setAnswers(a.answers ?? {})
        setAvailable(Boolean(a.answers?.[AVAILABLE_KEY]))
      } catch {
        /* first visit */
      }
    }
    load().catch(() => setFailed(true))
  }, [id, user?.id])

  if (failed) {
    return (
      <main className="page">
        <p className="error">Couldn't open this audition form — signups may not be open yet.</p>
        <Link to="/community">← Back to the community calendar</Link>
      </main>
    )
  }
  if (!info) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    )
  }

  const questions = info.questions.filter((q) => typeof q === 'string' && q.trim())

  function toggleRole(role: string) {
    setCheckedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    )
  }

  async function save() {
    if (!available) {
      setError(
        "One more thing: check the box confirming you're available for all performances and strike — directors cast on it.",
      )
      return
    }
    setBusy(true)
    setSaved('')
    setError('')
    try {
      const roles = [...checkedRoles, otherRoles.trim()].filter(Boolean).join(', ')
      const data = {
        production: id,
        user: user?.id,
        roles,
        conflicts: conflicts.trim(),
        answers: { ...answers, [AVAILABLE_KEY]: 'Yes ✓' },
      }
      const rec = existing
        ? await pb.collection('auditions').update<AuditionRecord>(existing.id, data)
        : await pb.collection('auditions').create<AuditionRecord>(data)
      setExisting(rec)
      setSaved(
        existing
          ? 'Updated — the production team sees your latest answers. ✓'
          : "You're signed up! The production team has your form. Break a leg! 🎭",
      )
      setJustSignedUp(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <Link to="/" className="link">
          ← Home
        </Link>
        <span className="brand-small">Glow Tape</span>
      </header>

      <h1>Audition: {info.title}</h1>
      {!info.open && (
        <p className="hint" role="status">
          ⏸ Signups aren't open to the community yet — you're seeing a manager preview.
        </p>
      )}
      {info.notes && <p>{info.notes}</p>}

      {info.events.length > 0 && (
        <section>
          <h2>Audition times</h2>
          <ul className="plain-list">
            {info.events.map((ev, i) => (
              <li key={i}>
                📅 {formatWhen(ev.start, ev.end)}
                {ev.location ? ` · ${ev.location}` : ''}
              </li>
            ))}
          </ul>
          <button
            className="link"
            onClick={() =>
              downloadMultiIcs(info.events, info.title, `${info.title} auditions`)
            }
          >
            📆 Add {info.events.length === 1 ? 'the audition time' : `all ${info.events.length} audition times`} to my calendar
          </button>
        </section>
      )}

      {info.performances.length > 0 && (
        <section>
          <h2>The commitment: performances &amp; strike</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Auditioning means being available for every one of these — directors cast on it.
          </p>
          <ul className="plain-list">
            {info.performances.map((ev, i) => (
              <li key={i}>
                {ev.kind?.toLowerCase().includes('strike') ? '🔨' : '🎭'}{' '}
                {formatWhen(ev.start, ev.end)}
                {ev.location ? ` · ${ev.location}` : ''}
                {ev.kind?.toLowerCase().includes('strike') ? ' (strike — taking the set down)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="hint">
        The production team also sees <Link to="/profile">your profile</Link> with this form —
        your stage history and headshot save everyone time. Prefer paper?{' '}
        <Link to={`/audition/${id}/print`}>Print a blank form</Link>.
      </p>

      <ResourceList productionId={id!} area="audition" />

      <section className="stack">
        <label>
          Signing up as
          <input value={user?.name ?? ''} disabled />
        </label>

        {info.roles.length > 0 && (
          <div>
            <strong>Which roles are you interested in?</strong>
            <p className="hint" style={{ margin: 0 }}>
              Check all that appeal — it's interest, not a commitment.
            </p>
            <ul className="plain-list" style={{ marginTop: '0.4rem' }}>
              {info.roles.map((role) => (
                <li key={role}>
                  <label className="row" style={{ alignItems: 'center', fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={checkedRoles.includes(role)}
                      onChange={() => toggleRole(role)}
                      style={{ width: '1.3rem', minHeight: '1.3rem' }}
                    />
                    {role}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label>
          {info.roles.length > 0 ? 'Anything else? (ensemble, crew, "anything!")' : "Role(s) you're interested in"}
          <input
            maxLength={200}
            value={otherRoles}
            onChange={(e) => setOtherRoles(e.target.value)}
            placeholder={info.roles.length > 0 ? 'Optional' : 'Example: Tevye, or ensemble, or anything!'}
          />
        </label>

        <label>
          Conflicts during the rehearsal period
          <textarea
            rows={3}
            maxLength={1000}
            value={conflicts}
            onChange={(e) => setConflicts(e.target.value)}
            placeholder="Dates or evenings you can't rehearse — work trips, weddings…"
          />
        </label>

        {questions.map((q) => (
          <label key={q}>
            {q}
            <textarea
              rows={2}
              maxLength={1000}
              value={answers[q] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
            />
          </label>
        ))}

        <label className="row" style={{ alignItems: 'center', fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => {
              setAvailable(e.target.checked)
              if (e.target.checked) setError('')
            }}
            style={{ width: '1.3rem', minHeight: '1.3rem', flexShrink: 0 }}
          />
          I'm available for all performances and for strike (taking the set down after the
          final show)
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          <button onClick={save} disabled={busy || !info.open}>
            {busy ? 'Sending…' : existing ? 'Update my signup' : 'Sign up to audition'}
          </button>
          {saved && <span className="acked" role="status">{saved}</span>}
        </div>
        {justSignedUp && info.events.length > 0 && (
          <p role="status">
            <button
              className="link"
              onClick={() =>
                downloadMultiIcs(info.events, info.title, `${info.title} auditions`)
              }
            >
              📆 Put {info.events.length === 1 ? 'the audition time' : `all ${info.events.length} audition times`} on my calendar
            </button>{' '}
            <span className="hint">so audition day doesn't sneak up on you.</span>
          </p>
        )}
      </section>
    </main>
  )
}
