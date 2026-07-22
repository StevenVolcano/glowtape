import { useEffect, useId, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useProduction } from '../pages/Production.tsx'
import { groupMemberIds, groupUnitsByAct, resolveUnitMemberIds } from '../lib/breakdown.ts'
import { conflictAppliesTo, conflictHitsEvent, isWeekly, weeklyLabel } from '../lib/conflicts.ts'
import { DEFAULT_EVENT_KINDS, isCommunityKind, memberName, pbDate, productionPlaces } from '../lib/types.ts'
import type { ConflictRecord, EventRecord, GroupRecord, UnitRecord } from '../lib/types.ts'

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
  const locationsListId = useId()

  const kinds = production.eventKinds?.length ? production.eventKinds : DEFAULT_EVENT_KINDS
  const locations = productionPlaces(production).map((pl) => pl.name)

  const [title, setTitle] = useState(event?.title ?? '')
  // A rehearsal can be more than one thing (Dance + Vocals); kinds are picked
  // as chips and stored joined, so every kind-substring check keeps working.
  const [kindParts, setKindParts] = useState<string[]>(
    event?.kind ? event.kind.split(/\s*\+\s*/).filter(Boolean) : [],
  )
  const kind = kindParts.join(' + ')
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
  const [allUnits, setAllUnits] = useState<UnitRecord[]>([])
  const [units, setUnits] = useState<string[]>(event?.units ?? [])
  const [allGroups, setAllGroups] = useState<GroupRecord[]>([])
  const [calledGroups, setCalledGroups] = useState<string[]>(event?.calledGroups ?? [])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const [allConflicts, setAllConflicts] = useState<ConflictRecord[]>([])
  // Potluck sign-up: parties (and anything the team likes) can carry a
  // bring-something list; the event stores just the category names.
  const [bringOn, setBringOn] = useState((event?.bringCategories ?? []).length > 0)
  const [bringCats, setBringCats] = useState(
    (event?.bringCategories ?? []).join(', ') || 'Mains, Sides, Desserts, Drinks',
  )

  useEffect(() => {
    pb.collection('units')
      .getFullList<UnitRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'order,created',
      })
      .then(setAllUnits)
      .catch(() => {})
    pb.collection('groups')
      .getFullList<GroupRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'order,created',
      })
      .then(setAllGroups)
      .catch(() => {})
    pb.collection('conflicts')
      .getFullList<ConflictRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
      })
      .then(setAllConflicts)
      .catch(() => {})
  }, [production.id])

  // Prevention beats correction: while the date and time are being picked,
  // say who can't make it — before the schedule email goes out, not after.
  const busyPeople = (() => {
    if (!date || !startTime) return []
    const pseudo = {
      start: `${date}T${startTime}:00`,
      end: endTime ? `${date}T${endTime}:00` : '',
    } as EventRecord
    const ids = everyone
      ? members.filter((m) => (m.user || m.minor) && m.role !== 'guardian').map((m) => m.id)
      : [
          ...new Set([
            ...called,
            ...groupMemberIds(calledGroups, members),
            ...units.flatMap((uid) => {
              const u = allUnits.find((x) => x.id === uid)
              return u ? resolveUnitMemberIds(u, members) : []
            }),
          ]),
        ]
    const out: string[] = []
    for (const mid of ids) {
      const m = members.find((x) => x.id === mid)
      if (!m) continue
      for (const c of allConflicts) {
        if (!conflictAppliesTo(c, m)) continue
        if (conflictHitsEvent(c, pseudo)) {
          out.push(
            `${m.displayName || memberName(m)} (${
              isWeekly(c) ? `${c.note || 'busy'} ${weeklyLabel(c)}` : c.note || 'conflict'
            })`,
          )
          break
        }
      }
    }
    return out
  })()

  function toggleKind(k: string) {
    setKindParts((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
      if (!title.trim() || title === prev.join(' + ')) setTitle(next.join(' + '))
      return next
    })
  }

  function toggleCalled(id: string) {
    setCalled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // Picking units or role-groups fills "who's called": the union of everyone
  // involved in the selected units plus everyone whose role is in a selected
  // group. Manual chips still adjust after.
  function recomputeCalled(nextUnits: string[], nextGroups: string[]) {
    if (nextUnits.length === 0 && nextGroups.length === 0) return
    const ids = new Set<string>()
    for (const u of allUnits) {
      if (nextUnits.includes(u.id)) for (const m of resolveUnitMemberIds(u, members)) ids.add(m)
    }
    for (const m of groupMemberIds(nextGroups, members)) ids.add(m)
    setEveryone(false)
    setCalled([...ids])
  }

  function toggleUnit(id: string) {
    const next = units.includes(id) ? units.filter((x) => x !== id) : [...units, id]
    setUnits(next)
    recomputeCalled(next, calledGroups)
  }

  // "All of Act 1" in one tap: select every unit in the act, or clear them
  // all if they're already all in.
  function toggleAct(actUnitIds: string[]) {
    const allIn = actUnitIds.every((id) => units.includes(id))
    const next = allIn
      ? units.filter((id) => !actUnitIds.includes(id))
      : [...new Set([...units, ...actUnitIds])]
    setUnits(next)
    recomputeCalled(next, calledGroups)
  }

  function toggleGroup(id: string) {
    const next = calledGroups.includes(id)
      ? calledGroups.filter((x) => x !== id)
      : [...calledGroups, id]
    setCalledGroups(next)
    recomputeCalled(units, next)
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
                units,
                calledGroups,
                bringCategories: bringOn
                  ? bringCats.split(',').map((c) => c.trim()).filter(Boolean)
                  : [],
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
            units,
            calledGroups,
            bringCategories: bringOn
              ? bringCats.split(',').map((c) => c.trim()).filter(Boolean)
              : [],
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
      <div>
        <strong>Type</strong>{' '}
        <span className="hint">(pick all that apply — a night can be Dance + Vocals)</span>
        <div className="chips" style={{ marginTop: '0.3rem' }}>
          {[...new Set([...kinds, ...kindParts])].map((k) => (
            <button
              type="button"
              key={k}
              className={`chip ${kindParts.includes(k) ? 'chip-active' : ''}`}
              aria-pressed={kindParts.includes(k)}
              onClick={() => toggleKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <input
        aria-label="Event title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title — for example: Act II run-through"
      />
      {isCommunityKind(kind) && (
        <p className="hint" role="status">
          🌍 Heads up: <strong>{kind}</strong> events appear on the public community calendar
          (title, time, and place only — never who's called or your notes).
          {kind.toLowerCase().includes('audition') && !production.auditionOpen && (
            <>
              {' '}
              Signups aren't open yet — flip on <em>Auditions</em> in Manage so the calendar
              can link people to your signup form.
            </>
          )}
        </p>
      )}
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
      {busyPeople.length > 0 && (
        <p className="warn" role="status">
          ⚠ Can't make this time: {busyPeople.join(', ')}. You can still schedule it — or
          nudge the time and watch this update.
        </p>
      )}
      {(bringOn || /party|potluck/i.test(kind)) && (
        <div className="stack">
          <label className="row">
            <input
              type="checkbox"
              checked={bringOn}
              onChange={(e) => setBringOn(e.target.checked)}
            />
            🍪 Include a bring-something list (everyone signs up for what they'll bring)
          </label>
          {bringOn && (
            <label>
              Categories (comma-separated)
              <input
                aria-label="Bring-list categories"
                value={bringCats}
                onChange={(e) => setBringCats(e.target.value)}
                placeholder="Example: Mains, Sides, Desserts, Drinks"
              />
            </label>
          )}
        </div>
      )}

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
                    aria-pressed={repeatDays.includes(i)}
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
        aria-label="Location"
        list={locationsListId}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location"
      />
      <datalist id={locationsListId}>
        {locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <input
        aria-label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
      />
      {allGroups.length > 0 && (
        <div>
          <strong>Call a group</strong>
          <div className="chips">
            {allGroups.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`chip ${calledGroups.includes(g.id) ? 'chip-active' : ''}`}
                aria-pressed={calledGroups.includes(g.id)}
                onClick={() => toggleGroup(g.id)}
              >
                {g.name}
              </button>
            ))}
          </div>
          <p className="hint">
            Picking a group calls every role in it (set up groups in Manage → Groups).
          </p>
        </div>
      )}
      {allUnits.length > 0 && (
        <div>
          <strong>Rehearsing (from the breakdown)</strong>
          {groupUnitsByAct(allUnits).map((section, i) => (
            <div key={section.act || `no-act-${i}`}>
              {section.act && <div className="hint act-label">{section.act}</div>}
              <div className="chips">
                {section.act && section.units.length > 1 && (
                  <button
                    type="button"
                    className={`chip ${
                      section.units.every((u) => units.includes(u.id)) ? 'chip-active' : ''
                    }`}
                    aria-pressed={section.units.every((u) => units.includes(u.id))}
                    onClick={() => toggleAct(section.units.map((u) => u.id))}
                  >
                    All of {section.act}
                  </button>
                )}
                {section.units.map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    className={`chip ${units.includes(u.id) ? 'chip-active' : ''}`}
                    aria-pressed={units.includes(u.id)}
                    onClick={() => toggleUnit(u.id)}
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="hint">
            Picking units calls everyone involved in them — fine-tune with the people chips
            below.
          </p>
        </div>
      )}
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
                aria-pressed={called.includes(m.id)}
                onClick={() => toggleCalled(m.id)}
              >
                {memberName(m)}
              </button>
            ))}
          </div>
          <input
            aria-label="Call details"
            value={calledNote}
            onChange={(e) => setCalledNote(e.target.value)}
            placeholder="Call details — for example: dancers at 6, full cast at 7"
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
      {done && <p className="acked" role="status">{done}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}
