import { useEffect, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import { pbErrorMessage } from '../lib/files.ts'
import { formatDay, memberName, pbDate } from '../lib/types.ts'
import type { MemberRecord, SlotRecord } from '../lib/types.ts'

// Sign-up slots: costume fittings, headshots, one-on-ones. The costumer
// posts a sheet of short slots; cast tap a time to book it (guardians book
// for their kids). Tapping a different time on the same sheet moves you;
// tapping your own time lets you cancel.

const timeOf = (iso: string) => {
  const d = pbDate(iso)
  let h = d.getHours()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${ampm}`
}

const dayOf = (iso: string) => {
  const d = pbDate(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SlotsSection() {
  const { production, members, isManager } = useProduction()
  const { user } = useAuth()
  const [slots, setSlots] = useState<SlotRecord[]>([])
  const [bookAs, setBookAs] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const list = await pb.collection('slots').getFullList<SlotRecord>({
      filter: pb.filter('production = {:p}', { p: production.id }),
      sort: 'start',
    })
    setSlots(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  const mine: MemberRecord[] = members.filter(
    (m) =>
      (m.user === user?.id || m.guardians?.includes(user?.id ?? '')) &&
      m.role !== 'guardian' &&
      !(m.multi && !m.user),
  )
  const myIds = mine.map((m) => m.id)
  const bookingFor = mine.length === 1 ? mine[0].id : bookAs

  async function book(slot: SlotRecord, memberId: string) {
    setErr('')
    try {
      await pb.send('/api/glowtape/slots/book', {
        method: 'POST',
        body: { slot: slot.id, member: memberId },
      })
      await load()
    } catch (e) {
      setErr(pbErrorMessage(e, "That didn't work — refresh and try again."))
      await load()
    }
  }

  if (slots.length === 0 && !isManager) return null

  // Group by sheet (title), then by day inside each sheet.
  const sheets = new Map<string, SlotRecord[]>()
  for (const s of slots) {
    const g = sheets.get(s.title) ?? []
    g.push(s)
    sheets.set(s.title, g)
  }

  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id)
    return m ? m.displayName || memberName(m) : 'booked'
  }

  return (
    <section>
      <h2>📐 Sign-up slots</h2>
      {slots.length === 0 ? (
        <p className="hint">
          No sign-up sheets right now. Post one for costume fittings, headshots, or any
          one-at-a-time appointments.
        </p>
      ) : (
        <p className="hint">
          Tap an open time to book it — tap a different time on the same sheet to move, or
          your own time to cancel. {mine.length > 1 && 'Parents: pick who you’re booking for first.'}
        </p>
      )}
      {mine.length > 1 && slots.length > 0 && (
        <label>
          Booking for
          <select aria-label="Who you're booking for" value={bookAs} onChange={(e) => setBookAs(e.target.value)}>
            <option value="">— pick a person —</option>
            {mine.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName || memberName(m)}
              </option>
            ))}
          </select>
        </label>
      )}
      {err && <p className="error">{err}</p>}
      {[...sheets.entries()].map(([title, group]) => {
        const days = [...new Set(group.map((s) => dayOf(s.start)))]
        const location = group.find((s) => s.location)?.location
        const myBooking = group.find((s) => myIds.includes(s.member))
        return (
          <div key={title} className="card stack">
            <div className="event-head">
              <strong>{title}</strong>
              {location && <span className="hint">📍 {location}</span>}
              {group[0]?.minutes ? (
                <span className="pill">{group[0].minutes} min each</span>
              ) : null}
            </div>
            {myBooking && (
              <p className="acked" style={{ margin: 0 }} role="status">
                ✓ {nameOf(myBooking.member)}: {formatDay(myBooking.start)} at {timeOf(myBooking.start)}
              </p>
            )}
            {days.map((day) => (
              <div key={day}>
                <span className="hint">{formatDay(group.find((s) => dayOf(s.start) === day)!.start)}</span>
                <div className="chips">
                  {group
                    .filter((s) => dayOf(s.start) === day)
                    .map((s) => {
                      const isMine = myIds.includes(s.member)
                      if (isMine) {
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className="chip chip-active"
                            onClick={() => {
                              if (window.confirm('Cancel this booking?')) book(s, '')
                            }}
                          >
                            {timeOf(s.start)} — {nameOf(s.member)} ✕
                          </button>
                        )
                      }
                      if (s.member) {
                        return (
                          <span key={s.id} className="chip" style={{ opacity: 0.6 }}>
                            {timeOf(s.start)} — {nameOf(s.member)}
                            {isManager && (
                              <button
                                type="button"
                                className="link"
                                aria-label={`Clear ${nameOf(s.member)}'s booking`}
                                style={{ marginLeft: '0.3rem' }}
                                onClick={() => {
                                  if (window.confirm(`Clear ${nameOf(s.member)}'s booking?`)) book(s, '')
                                }}
                              >
                                ✕
                              </button>
                            )}
                          </span>
                        )
                      }
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className="chip"
                          disabled={!bookingFor}
                          onClick={() => book(s, bookingFor)}
                        >
                          {timeOf(s.start)}
                        </button>
                      )
                    })}
                </div>
              </div>
            ))}
            {isManager && (
              <button
                type="button"
                className="link"
                onClick={async () => {
                  if (!window.confirm(`Delete the whole "${title}" sheet (${group.length} slots)?`)) return
                  for (const s of group) {
                    try {
                      await pb.collection('slots').delete(s.id)
                    } catch {
                      /* already gone */
                    }
                  }
                  await load()
                }}
              >
                Delete this sheet
              </button>
            )}
          </div>
        )
      })}
      {isManager && <NewSheetForm onAdded={load} />}
    </section>
  )
}

function NewSheetForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const { production } = useProduction()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [length, setLength] = useState('15')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const count = (() => {
    if (!date || !from || !to) return 0
    const start = new Date(`${date}T${from}:00`).getTime()
    const end = new Date(`${date}T${to}:00`).getTime()
    const step = Math.max(5, Number(length) || 15) * 60000
    if (end <= start) return 0
    return Math.min(60, Math.floor((end - start) / step))
  })()

  async function add(e: FormEvent) {
    e.preventDefault()
    if (count === 0) return
    setBusy(true)
    setMsg('')
    try {
      const step = Math.max(5, Number(length) || 15)
      const start = new Date(`${date}T${from}:00`)
      for (let i = 0; i < count; i++) {
        const t = new Date(start.getTime() + i * step * 60000)
        await pb.collection('slots').create({
          production: production.id,
          title: title.trim(),
          start: t.toISOString(),
          minutes: step,
          location: location.trim(),
        })
      }
      setMsg(`Posted ${count} slots — the cast can book now.`)
      setOpen(false)
      setTitle('')
      setDate('')
      setFrom('')
      setTo('')
      await onAdded()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <p>
        <button className="link" onClick={() => setOpen(true)}>
          + New sign-up sheet
        </button>
        {msg && <span className="acked" role="status"> {msg}</span>}
      </p>
    )
  }

  return (
    <form onSubmit={add} className="stack">
      <h3>New sign-up sheet</h3>
      <input
        aria-label="What people are signing up for"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Example: Costume fittings"
        required
      />
      <div className="row">
        <label>
          Day
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          From
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          To
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <label>
          Minutes each
          <input
            type="number"
            min={5}
            max={120}
            value={length}
            onChange={(e) => setLength(e.target.value)}
            style={{ width: '4.5rem' }}
          />
        </label>
      </div>
      <input
        aria-label="Where"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Where — for example: costume shop, backstage left"
      />
      <div className="row">
        <button type="submit" disabled={busy || count === 0}>
          {busy ? 'Posting…' : count > 0 ? `Post ${count} slots` : 'Post the sheet'}
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Never mind
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Need a second day? Post another sheet with the same name — they merge into one.
      </p>
    </form>
  )
}
