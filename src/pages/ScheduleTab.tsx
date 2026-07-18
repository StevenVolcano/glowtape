import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { formatDay, formatWhen, mapsUrl, memberName, pbDate, placeLine, productionPlaces } from '../lib/types.ts'
import { downloadEventIcs, googleCalendarUrl } from '../lib/calendar.ts'
import EventForm from '../components/EventForm.tsx'
import QrCode from '../components/QrCode.tsx'
import FindTime from '../components/FindTime.tsx'
import ShowReport from '../components/ShowReport.tsx'
import TimelinePlanner, { TimelineView } from '../components/Timeline.tsx'
import SlotsSection from '../components/Slots.tsx'
import { DAY_SHORT, isWeekly, weeklyLabel } from '../lib/conflicts.ts'
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

  // Door check-in: a per-event code cast scan at the door. Turning it on just
  // stamps a random code on the event; turning it off clears it (the server
  // route rejects an empty or mismatched code, so old posters go dead).
  async function toggleSignin(event: EventRecord) {
    const code = event.signinCode ? '' : Math.random().toString(36).slice(2, 8)
    await pb.collection('events').update(event.id, { signinCode: code })
    await load()
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
                {e.status !== 'cancelled' && <TimelineView event={e} />}
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
                    onClick={() => {
                      setRollFor(rollFor === e.id ? null : e.id)
                      // pick up any door check-ins since the page loaded
                      if (rollFor !== e.id) load().catch(() => {})
                    }}
                  >
                    {rollFor === e.id ? 'Close roll call' : 'Roll call'}
                  </button>
                )}
                {isManager && rollFor === e.id && e.status !== 'cancelled' && (
                  <div className="stack">
                    <div className="row" style={{ alignItems: 'center' }}>
                      <button className="link" onClick={() => toggleSignin(e)}>
                        {e.signinCode ? '📲 Turn off door check-in' : '📲 Turn on door check-in'}
                      </button>
                      {e.signinCode && (
                        <Link className="link" to={`/production/${production.id}/signin/${e.id}/poster`}>
                          🖨 Door poster
                        </Link>
                      )}
                      <button className="link" onClick={() => load()}>
                        ↻ Refresh roll
                      </button>
                    </div>
                    {e.signinCode && (
                      <>
                        <QrCode
                          text={`${window.location.origin}/production/${production.id}/signin/${e.id}?c=${e.signinCode}`}
                          label="Cast scan this to check themselves in — or print the door poster."
                        />
                      </>
                    )}
                  </div>
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
                {isManager && e.status !== 'cancelled' && (
                  <TimelinePlanner event={e} onSaved={load} />
                )}
                {isManager && e.status !== 'cancelled' && /performance/i.test(e.kind) && (
                  <ShowReport event={e} />
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

      <SlotsSection />
      <ConflictsSection conflicts={conflicts} reload={load} />
      {isManager && <FindTime conflicts={conflicts} events={events} groups={groups} />}
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

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTH_LABELS = ['1st', '2nd', '3rd', '4th', 'Last'] as const

// Expand a repeat rule into concrete dates (as YYYY-MM-DD), capped so a typo
// in "until" can't create hundreds of rows. Monthly repeats keep the weekday
// of the first date and land on the checked weeks of each month.
function repeatDates(
  startStr: string,
  untilStr: string,
  repeat: 'weekly' | 'biweekly' | 'monthly',
  nths: Set<string>,
): string[] {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const start = new Date(`${startStr}T12:00:00`)
  const until = new Date(`${untilStr}T12:00:00`)
  const out: string[] = []
  if (repeat === 'weekly' || repeat === 'biweekly') {
    const step = repeat === 'weekly' ? 7 : 14
    for (let d = new Date(start); d <= until && out.length < 60; d.setDate(d.getDate() + step)) {
      out.push(iso(d))
    }
    return out
  }
  // monthly: every checked "nth <weekday>" of each month from start to until
  const weekday = start.getDay()
  for (
    let month = new Date(start.getFullYear(), start.getMonth(), 1);
    month <= until && out.length < 60;
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  ) {
    const days: Date[] = []
    for (
      let d = new Date(month);
      d.getMonth() === month.getMonth();
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      if (d.getDay() === weekday) days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12))
    }
    days.forEach((d, i) => {
      const wanted = (i < 4 && nths.has(NTH_LABELS[i])) || (i === days.length - 1 && nths.has('Last'))
      if (wanted && d >= start && d <= until && out.length < 60) out.push(iso(d))
    })
  }
  return [...new Set(out)]
}

function ConflictsSection({ conflicts, reload }: { conflicts: ConflictRecord[]; reload: () => Promise<void> }) {
  const { production, isManager } = useProduction()
  const { user } = useAuth()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [repeat, setRepeat] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('')
  const [nths, setNths] = useState<Set<string>>(new Set())
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)

  const mine = conflicts.filter((c) => c.user === user?.id)
  const shown = isManager ? conflicts : mine

  // Weekly busy-hours rows and series rows each collapse to one line;
  // loose date rows stay individual.
  const weekly: ConflictRecord[] = []
  const seriesGroups = new Map<string, ConflictRecord[]>()
  const loose: ConflictRecord[] = []
  for (const c of shown) {
    if (isWeekly(c)) {
      weekly.push(c)
    } else if (c.series) {
      const g = seriesGroups.get(c.series) ?? []
      g.push(c)
      seriesGroups.set(c.series, g)
    } else {
      loose.push(c)
    }
  }

  const weekdayName = start ? WEEKDAY_NAMES[new Date(`${start}T12:00:00`).getDay()] : ''

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (repeat && until) {
        const dates = repeatDates(start, until, repeat, nths)
        const series = Math.random().toString(36).slice(2, 10)
        // multi-day spans keep their length on every occurrence
        const lenMs =
          end && end > start
            ? new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()
            : 0
        for (const d of dates) {
          const occEnd = lenMs
            ? new Date(new Date(`${d}T12:00:00`).getTime() + lenMs).toISOString().slice(0, 10)
            : d
          await pb.collection('conflicts').create({
            production: production.id,
            user: user!.id,
            start: d,
            end: occEnd,
            note,
            series,
          })
        }
      } else {
        await pb.collection('conflicts').create({
          production: production.id,
          user: user!.id,
          start,
          end: end || start,
          note,
        })
      }
      setStart('')
      setEnd('')
      setNote('')
      setRepeat('')
      setNths(new Set())
      setUntil('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await pb.collection('conflicts').delete(id)
    await reload()
  }

  async function removeSeries(rows: ConflictRecord[]) {
    if (!window.confirm(`Remove all ${rows.length} dates of this repeating conflict?`)) return
    for (const c of rows) await pb.collection('conflicts').delete(c.id)
    await reload()
  }

  return (
    <section>
      <h2>{isManager ? 'Conflicts (everyone)' : 'My conflicts'}</h2>
      <p className="hint">
        Tell your stage manager when you're <em>not</em> available, before the schedule is built.
      </p>
      {(() => {
        // One line per person: all their conflicts strung together, so the
        // manager view reads like a roster instead of a long mixed list.
        type Item = { key: string; label: string; onRemove?: () => void; removeLabel?: string }
        const byPerson = new Map<string, { name: string; items: Item[] }>()
        const bucket = (c: ConflictRecord) => {
          let b = byPerson.get(c.user)
          if (!b) {
            b = { name: c.expand?.user?.name ?? '?', items: [] }
            byPerson.set(c.user, b)
          }
          return b
        }
        for (const c of weekly) {
          bucket(c).items.push({
            key: c.id,
            label: `⏰ ${c.note || 'busy'} ${weeklyLabel(c)}${c.end ? ` until ${formatDay(c.end)}` : ''}`,
            onRemove: c.user === user?.id ? () => remove(c.id) : undefined,
            removeLabel: 'Remove these weekly hours',
          })
        }
        for (const rows of seriesGroups.values()) {
          const c = rows[0]
          const sorted = [...rows].sort((a, b) => a.start.localeCompare(b.start))
          const preview = sorted.slice(0, 2).map((r) => formatDay(r.start)).join(', ')
          bucket(c).items.push({
            key: c.series,
            label: `🔁 ${c.note || 'repeating'} — ${sorted.length} dates (${preview}${sorted.length > 2 ? ', …' : ''})`,
            onRemove: c.user === user?.id ? () => removeSeries(rows) : undefined,
            removeLabel: 'Remove the whole series',
          })
        }
        for (const c of loose) {
          bucket(c).items.push({
            key: c.id,
            label: `${formatDay(c.start)}${c.end && c.end !== c.start ? `–${formatDay(c.end)}` : ''}${c.note ? ` (${c.note})` : ''}`,
            onRemove: c.user === user?.id ? () => remove(c.id) : undefined,
            removeLabel: 'Remove this conflict',
          })
        }
        const people = [...byPerson.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
        return (
          <ul className="plain-list">
            {people.map(([uid, p]) => (
              <li key={uid} style={{ marginBottom: '0.3rem' }}>
                {isManager && <strong>{p.name}: </strong>}
                {p.items.map((it, i) => (
                  <span key={it.key}>
                    {i > 0 && <span className="hint"> · </span>}
                    {it.label}
                    {it.onRemove && (
                      <button
                        className="link"
                        aria-label={`${it.removeLabel}: ${it.label}`}
                        title={it.removeLabel}
                        style={{ marginLeft: '0.25rem' }}
                        onClick={it.onRemove}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )
      })()}
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
          <label>
            Repeats
            <select
              aria-label="How this conflict repeats"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as typeof repeat)}
            >
              <option value="">One time</option>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every other week</option>
              <option value="monthly">Monthly (by day of week)</option>
            </select>
          </label>
        </div>
        {repeat === 'monthly' && start && (
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="hint">Which {weekdayName}s each month?</span>
            <div className="chips">
              {NTH_LABELS.map((n) => (
                <button
                  type="button"
                  key={n}
                  className={`chip ${nths.has(n) ? 'chip-active' : ''}`}
                  aria-pressed={nths.has(n)}
                  onClick={() =>
                    setNths((prev) => {
                      const next = new Set(prev)
                      if (next.has(n)) next.delete(n)
                      else next.add(n)
                      return next
                    })
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        {repeat && (
          <label>
            Repeat until
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              required
            />
          </label>
        )}
        <input
          aria-label="Conflict reason"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (optional) — for example: city council, 2nd & 4th Mondays"
        />
        <button
          type="submit"
          disabled={busy || !start || (!!repeat && !until) || (repeat === 'monthly' && nths.size === 0)}
        >
          {busy ? 'Adding…' : repeat ? 'Add all the dates' : 'Add conflict'}
        </button>
        {repeat === 'monthly' && start && nths.size > 0 && (
          <p className="hint" style={{ margin: 0 }}>
            Adds a conflict on the {[...nths].join(' and ')} {weekdayName} of each month.
          </p>
        )}
      </form>
      <WeeklyHoursForm reload={reload} />
    </section>
  )
}

// "I work Mon–Fri 9–5" / "class Tue & Thu 6–9pm": one row that means busy
// during those hours every week — free before and after, so evening
// rehearsals on those days can still work.
function WeeklyHoursForm({ reload }: { reload: () => Promise<void> }) {
  const { production } = useProduction()
  const { user } = useAuth()
  const [days, setDays] = useState<Set<number>>(new Set())
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')
  const [note, setNote] = useState('')
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const today = new Date()
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      await pb.collection('conflicts').create({
        production: production.id,
        user: user!.id,
        start: iso,
        end: until || '',
        note,
        days: [...days].sort(),
        fromTime,
        toTime,
      })
      setDays(new Set())
      setFromTime('')
      setToTime('')
      setNote('')
      setUntil('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={add} className="stack" style={{ marginTop: '1rem' }}>
      <h3>⏰ My weekly busy hours</h3>
      <p className="hint" style={{ margin: 0 }}>
        Work or class schedule? Enter the hours you're busy each week — you stay available
        the rest of those days, so an evening rehearsal can still work.
      </p>
      <div className="chips">
        {DAY_SHORT.map((d, i) => (
          <button
            type="button"
            key={d}
            className={`chip ${days.has(i) ? 'chip-active' : ''}`}
            aria-pressed={days.has(i)}
            onClick={() =>
              setDays((prev) => {
                const next = new Set(prev)
                if (next.has(i)) next.delete(i)
                else next.add(i)
                return next
              })
            }
          >
            {d}
          </button>
        ))}
      </div>
      <div className="row">
        <label>
          Busy from
          <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
        </label>
        <label>
          Until
          <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
        </label>
        <label>
          Ends (optional)
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            aria-label="Date this schedule ends, if it does"
          />
        </label>
      </div>
      <input
        aria-label="What keeps you busy"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What is it — for example: work, night class"
      />
      <button type="submit" disabled={busy || days.size === 0 || !fromTime || !toTime}>
        Add my busy hours
      </button>
    </form>
  )
}
