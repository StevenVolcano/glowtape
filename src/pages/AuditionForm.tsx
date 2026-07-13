import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import type { AuditionRecord, ProductionRecord } from '../lib/types.ts'

// Audition signup for a production with open auditions. One form per person;
// coming back edits the same signup.
export default function AuditionForm() {
  const { id } = useParams()
  const { user } = useAuth()
  const [production, setProduction] = useState<ProductionRecord | null>(null)
  const [existing, setExisting] = useState<AuditionRecord | null>(null)
  const [roles, setRoles] = useState('')
  const [conflicts, setConflicts] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    async function load() {
      if (!id) return
      const p = await pb.collection('productions').getOne<ProductionRecord>(id)
      setProduction(p)
      try {
        const a = await pb
          .collection('auditions')
          .getFirstListItem<AuditionRecord>(
            pb.filter('production = {:p} && user = {:u}', { p: id, u: user?.id }),
          )
        setExisting(a)
        setRoles(a.roles)
        setConflicts(a.conflicts)
        setAnswers(a.answers ?? {})
      } catch {
        /* first visit */
      }
    }
    load().catch(() => setFailed(true))
  }, [id, user?.id])

  if (failed) {
    return (
      <main className="page">
        <p className="error">Couldn't open this audition form — it may have closed.</p>
        <Link to="/">Back home</Link>
      </main>
    )
  }
  if (!production) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    )
  }

  const questions = Array.isArray(production.auditionQuestions)
    ? production.auditionQuestions.filter((q) => typeof q === 'string' && q.trim())
    : []

  async function save() {
    setBusy(true)
    setSaved('')
    try {
      const data = {
        production: production!.id,
        user: user?.id,
        roles: roles.trim(),
        conflicts: conflicts.trim(),
        answers,
      }
      const rec = existing
        ? await pb.collection('auditions').update<AuditionRecord>(existing.id, data)
        : await pb.collection('auditions').create<AuditionRecord>(data)
      setExisting(rec)
      setSaved(
        existing
          ? 'Updated — the production team sees your latest answers. ✓'
          : "You're signed up — break a leg! 🎭",
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

      <h1>Audition: {production.title}</h1>
      {production.auditionNotes && <p>{production.auditionNotes}</p>}
      <p className="hint">
        The production team also sees <Link to="/profile">your profile</Link> with this form —
        adding your experience (and a headshot) there saves everyone time.
      </p>

      <section className="stack">
        <label>
          Signing up as
          <input value={user?.name ?? ''} disabled />
        </label>

        <label>
          Role(s) you're interested in
          <input
            maxLength={400}
            value={roles}
            onChange={(e) => setRoles(e.target.value)}
            placeholder="e.g. Tevye, or ensemble, or anything!"
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

        <div className="row">
          <button onClick={save} disabled={busy}>
            {busy ? 'Sending…' : existing ? 'Update my signup' : 'Sign up to audition'}
          </button>
          {saved && <span className="acked">{saved}</span>}
        </div>
      </section>
    </main>
  )
}
