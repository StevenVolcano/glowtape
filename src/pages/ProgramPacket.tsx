import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useProduction } from './Production.tsx'
import { ROLE_LABELS, formatDay, memberName, pbDate } from '../lib/types.ts'
import type { EventRecord, MemberRecord, UnitRecord } from '../lib/types.ts'

// The program & publicity packet: everything a company's program/brochure
// person asks the director for — cast/characters, production team, bios,
// synopsis, musical numbers, audition and performance dates — compiled from
// what's already in Glow Tape, with a copy-for-email button (that's how the
// paperwork travels). Things Glow Tape doesn't track (rating, licensing
// house) appear as fill-in prompts so nothing gets forgotten.

const TEAM_ORDER = ['director', 'asst_director', 'stage_manager'] as const

export default function ProgramPacket() {
  const { production, members } = useProduction()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [units, setUnits] = useState<UnitRecord[]>([])
  const [copied, setCopied] = useState(false)
  const [fallbackText, setFallbackText] = useState('')

  useEffect(() => {
    Promise.all([
      pb.collection('events').getFullList<EventRecord>({
        filter: pb.filter("production = {:p} && status != 'cancelled'", { p: production.id }),
        sort: 'start',
      }),
      pb.collection('units').getFullList<UnitRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'order,created',
      }),
    ])
      .then(([ev, un]) => {
        setEvents(ev)
        setUnits(un)
      })
      .catch(() => {})
  }, [production.id])

  const orgName = production.expand?.org?.name ?? ''

  const kindDates = (match: RegExp) => {
    const days = events
      .filter((e) => match.test(e.kind))
      .map((e) => formatDay(pbDate(e.start).toISOString()))
    return [...new Set(days)]
  }
  const auditionDates = kindDates(/audition/i)
  const performanceDates = kindDates(/performance/i)

  const cast = members.filter((m) => m.role === 'performer' && !(m.multi && !m.user))
  const team = [...members]
    .filter((m) => (TEAM_ORDER as readonly string[]).includes(m.role))
    .sort(
      (a, b) =>
        (TEAM_ORDER as readonly string[]).indexOf(a.role) -
        (TEAM_ORDER as readonly string[]).indexOf(b.role),
    )
  const crew = members.filter((m) => m.role === 'crew')
  const bios = members.filter((m) => m.bio && m.bio.trim())
  const missingBios = cast.filter((m) => !m.bio?.trim()).length

  const unitsLabel =
    production.breakdownStyle === 'songs'
      ? 'Musical numbers'
      : production.breakdownStyle === 'scenes'
        ? 'Scenes'
        : 'Breakdown'
  const acts = [...new Set(units.map((u) => u.act).filter(Boolean))]

  const castLine = (m: MemberRecord) =>
    m.position ? `${m.position} — ${memberName(m)}` : memberName(m)

  function packetText(): string {
    const L: string[] = []
    L.push(`${production.title.toUpperCase()} — PROGRAM & PUBLICITY INFO`)
    if (orgName) L.push(`Produced by: ${orgName}`)
    if (production.writtenBy) L.push(`Written by: ${production.writtenBy}`)
    L.push(`Play type (comedy, drama, musical…): ______`)
    L.push(`Rating (fun for all / teens & adults…): ______`)
    L.push(`Licensed through (Concord, MTI, Dramatists…): ______`)
    L.push('')
    if (production.description) {
      L.push('BRIEF DESCRIPTION')
      L.push(production.description)
      L.push('')
    }
    if (auditionDates.length > 0) L.push(`Audition dates: ${auditionDates.join(', ')}`)
    if (performanceDates.length > 0) L.push(`Performance dates: ${performanceDates.join(', ')}`)
    L.push(`Cast size: ${cast.length}`)
    L.push('')
    L.push('CAST / CHARACTERS')
    for (const m of cast) L.push(castLine(m))
    L.push('')
    L.push('PRODUCTION TEAM')
    for (const m of team) L.push(`${ROLE_LABELS[m.role]} — ${memberName(m)}`)
    for (const m of crew) L.push(`${m.position || 'Crew'} — ${memberName(m)}`)
    if (units.length > 0) {
      L.push('')
      L.push(unitsLabel.toUpperCase())
      if (acts.length > 1) {
        for (const act of acts) {
          L.push(`— ${act} —`)
          for (const u of units.filter((x) => x.act === act)) L.push(u.name)
        }
      } else {
        for (const u of units) L.push(u.name)
      }
    }
    if (bios.length > 0) {
      L.push('')
      L.push('BIOS')
      for (const m of bios) {
        L.push(`${memberName(m)}${m.position ? ` (${m.position})` : ''}: ${m.bio.trim()}`)
        L.push('')
      }
    }
    L.push('Acknowledgments: ______')
    L.push('')
    L.push('(Compiled from Glow Tape — glowtape.net)')
    return L.join('\n')
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(packetText())
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      // No clipboard access (older browsers): show the text to copy by hand.
      setFallbackText(packetText())
    }
  }

  return (
    <section className="stack">
      <div className="row space-between no-print">
        <h2 style={{ margin: 0 }}>📦 Program &amp; publicity packet</h2>
        <div className="row">
          <button onClick={copyAll}>{copied ? '✓ Copied!' : '📋 Copy it all for email'}</button>
          <button onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>
      <p className="hint no-print">
        Everything the program and brochure folks usually ask a director for, compiled from
        what's already in Glow Tape. Copy it into an email and fill in the few blanks — play
        type, rating, licensing house — that only you know. Ads, design, and company-side
        credits stay with the company.
      </p>

      <div className="card stack">
        <strong>{production.title}</strong>
        {orgName && <span>Produced by {orgName}</span>}
        {production.writtenBy && <span>Written by {production.writtenBy}</span>}
        <span className="hint">Play type: ______ · Rating: ______ · Licensed through: ______</span>
        {production.description ? (
          <p style={{ margin: 0 }}>{production.description}</p>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            No show description yet — add one in Manage → Auditions (it's reused here).
          </p>
        )}
        {auditionDates.length > 0 && (
          <span className="hint">Auditions: {auditionDates.join(', ')}</span>
        )}
        {performanceDates.length > 0 && (
          <span className="hint">Performances: {performanceDates.join(', ')}</span>
        )}
      </div>

      <h3>Cast / characters ({cast.length})</h3>
      <ul className="plain-list">
        {cast.map((m) => (
          <li key={m.id}>{castLine(m)}</li>
        ))}
      </ul>

      <h3>Production team</h3>
      <ul className="plain-list">
        {team.map((m) => (
          <li key={m.id}>
            {ROLE_LABELS[m.role]} — {memberName(m)}
          </li>
        ))}
        {crew.map((m) => (
          <li key={m.id}>
            {m.position || 'Crew'} — {memberName(m)}
          </li>
        ))}
      </ul>

      {units.length > 0 && (
        <>
          <h3>{unitsLabel}</h3>
          <ul className="plain-list">
            {units.map((u) => (
              <li key={u.id}>
                {u.act ? `${u.act}: ` : ''}
                {u.name}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Bios ({bios.length})</h3>
      {missingBios > 0 && (
        <p className="hint no-print">
          {missingBios} cast {missingBios === 1 ? 'member hasn’t' : 'members haven’t'}{' '}
          written a bio yet — nudge them from{' '}
          <Link to={`/production/${production.id}/admin#bios`}>Manage → Program bios</Link>.
        </p>
      )}
      <ul className="plain-list">
        {bios.map((m) => (
          <li key={m.id} style={{ marginBottom: '0.5rem' }}>
            <strong>
              {memberName(m)}
              {m.position ? ` (${m.position})` : ''}
            </strong>
            : {m.bio}
          </li>
        ))}
      </ul>

      {fallbackText && (
        <div className="stack no-print">
          <p className="hint">
            Copying didn't work automatically on this browser — press and hold (or Ctrl+A,
            Ctrl+C) in the box below to copy it yourself.
          </p>
          <textarea aria-label="Packet text to copy" rows={12} readOnly value={fallbackText} onFocus={(e) => e.target.select()} />
        </div>
      )}
      <p className="hint no-print">
        Headshots live on people's community profiles; photo sessions and company-side
        credits (posters, tickets, website…) are the company's department.
      </p>
    </section>
  )
}
