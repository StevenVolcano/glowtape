import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { formatDay, formatWhen, mapsUrl, memberName, pbDate, placeLine, productionPlaces } from '../lib/types.ts'
import { downloadEventIcs, googleCalendarUrl } from '../lib/calendar.ts'
import EventForm from '../components/EventForm.tsx'
import ResourceList from '../components/ResourceList.tsx'
import type { AckRecord, AttendanceRecord, ConflictRecord, EventRecord, GroupRecord, MemberRecord, UnitRecord } from '../lib/types.ts'

export default function ScheduleTab() {
  const { production, members, myMember, isManager } = useProduction()
  const { user } = useAuth()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [acks, setAcks] = useState<AckRecord[]>([])
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [units, setUnits] = useState<UnitRecord[]>([])
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [showPast, setShowPast] = useState(false)
  const [viewAs, setViewAs] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rollFor, setRollFor] = useState<string | null>(null)

  async function load() {
    const [ev, ak, cf, at, un, gr] = await Promise.all([
      pb.collection('events').getFullList<EventRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'start',
      }),
      pb.collection('acks').getFullList<AckRecord>({
        filter: pb.filter('event.production = {:p}', { p: production.id }),
      }),
      pb.collection('conflicts').getFullList<ConflictRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        expand: 'user',
        sort: 'start',
      }),
      pb.collection('attendance').getFullList<AttendanceRecord>({
        filter: pb.filter('event.production = {:p}', { p: production.id }),
      }),
      pb.collection('units').getFullList<UnitRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'order,created',
      }),
      pb.collection('groups').getFullList<GroupRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'order,created',
      }),
    ])
    setEvents(ev)
    setAcks(ak)
    setConflicts(cf)
    setAttendance(at)
    setUnits(un)
    setGroups(gr)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  async function gotIt(event: EventRecord) {
    await pb.collection('acks').create({ event: event.id, user: user!.id })
    await load()
  }

  async function cancelEvent(event: EventRecord) {
    if (!window.confirm(`Cancel \"${event.title}\"? Everyone called will be emailed.`)) return
    await pb.collection('events').update(event.id, { status: 'cancelled' })
    await load()
  }

  async function restoreEvent(event: EventRecord) {
    await pb.collection('events').update(event.id, { status: 'scheduled' })
    await load()
  }

  async function reportAttendance(event: EventRecord, status: 'late' | 'absent', member: MemberRecord) {
    const note = window.prompt(
      status === 'late'
        ? 'Anything to add? (e.g. "there by 7:20") — optional'
        : 'Anything to add? (e.g. "sick") — optional',
    )
    if (note === null) return
    await pb.send('/api/glowtape/attendance/report', {
      method: 'POST',
      body: { event: event.id, status, note, member: member.id },
    })
    await load()
  }

  function calledMembers(event: EventRecord): MemberRecord[] {
    return members.filter(
      (m) =>
        (m.user || m.minor) &&
        (event.called.length === 0 ||
          event.called.includes(m.id) ||
          (!!m.claimedFrom && event.called.includes(m.claimedFrom))),
    )
  }

  async function cycleRoll(event: EventRecord, member: MemberRecord) {
    const row = attendance.find((a) => a.event === event.id && a.member === member.id)
    if (!row) {
      await pb.collection('attendance').create({ event: event.id, member: member.id, status: 'present' })
    } else if (row.status === 'present') {
      await pb.collection('attendance').update(row.id, { status: 'late' })
    } else if (row.status === 'late') {
      await pb.collection('attendance').update(row.id, { status: 'absent' })
    } else {
      await pb.collection('attendance').delete(row.id)
    }
    await load()
  }

  // "See the show through one person's eyes" — filters to their calls.
  const viewAsMember = viewAs ? members.find((m) => m.id === viewAs) ?? null : null
  const calledForMember = (e: EventRecord, m: MemberRecord) =>
    e.called.length === 0 ||
    e.called.includes(m.id) ||
    (!!m.claimedFrom && e.called.includes(m.claimedFrom))

  async function ackAll(unacked: EventRecord[]) {
    if (
      !window.confirm(
        `Mark "Got it" on all ${unacked.length} upcoming events you're called to? Only do this if you've really looked them over — your stage manager counts on it.`,
      )
    )
      return
    for (const e of unacked) {
      try {
        await pb.collection('acks').create({ event: e.id, user: user!.id })
      } catch {
        /* raced an existing ack */
      }
    }
    await load()
  }

  const places = productionPlaces(production)
  // Children this user guards — their calls are your calls.
  const myChildIds = members.filter((m) => m.guardians?.includes(user?.id ?? '')).map((m) => m.id)
  const now = new Date()
  const visible = events.filter(
    (e) =>
      (showPast || pbDate(e.end || e.start) >= now) &&
      (!viewAsMember || calledForMember(e, viewAsMember)) &&
      (!kindFilter || e.kind.toLowerCase().includes(kindFilter.toLowerCase())),
  )

  // Types that actually appear on this schedule (multi-type events like
  // "Dance + Vocals" count toward each of their parts).
  const kindOptions = [
    ...new Set(
      events.flatMap((e) => e.kind.split(/\s*\+\s*/).map((k) => k.trim()).filter(Boolean)),
    ),
  ]

  const unacked = events.filter(
    (e) =>
      e.status !== 'cancelled' &&
      pbDate(e.end || e.start) >= now &&
      (e.called.length === 0 ||
        (myMember != null &&
          (e.called.includes(myMember.id) ||
            (!!myMember.claimedFrom && e.called.includes(myMember.claimedFrom)))) ||
        myChildIds.some((id) => e.called.includes(id))) &&
      !acks.some((a) => a.event === e.id && a.user === user?.id),
  )

  function groupsLabel(e: EventRecord): string {
    if (!e.calledGroups?.length) return ''
    return e.calledGroups
      .map((id) => groups.find((g) => g.id === id)?.name)
      .filter(Boolean)
      .join(' · ')
  }

  function unitsLabel(e: EventRecord): string {
    if (!e.units?.length) return ''
    return e.units
      .map((id) => units.find((u) => u.id === id)?.name)
      .filter(Boolean)
      .join(' · ')
  }

  function calledLabel(e: EventRecord): string {
    if (e.called.length === 0) return 'Everyone'
    const names = e.called
      .map((mid) => members.find((m) => m.id === mid))
      .filter(Boolean)
      .map((m) => memberName(m!))
    return names.join(', ')
  }

  return (
    <div>
      <section>
        <h2>Coming up</h2>
        <div className="row no-print" style={{ alignItems: 'center' }}>
          {isManager && members.filter((m) => m.user || m.minor).length > 0 && (
            <select
              aria-label="View schedule as"
              value={viewAs}
              onChange={(e) => setViewAs(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="">Everyone's schedule</option>
              {members
                .filter((m) => (m.user || m.minor) && m.role !== 'guardian')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    View as {memberName(m)}
                  </option>
                ))}
            </select>
          )}
          {kindOptions.length > 1 && (
            <select
              aria-label="Show only one rehearsal type"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="">All types</option>
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  Only {k}
                </option>
              ))}
            </select>
          )}
          <Link
            className="link"
            to={`/production/${production.id}/schedule/print${
              viewAsMember ? `/${viewAsMember.id}` : myMember ? `/${myMember.id}` : ''
            }${kindFilter ? `?kind=${encodeURIComponent(kindFilter)}` : ''}`}
          >
            🖨 Print{viewAsMember ? ` ${memberName(viewAsMember)}'s` : myMember ? ' my' : ' the'}{' '}
            schedule
          </Link>
          {isManager && (
            <Link
              className="link"
              to={`/production/${production.id}/schedule/print${
                kindFilter ? `?kind=${encodeURIComponent(kindFilter)}` : ''
              }`}
            >
              🖨 Print everything{kindFilter ? ` (${kindFilter})` : ''}
            </Link>
          )}
        </div>
        {viewAsMember && (
          <p className="hint" role="status">
            Showing only what {memberName(viewAsMember)} is called to — switch back to
            “Everyone's schedule” when you're done.
          </p>
        )}
        {kindFilter && (
          <p className="hint" role="status">
            Showing only <strong>{kindFilter}</strong> rehearsals (including combined nights) —
            pick “All types” to see everything again.
          </p>
        )}
        {unacked.length > 1 && !viewAsMember && (
          <p className="no-print">
            <button className="link" onClick={() => ackAll(unacked)}>
              👍 Got them all — acknowledge all {unacked.length} upcoming events
            </button>
          </p>
        )}
        {visible.length === 0 && <p className="hint">Nothing on the schedule yet.</p>}
        <ul className="cards">
          {visible.map((e) => {
            const iAmCalled =
              e.called.length === 0 ||
              (myMember != null &&
                (e.called.includes(myMember.id) ||
                  (!!myMember.claimedFrom && e.called.includes(myMember.claimedFrom)))) ||
              myChildIds.some((id) => e.called.includes(id))
            const myAck = acks.find((a) => a.event === e.id && a.user === user?.id)
            const ackCount = acks.filter((a) => a.event === e.id).length
            return (
              <li
                key={e.id}
                className={`card event ${iAmCalled ? 'called' : 'not-called'} ${
                  e.status === 'cancelled' ? 'cancelled' : ''
                }`}
              >
                <div className="event-head">
                  <strong>{e.title}</strong>
                  {e.kind && e.kind !== e.title && <span className="pill">{e.kind}</span>}
                  {e.status === 'cancelled' && <span className="pill pill-cancel">Cancelled</span>}
                  <span>{formatWhen(e.start, e.end)}</span>
                </div>
                {e.location && (
                  <div className="event-line">
                    <a href={mapsUrl(places, e.location)} target="_blank" rel="noreferrer">
                      📍 {e.location}
                    </a>
                  </div>
                )}
                {unitsLabel(e) && (
                  <div className="event-line">
                    <strong>Rehearsing:</strong> {unitsLabel(e)}
                  </div>
                )}
                {groupsLabel(e) && (
                  <div className="event-line">
                    <strong>Groups:</strong> {groupsLabel(e)}
                  </div>
                )}
                <div className="event-line">
                  <strong>Called:</strong> {calledLabel(e)}
                  {e.calledNote && <em> — {e.calledNote}</em>}
                </div>
                {e.notes && <div className="event-line">{e.notes}</div>}
                {iAmCalled &&
                  e.status !== 'cancelled' &&
                  (myAck ? (
                    <div className="acked">✓ You got it</div>
                  ) : (
                    <button onClick={() => gotIt(e)}>Got it 👍</button>
                  ))}
                {e.status !== 'cancelled' && (
                <div className="row cal-links">
                  <a
                    className="link"
                    href={googleCalendarUrl(e, production.title, placeLine(places, e.location))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    + Google Calendar
                  </a>
                  <button
                    className="link"
                    onClick={() => downloadEventIcs(e, production.title, placeLine(places, e.location))}
                  >
                    + Apple / other calendar
                  </button>
                </div>
                )}
                {(() => {
                  const hoursUntil = (pbDate(e.start).getTime() - Date.now()) / 3600e3
                  if (e.status === 'cancelled' || hoursUntil > 24 || hoursUntil < -6) return null
                  // Everyone I can report for: me, plus my called children.
                  const calledIds = new Set(e.called)
                  const isCalled = (m: MemberRecord) =>
                    e.called.length === 0 ||
                    calledIds.has(m.id) ||
                    (!!m.claimedFrom && calledIds.has(m.claimedFrom))
                  const reportable: MemberRecord[] = []
                  if (myMember && isCalled(myMember)) reportable.push(myMember)
                  for (const m of members) {
                    if (myChildIds.includes(m.id) && isCalled(m)) reportable.push(m)
                  }
                  if (reportable.length === 0) return null
                  return reportable.map((m) => {
                    const isMe = m.id === myMember?.id
                    const name = isMe ? 'You' : m.displayName || memberName(m)
                    const att = attendance.find((a) => a.event === e.id && a.member === m.id)
                    if (att && att.status !== 'present')
                      return (
                        <div key={m.id} className="hint">
                          {name} reported: {att.status === 'late' ? 'running late' : "can't make it"}
                          {att.note ? ` — ${att.note}` : ''} (your team was alerted)
                        </div>
                      )
                    return (
                      <div key={m.id} className="row">
                        {!isMe && <span className="hint">{name}:</span>}
                        <button className="link" onClick={() => reportAttendance(e, 'late', m)}>
                          🕒 Running late
                        </button>
                        <button className="link" onClick={() => reportAttendance(e, 'absent', m)}>
                          😷 Can't make it
                        </button>
                      </div>
                    )
                  })
                })()}
                {isManager && e.status !== 'cancelled' && (
                  <div className="hint">
                    {ackCount} {ackCount === 1 ? 'person has' : 'people have'} tapped “Got it”
                    {(() => {
                      const rows = attendance.filter((a) => a.event === e.id)
                      if (rows.length === 0) return null
                      const c = (s: string) => rows.filter((a) => a.status === s).length
                      return ` · roll: ${c('present')} present, ${c('late')} late, ${c('absent')} absent`
                    })()}
                  </div>
                )}
                {isManager && e.status !== 'cancelled' && (
                  <button
                    className="link"
                    aria-expanded={rollFor === e.id}
                    onClick={() => setRollFor(rollFor === e.id ? null : e.id)}
                  >
                    {rollFor === e.id ? 'Close roll call' : 'Roll call'}
                  </button>
                )}
                {isManager && rollFor === e.id && e.status !== 'cancelled' && (
                  <ul className="plain-list roll-call">
                    {calledMembers(e).map((m) => {
                      const row = attendance.find((a) => a.event === e.id && a.member === m.id)
                      const icon =
                        row?.status === 'present'
                          ? '✓'
                          : row?.status === 'late'
                            ? '🕒'
                            : row?.status === 'absent'
                              ? '✗'
                              : '—'
                      return (
                        <li key={m.id}>
                          <button
                            className="chip"
                            aria-label={`${memberName(m)} — ${
                              row?.status ?? 'unmarked'
                            }. Tap to change.`}
                            onClick={() => cycleRoll(e, m)}
                          >
                            {icon} {memberName(m)}
                          </button>
                          {row?.note && <span className="hint"> {row.note}</span>}
                        </li>
                      )
                    })}
                    <li className="hint">Tap a name to cycle: — → ✓ present → 🕒 late → ✗ absent</li>
                  </ul>
                )}
                {isManager && (
                  <div className="row">
                    {e.status !== 'cancelled' ? (
                      <>
                        <button
                          className="link"
                          onClick={() => setEditingId(editingId === e.id ? null : e.id)}
                        >
                          {editingId === e.id ? 'Close editor' : 'Edit'}
                        </button>
                        <button className="link" onClick={() => cancelEvent(e)}>
                          Cancel event
                        </button>
                      </>
                    ) : (
                      <button className="link" onClick={() => restoreEvent(e)}>
                        Restore
                      </button>
                    )}
                  </div>
                )}
                {isManager && editingId === e.id && e.status !== 'cancelled' && (
                  <EventForm
                    event={e}
                    onDone={async () => {
                      setEditingId(null)
                      await load()
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
        <button className="link" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
          {showPast ? 'Hide past events' : 'Show past events'}
        </button>
      </section>

      <ResourceList productionId={production.id} area="show" />
      <ConflictsSection conflicts={conflicts} reload={load} />
      <CalendarSubscribeSection />
    </div>
  )
}

function CalendarSubscribeSection() {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  async function getUrl() {
    setBusy(true)
    try {
      const res = await pb.send('/api/glowtape/calendar-url', { method: 'GET' })
      setUrl(res.url)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section>
      <h2>Put your calls on your own calendar</h2>
      <p className="hint">
        Subscribe once and every event you're called for shows up in Google Calendar, Apple
        Calendar, or your phone's calendar — and stays up to date when the schedule changes.
      </p>
      {!url ? (
        <button onClick={getUrl} disabled={busy}>
          {busy ? 'One moment…' : 'Get my calendar link'}
        </button>
      ) : (
        <div className="stack">
          <div className="row">
            <input aria-label="Calendar link" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button onClick={copy} aria-live="polite">{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
          <p className="hint">
            <strong>Google Calendar:</strong> Other calendars → + → From URL → paste.{' '}
            <strong>iPhone:</strong> Settings → Calendar → Accounts → Add Account → Other → Add
            Subscribed Calendar → paste. Keep this link to yourself — it's your personal schedule.
          </p>
        </div>
      )}
    </section>
  )
}

function ConflictsSection({ conflicts, reload }: { conflicts: ConflictRecord[]; reload: () => Promise<void> }) {
  const { production, isManager } = useProduction()
  const { user } = useAuth()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const mine = conflicts.filter((c) => c.user === user?.id)
  const shown = isManager ? conflicts : mine

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await pb.collection('conflicts').create({
        production: production.id,
        user: user!.id,
        start,
        end: end || start,
        note,
      })
      setStart('')
      setEnd('')
      setNote('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await pb.collection('conflicts').delete(id)
    await reload()
  }

  return (
    <section>
      <h2>{isManager ? 'Conflicts (everyone)' : 'My conflicts'}</h2>
      <p className="hint">
        Tell your stage manager when you're <em>not</em> available, before the schedule is built.
      </p>
      <ul className="plain-list">
        {shown.map((c) => (
          <li key={c.id}>
            <strong>{isManager ? `${c.expand?.user?.name ?? '?'}: ` : ''}</strong>
            {formatDay(c.start)}
            {c.end && c.end !== c.start ? ` – ${formatDay(c.end)}` : ''}
            {c.note && ` — ${c.note}`}
            {c.user === user?.id && (
              <button className="link" onClick={() => remove(c.id)}>
                remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="stack">
        <div className="row">
          <label>
            From
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label>
            To (optional)
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <input
          aria-label="Conflict reason"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (optional) — for example: work trip"
        />
        <button type="submit" disabled={busy || !start}>
          Add conflict
        </button>
      </form>
    </section>
  )
}
