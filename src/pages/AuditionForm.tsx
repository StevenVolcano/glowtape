import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { pbErrorMessage } from '../lib/files.ts'
import { useAuth } from '../lib/auth.tsx'
import ProfileEditor from '../components/ProfileEditor.tsx'
import ResourceList from '../components/ResourceList.tsx'
import { useTitle } from '../lib/useTitle.ts'
import { formatDay, formatWhen } from '../lib/types.ts'
import { downloadMultiIcs } from '../lib/calendar.ts'
import type { AuditionRecord } from '../lib/types.ts'

interface AuditionEvent {
  start: string
  end: string
  location: string
  title: string
  kind?: string
}

interface AuditionRole {
  name: string
  notes: string
}

interface TeamMember {
  name: string
  role: string
}

interface AuditionInfo {
  open: boolean
  title: string
  writtenBy: string
  description: string
  notes: string
  questions: string[]
  roles: AuditionRole[]
  team: TeamMember[]
  events: AuditionEvent[]
  performances: AuditionEvent[]
}

// Stored in answers so directors see the confirmation on every signup.
const AVAILABLE_KEY = 'Available for all performances and strike'

interface ConflictRow {
  start: string
  end: string
  note: string
}

// The review/casting screens show the plain-text `conflicts` field, so the
// rows are also flattened into a readable summary on save.
function summarizeConflicts(rows: ConflictRow[]): string {
  return rows
    .map(
      (r) =>
        formatDay(r.start) +
        (r.end && r.end !== r.start ? ` – ${formatDay(r.end)}` : '') +
        (r.note ? ` — ${r.note}` : ''),
    )
    .join('; ')
}

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
  const [conflictRows, setConflictRows] = useState<ConflictRow[]>([])
  const [legacyConflicts, setLegacyConflicts] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [available, setAvailable] = useState(false)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [justSignedUp, setJustSignedUp] = useState(false)
  // The embedded profile editor hands us its save-if-dirty function so
  // "Sign up" also flushes unsaved résumé edits — one button saves it all.
  const profileSave = useRef<(() => Promise<void>) | null>(null)
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
        const roleNames = res.roles.map((r) => r.name)
        setCheckedRoles(parts.filter((r) => roleNames.includes(r)))
        setOtherRoles(parts.filter((r) => !roleNames.includes(r)).join(', '))
        const rows = Array.isArray(a.conflictDates) ? a.conflictDates : []
        setConflictRows(rows.filter((r) => r && r.start))
        setLegacyConflicts(rows.length === 0 ? a.conflicts : '')
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
      // Unsaved profile edits ride along with the signup. If the profile
      // save fails, its own error shows in the profile box — stop here so
      // nothing is half-saved without the auditioner noticing.
      try {
        await profileSave.current?.()
      } catch {
        setError("Your profile section couldn't save — see the note there, then try again.")
        setBusy(false)
        return
      }
      const roles = [...checkedRoles, otherRoles.trim()].filter(Boolean).join(', ')
      const rows = conflictRows.filter((r) => r.start)
      const data = {
        production: id,
        user: user?.id,
        roles,
        conflicts: rows.length > 0 ? summarizeConflicts(rows) : legacyConflicts,
        conflictDates: rows,
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
    } catch (err) {
      setError(
        pbErrorMessage(
          err,
          "We couldn't save your signup — check your connection and try again. Your answers are still here.",
        ),
      )
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
      {info.writtenBy && (
        <p className="hint" style={{ marginTop: '-0.4rem' }}>
          {info.writtenBy}
        </p>
      )}
      {!info.open && (
        <p className="hint" role="status">
          ⏸ Signups aren't open to the community yet — you're seeing a manager preview.
        </p>
      )}
      {info.description && (
        <section>
          <h2>About the show</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{info.description}</p>
        </section>
      )}
      {info.team.length > 0 && (
        <section>
          <h2>Who's running the show</h2>
          <ul className="plain-list">
            {info.team.map((t, i) => (
              <li key={i}>
                <strong>{t.role}:</strong> {t.name}
              </li>
            ))}
          </ul>
        </section>
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
        Prefer paper? <Link to={`/audition/${id}/print`}>Print a blank form</Link>.
      </p>

      <ResourceList productionId={id!} area="audition" />

      <section>
        <h2>Your profile — the directors see it with this form</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Your stage history, skills, and headshot save everyone time at the table. Edit it
          right here — signing up saves any changes too. (It's also at{' '}
          <Link to="/profile">My profile</Link>, and all of it is optional.)
        </p>
        <ProfileEditor
          embedded
          registerSave={(fn) => {
            profileSave.current = fn
          }}
        />
      </section>

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
                <li key={role.name}>
                  <label className="row" style={{ alignItems: 'center', fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={checkedRoles.includes(role.name)}
                      onChange={() => toggleRole(role.name)}
                      style={{ width: '1.3rem', minHeight: '1.3rem' }}
                    />
                    {role.name}
                  </label>
                  {role.notes && (
                    <p className="hint" style={{ margin: '0 0 0.4rem 2rem' }}>
                      {role.notes}
                    </p>
                  )}
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

        <div>
          <strong>Conflicts during the rehearsal period</strong>
          <p className="hint" style={{ margin: 0 }}>
            Dates you <em>can't</em> rehearse — work trips, weddings — with a word on why.
            Knowing now is what lets the schedule be built around you.
          </p>
          {legacyConflicts && (
            <p className="hint">Previously noted: {legacyConflicts}</p>
          )}
          <ul className="plain-list" style={{ marginTop: '0.4rem' }}>
            {conflictRows.map((row, i) => {
              const setRow = (patch: Partial<ConflictRow>) =>
                setConflictRows((prev) =>
                  prev.map((r, j) => (j === i ? { ...r, ...patch } : r)),
                )
              return (
                <li key={i} className="row" style={{ alignItems: 'end' }}>
                  <label>
                    From
                    <input
                      type="date"
                      value={row.start}
                      onChange={(e) => setRow({ start: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    To (optional)
                    <input
                      type="date"
                      value={row.end}
                      onChange={(e) => setRow({ end: e.target.value })}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Why
                    <input
                      maxLength={200}
                      value={row.note}
                      onChange={(e) => setRow({ note: e.target.value })}
                      placeholder="Example: work trip"
                    />
                  </label>
                  <button
                    type="button"
                    className="link"
                    aria-label={`Remove conflict ${i + 1}`}
                    onClick={() =>
                      setConflictRows((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            className="link"
            onClick={() =>
              setConflictRows((prev) => [...prev, { start: '', end: '', note: '' }])
            }
          >
            + Add a conflict
          </button>
        </div>

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
