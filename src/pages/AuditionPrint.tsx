import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { copyrightLine, formatWhen } from '../lib/types.ts'
import { useTitle } from '../lib/useTitle.ts'
import type { ProductionRecord } from '../lib/types.ts'

interface PrintInfo {
  roles: { name: string; notes: string }[]
  events: { start: string; end: string; location: string }[]
  performances: { start: string; end: string; location: string; kind?: string }[]
}

// A blank, hand-fillable audition form to print for folks who'd rather use
// paper. Staff keep the sheets with their audition records.
export default function AuditionPrint() {
  useTitle('Audition form')
  const { id } = useParams()
  const [production, setProduction] = useState<ProductionRecord | null>(null)
  const [info, setInfo] = useState<PrintInfo>({ roles: [], events: [], performances: [] })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!id) return
    pb.collection('productions')
      .getOne<ProductionRecord>(id)
      .then(setProduction)
      .catch(() => setFailed(true))
    pb.send(`/api/glowtape/audition-info?production=${encodeURIComponent(id)}`, { method: 'GET' })
      .then((res) =>
        setInfo({
          roles: res.roles ?? [],
          events: res.events ?? [],
          performances: res.performances ?? [],
        }),
      )
      .catch(() => {})
  }, [id])

  if (failed) {
    return (
      <main className="page">
        <p className="error">Couldn't open this form.</p>
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

  return (
    <main className="page print-form">
      <header className="topbar">
        <Link to={`/audition/${production.id}`} className="link">
          ← Back
        </Link>
        <button onClick={() => window.print()}>🖨 Print</button>
      </header>

      <h1>Audition Form — {production.title}</h1>
      {production.writtenBy && <p className="hint">{production.writtenBy}</p>}
      {production.description && <p>{production.description}</p>}
      {production.auditionNotes && <p>{production.auditionNotes}</p>}
      {info.events.length > 0 && (
        <p>
          <strong>Audition times:</strong>{' '}
          {info.events
            .map((ev) => `${formatWhen(ev.start, ev.end)}${ev.location ? ` at ${ev.location}` : ''}`)
            .join(' · ')}
        </p>
      )}
      {info.performances.length > 0 && (
        <p>
          <strong>Performances &amp; strike</strong> (auditioning means being available for
          all of these):{' '}
          {info.performances
            .map(
              (ev) =>
                `${formatWhen(ev.start, ev.end)}${ev.location ? ` at ${ev.location}` : ''}${
                  ev.kind?.toLowerCase().includes('strike') ? ' (strike)' : ''
                }`,
            )
            .join(' · ')}
        </p>
      )}

      <div className="stack print-fields">
        <div>
          <strong>Name</strong>
          <div className="blank-line" />
        </div>
        <div>
          <strong>Phone</strong>
          <div className="blank-line" />
        </div>
        <div>
          <strong>Email</strong>
          <div className="blank-line" />
        </div>
        <div>
          <strong>Role(s) you're interested in</strong> (check all that appeal)
          {info.roles.length > 0 ? (
            <ul className={info.roles.some((r) => r.notes) ? 'plain-list' : 'plain-list check-columns'}>
              {info.roles.map((role) => (
                <li key={role.name}>
                  ☐ {role.name}
                  {role.notes && <span className="hint"> — {role.notes}</span>}
                </li>
              ))}
              <li>☐ Ensemble / anything!</li>
            </ul>
          ) : (
            <>
              <div className="blank-line" />
              <div className="blank-line" />
            </>
          )}
        </div>
        <div>
          <strong>Conflicts during the rehearsal period</strong> (dates + why — for
          example: June 3–5, work trip)
          <div className="blank-box" />
        </div>
        {questions.map((q) => (
          <div key={q}>
            <strong>{q}</strong>
            <div className="blank-box" />
          </div>
        ))}
        <div>
          <strong>☐ I am available for all performances and for strike</strong> (taking the
          set down after the final show) — check to confirm; directors cast on it.
        </div>
      </div>

      <p className="hint print-note">
        Return this form to the audition table. Prefer your phone? Sign up at
        <strong> glowtape.net</strong> instead. · {copyrightLine()}
      </p>
    </main>
  )
}
