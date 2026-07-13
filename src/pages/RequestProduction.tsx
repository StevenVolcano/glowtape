import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useTitle } from '../lib/useTitle.ts'
import type { ProductionRequestRecord } from '../lib/types.ts'

const ROLE_OPTIONS = [
  ['director', "I'm the director"],
  ['asst_director', "I'm the assistant director"],
  ['stage_manager', "I'm the stage manager"],
  ['producer', "I'm the producer"],
] as const

const STATUS_LABELS: Record<string, string> = {
  '': 'waiting for review',
  new: 'waiting for review',
  approved: 'approved 🎉',
  declined: 'not approved',
}

// A director asks for their show to be set up on Glow Tape. The operator
// reviews (and can fix up the details) before approving.
export default function RequestProduction() {
  useTitle('Request a production')
  const { user } = useAuth()
  const [org, setOrg] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<ProductionRequestRecord['role']>('director')
  const [timeline, setTimeline] = useState('')
  const [castSize, setCastSize] = useState('')
  const [minors, setMinors] = useState(false)
  const [notes, setNotes] = useState('')
  const [mine, setMine] = useState<ProductionRequestRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  async function load() {
    const list = await pb.collection('production_requests').getFullList<ProductionRequestRecord>({
      filter: pb.filter('user = {:u}', { u: user?.id }),
      sort: '-created',
    })
    setMine(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setDone('')
    try {
      await pb.collection('production_requests').create({
        user: user?.id,
        org: org.trim(),
        title: title.trim(),
        role,
        timeline: timeline.trim(),
        castSize: castSize.trim(),
        minors,
        notes: notes.trim(),
        status: 'new',
      })
      setDone("Sent! You'll get an email when it's approved — usually quickly.")
      setOrg('')
      setTitle('')
      setTimeline('')
      setCastSize('')
      setNotes('')
      setMinors(false)
      await load()
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

      <h1>Set up a production</h1>
      <p className="hint">
        Tell us about your show and we'll set it up — you'll get the Manage tab and a join code
        for your cast and crew. Free for Grays Harbor theaters; companies elsewhere chip in a
        small amount toward hosting. Always free for cast, crew, and families.
      </p>

      <form onSubmit={send} className="stack">
        <label>
          Theater / organization
          <input
            required
            maxLength={200}
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="Example: Driftwood Players"
          />
        </label>
        <label>
          Show title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Example: The Music Man"
          />
        </label>
        <label>
          Your role
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            {ROLE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timeline
          <input
            maxLength={300}
            value={timeline}
            onChange={(e) => setTimeline(e.target.value)}
            placeholder="Example: rehearsals start Sept 2, opens Oct 24"
          />
        </label>
        <label>
          Rough cast &amp; crew size
          <input
            maxLength={100}
            value={castSize}
            onChange={(e) => setCastSize(e.target.value)}
            placeholder="Example: 20 cast, 8 crew"
          />
        </label>
        <label className="row">
          <input type="checkbox" checked={minors} onChange={(e) => setMinors(e.target.checked)} />
          The production will include performers under 18
        </label>
        {minors && (
          <p className="hint">
            Great — Glow Tape is built for that. Children join through their parents (no child
            accounts), guardians see everything, and there are no private messages. Read{' '}
            <a href="/youth-safety.html">how youth safety works</a>.
          </p>
        )}
        <label>
          Anything else?
          <textarea
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="For example: multiple casts, shared crew with another show, unusual schedule…"
          />
        </label>
        <button type="submit" disabled={busy || !org.trim() || !title.trim()}>
          {busy ? 'Sending…' : 'Request setup'}
        </button>
        {done && <p className="acked" role="status">{done}</p>}
      </form>

      {mine.length > 0 && (
        <section>
          <h2>Your requests</h2>
          <ul className="plain-list">
            {mine.map((r) => (
              <li key={r.id} className="hint">
                <strong>{r.title}</strong> ({r.org}) — {STATUS_LABELS[r.status] ?? r.status}
                {r.reply && <> · {r.reply}</>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
