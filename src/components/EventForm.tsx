import { useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useProduction } from '../pages/Production.tsx'
import { DEFAULT_EVENT_KINDS, pbDate, productionPlaces } from '../lib/types.ts'
import type { EventRecord } from '../lib/types.ts'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

// One form, two jobs: create events (with optional weekly repeat -> the bulk
// route, which sends a single summary email) or edit an existing one (the
// server emails changes and resets acks when date/time/place move).
export default function EventForm({
  event,
  onDone,
}: {
  event?: EventRecord
  onDone: () => void | Promise<void>
}) {
  const { production, members } = useProduction()
  const editing = !!event

  const kinds = production.eventKinds?.length ? production.eventKinds : DEFAULT_EVENT_KINDS
  const locations = productionPlaces(production).map((pl) => pl.name)

  const [title, setTitle] = useState(event?.title ?? '')
  const [kind, setKind] = useState(event?.kind ?? '')
  const [date, setDate] = useState(event ? localDate(pbDate(event.start)) : '')
  const [startTime, setStartTime] = useState(event ? localTime(pbDate(event.start)) : '19:00')
  const [endTime, setEndTime] = useState(event?.end ? localTime(pbDate(event.end)) : '')
  const [location, setLocation] = useState(event?.location ?? '')
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [calledNote, setCalledNote] = useState(event?.calledNote ?? '')
  const [everyone, setEveryone] = useState(event ? event.called.length === 0 : true)
  const [called, setCalled] = useState<string[]>(event?.called ?? [])
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [repeatUntil, setRepeatUntil] = useState('')
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  function toggleCalled(id: string) {
    setCalled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleDay(d: number) {
    setRepeatDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  const occurrenceFor = (d: string) => ({
    start: new Date(`${d}T${startTime}`).toISOString(),
    end: endTime ? new Date(`${d}T${endTime}`).toISOString() : '',
  })

  function buildOccurrences() {
    if (!repeatWeekly || !repeatUntil) return [occurrenceFor(date)]
    const out: { start: string; end: string }[] = []
    const cur = new Date(`${date}T12:00`) // noon sidesteps DST boundaries
    const until = new Date(`${repeatUntil}T12:00`)
    const days = repeatDays.length > 0 ? repeatDays : [cur.getDay()]
    while (cur <= until && out.length < 60) {
      if (days.includes(cur.getDay())) out.push(occurrenceFor(localDate(cur)))
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setDone('')
    if (!title.trim()) {
      setError('Give the event a title — e.g. "Act I blocking". (Picking a type fills it in.)')
      return
    }
    if (!date) {
      setError('Pick a date.')
      return
    }
    if (!editing && repeatWeekly && !repeatUntil) {
      setError('Repeating weekly needs an "until" date — or un-check Repeats weekly.')
      return
    }
    setBusy(true)
    try {
      const calledIds = everyone ? [] : called
      if (editing && event) {
        await pb.send('/api/glowtape/events/update', {
          method: 'POST',
          body: {
            events: [
              {
                id: event.id,
                title,
                kind,
                location,
                notes,
                calledNote,
                called: calledIds,
                start: new Date(`${date}T${startTime}`).toISOString(),
                end: endTime ? new Date(`${date}T${endTime}`).toISOString() : '',
              },
            ],
          },
        })
      } else {
        const res = await pb.send('/api/glowtape/events', {
          method: 'POST',
          body: {
            production: production.id,
            title,
            kind,
            location,
            notes,
            calledNote,
            called: calledIds,
            occurrences: buildOccurrences(),
          },
        })
        setDone(
          res.created === 1
            ? 'Added to the schedule — everyone called was emailed.'
            : `Added ${res.created} events — one summary email went out.`,
        )
        setTitle('')
        setNotes('')
        setCalledNote('')
        setRepeatWeekly(false)
        setRepeatUntil('')
        setRepeatDays([])
      }
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="row">
        <select
          aria-label="Event type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value)
            if (!title.trim() && e.target.value) setTitle(e.target.value)
          }}
        >
          <option value="">Type (optional)</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title — e.g. Act II run-through"
        />
      </div>
      <div className="row">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Start
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </label>
        <label>
          End
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
      </div>

      {!editing && (
        <>
          <label className="row">
            <input
              type="checkbox"
              checked={repeatWeekly}
              onChange={(e) => setRepeatWeekly(e.target.checked)}
            />
            Repeats weekly
          </label>
          {repeatWeekly && (
            <>
              <div className="chips">
                {WEEKDAYS.map((name, i) => (
                  <button
                    type="button"
                    key={name}
                    className={`chip ${repeatDays.includes(i) ? 'chip-active' : ''}`}
                    onClick={() => toggleDay(i)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <label>
                Until
                <input
                  type="date"
                  value={repeatUntil}
                  onChange={(e) => setRepeatUntil(e.target.value)}
                  required
                />
              </label>
              <p className="hint">
                Creates every matching day from the start date through this one (max 60), and sends
                the cast one summary email instead of a pile.
              </p>
            </>
          )}
        </>
      )}

      <input
        list="gt-locations"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location"
      />
      <datalist id="gt-locations">
        {locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
      <label className="row">
        <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
        Everyone is called
      </label>
      {!everyone && (
        <>
          <div className="chips">
            {members.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`chip ${called.includes(m.id) ? 'chip-active' : ''}`}
                onClick={() => toggleCalled(m.id)}
              >
                {m.expand?.user?.name || m.position}
              </button>
            ))}
          </div>
          <input
            value={calledNote}
            onChange={(e) => setCalledNote(e.target.value)}
            placeholder="Call details — e.g. dancers at 6, full cast at 7"
          />
        </>
      )}

      <button type="submit" disabled={busy}>
        {busy ? 'Working…' : editing ? 'Save changes' : 'Add to schedule'}
      </button>
      {editing && (
        <p className="hint">
          Changing the date, time, or place resets everyone's "Got it" and emails the change
          automatically. Other edits stay quiet.
        </p>
      )}
      {done && <p className="acked">{done}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  )
}
