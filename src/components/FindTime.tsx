import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useProduction } from '../pages/Production.tsx'
import { conflictAppliesTo, conflictHitsEvent, formatTime12, isWeekly, weeklyLabel } from '../lib/conflicts.ts'
import { groupMemberIds } from '../lib/breakdown.ts'
import { memberName, pbDate } from '../lib/types.ts'
import type { ChannelRecord, ConflictRecord, EventRecord, GroupRecord, MemberRecord, MessageRecord } from '../lib/types.ts'
import Section from './Section.tsx'

// "When can Group A rehearse?" — pick who, a time slot, and a window, and
// get a Doodle-style grid: one row per person, one column per day, ✓ where
// they're free and ✕ where a conflict they entered (date ranges, repeating
// series, weekly work/class hours) gets in the way. The best days are
// starred. The lookup itself saves nothing; picking columns and tapping
// "Ask them" posts a 📅 When works? poll (Poll.tsx) so people can confirm,
// which is the Doodle part a conflict list can't do on its own.

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const plusDaysIso = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function FindTime({
  conflicts,
  events,
  groups,
}: {
  conflicts: ConflictRecord[]
  events: EventRecord[]
  groups: GroupRecord[]
}) {
  const { members } = useProduction()
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [fromTime, setFromTime] = useState('18:00')
  const [toTime, setToTime] = useState('21:00')
  const [startDate, setStartDate] = useState(todayIso())
  const [untilDate, setUntilDate] = useState(plusDaysIso(21))
  const [ask, setAsk] = useState<Set<string>>(new Set())
  const [posted, setPosted] = useState<{ channel: string; name: string } | null>(null)

  const candidates = members.filter((m) => (m.user || m.minor) && m.role !== 'guardian')

  const chosen =
    who === 'all'
      ? candidates
      : who === 'pick'
        ? candidates.filter((m) => picked.has(m.id))
        : (() => {
            const ids = groupMemberIds([who.slice('group:'.length)], members)
            return candidates.filter((m) => ids.includes(m.id))
          })()

  const noAccount = chosen.filter((m) => !m.user && !(m.guardians?.length))

  // Day-by-day verdicts, capped so a stray year-long window stays cheap.
  const days: Day[] = []
  if (open && startDate && untilDate && fromTime < toTime) {
    for (
      let d = new Date(`${startDate}T12:00:00`), n = 0;
      localDay(d) <= untilDate && n < 60;
      d.setDate(d.getDate() + 1), n++
    ) {
      const day = localDay(d)
      const slot = {
        start: `${day}T${fromTime}:00`,
        end: `${day}T${toTime}:00`,
      } as EventRecord
      const busy = new Map<string, string>()
      for (const m of chosen) {
        for (const c of conflicts) {
          if (!conflictAppliesTo(c, m)) continue
          if (conflictHitsEvent(c, slot)) {
            busy.set(m.id, isWeekly(c) ? `${c.note || 'busy'} ${weeklyLabel(c)}` : c.note || 'conflict')
            break
          }
        }
      }
      const scheduled = events
        .filter((e) => e.status !== 'cancelled' && localDay(pbDate(e.start)) === day)
        .map((e) => e.title)
      days.push({
        day,
        weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
        date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        busy,
        free: chosen.length - busy.size,
        scheduled,
      })
    }
  }

  const best = Math.max(0, ...days.map((d) => d.free))
  const clearDays = days.filter((d) => d.busy.size === 0 && d.scheduled.length === 0).length
  const nameOf = (m: MemberRecord) => m.displayName || memberName(m)
  const askDays = days.filter((d) => ask.has(d.day))

  function toggleAsk(day: string) {
    setAsk((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else if (next.size < MAX_ASK) next.add(day)
      return next
    })
    setPosted(null)
  }

  // A handful of the starred days, open ones (nothing scheduled) first —
  // a poll with every clear day in it is a calendar, not a question.
  function pickBest() {
    const starred = days.filter((d) => d.free === best && best > 0)
    const open = starred.filter((d) => d.scheduled.length === 0)
    const pool = open.length >= 2 ? open : starred
    setAsk(new Set(pool.slice(0, BEST_PICK).map((d) => d.day)))
    setPosted(null)
  }

  return (
    <Section id="findtime" title="🗓 When can we rehearse?">
      {!open && (
        <>
          <p className="hint">
            Pick a group of people and a time slot, and see a grid of who's free each day — using
            everyone's conflicts, work hours, and what's already scheduled. Then ask them to confirm
            the best days with a poll.
          </p>
          <button type="button" onClick={() => setOpen(true)}>
            Find a time
          </button>
        </>
      )}
      {open && (
        <div className="stack">
          <div className="chips">
            <button
              type="button"
              className={`chip ${who === 'all' ? 'chip-active' : ''}`}
              aria-pressed={who === 'all'}
              onClick={() => setWho('all')}
            >
              Everyone
            </button>
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`chip ${who === `group:${g.id}` ? 'chip-active' : ''}`}
                aria-pressed={who === `group:${g.id}`}
                onClick={() => setWho(`group:${g.id}`)}
              >
                {g.name}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${who === 'pick' ? 'chip-active' : ''}`}
              aria-pressed={who === 'pick'}
              onClick={() => setWho('pick')}
            >
              Pick people…
            </button>
          </div>
          {who === 'pick' && (
            <div className="chips">
              {candidates.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`chip ${picked.has(m.id) ? 'chip-active' : ''}`}
                  aria-pressed={picked.has(m.id)}
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(m.id)) next.delete(m.id)
                      else next.add(m.id)
                      return next
                    })
                  }
                >
                  {nameOf(m)}
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <label>
              From
              <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </label>
            <label>
              To
              <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
            </label>
            <label>
              Between
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              And
              <input
                type="date"
                value={untilDate}
                onChange={(e) => setUntilDate(e.target.value)}
              />
            </label>
          </div>
          {chosen.length === 0 ? (
            <p className="hint">Nobody selected yet.</p>
          ) : (
            <>
              <p className="hint" style={{ margin: 0 }}>
                Checking {chosen.length} {chosen.length === 1 ? 'person' : 'people'},{' '}
                {formatTime12(fromTime)}–{formatTime12(toTime)} · {clearDays}{' '}
                {clearDays === 1 ? 'day is' : 'days are'} completely clear. ★ marks the days the
                most people can make. Tap a day to add it to a poll.
                {noAccount.length > 0 &&
                  ` (No conflict info for ${noAccount.map(nameOf).join(', ')} — no account.)`}
              </p>
              {days.length > 0 && (
                <div className="doodle-scroll" tabIndex={0} aria-label="Who's free each day — scrolls sideways">
                  <table className="doodle">
                    <caption className="sr-only">
                      Who's free {formatTime12(fromTime)}–{formatTime12(toTime)}, one column per day
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="doodle-name">
                          Day
                        </th>
                        {days.map((d) => (
                          <th
                            scope="col"
                            key={d.day}
                            className={`${d.free === best && best > 0 ? 'doodle-best' : ''} ${ask.has(d.day) ? 'doodle-asked' : ''}`}
                          >
                            <button
                              type="button"
                              className="doodle-day"
                              aria-pressed={ask.has(d.day)}
                              aria-label={`${d.weekday} ${d.date}: ${d.free} of ${chosen.length} free${d.scheduled.length ? `, already scheduled: ${d.scheduled.join(', ')}` : ''}. ${ask.has(d.day) ? 'In the poll' : 'Add to a poll'}`}
                              disabled={!ask.has(d.day) && ask.size >= MAX_ASK}
                              onClick={() => toggleAsk(d.day)}
                            >
                              <span>{d.weekday}</span>
                              <span>{d.date}</span>
                              <span aria-hidden="true">
                                {ask.has(d.day) ? '☑' : '☐'}
                                {d.scheduled.length > 0 ? ' 🎭' : ''}
                              </span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chosen.map((m) => (
                        <tr key={m.id}>
                          <th scope="row" className="doodle-name">
                            {nameOf(m)}
                          </th>
                          {days.map((d) => {
                            const why = d.busy.get(m.id)
                            const unknown = !m.user && !(m.guardians?.length)
                            return (
                              <td
                                key={d.day}
                                className={why ? 'doodle-no' : unknown ? 'doodle-unknown' : 'doodle-yes'}
                                title={why || (unknown ? 'No account — no conflict info' : 'Free')}
                              >
                                <span aria-hidden="true">{why ? '✕' : unknown ? '?' : '✓'}</span>
                                <span className="sr-only">
                                  {why ? `busy: ${why}` : unknown ? 'unknown' : 'free'}
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row" className="doodle-name">
                          Free
                        </th>
                        {days.map((d) => (
                          <td key={d.day} className={d.free === best && best > 0 ? 'doodle-best' : ''}>
                            {d.free === best && best > 0 && <span aria-hidden="true">★</span>}
                            {d.free}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {days.some((d) => d.scheduled.length > 0) && (
                <ul className="plain-list hint">
                  {days
                    .filter((d) => d.scheduled.length > 0)
                    .map((d) => (
                      <li key={d.day}>
                        🎭 {d.weekday} {d.date}: already scheduled — {d.scheduled.join(', ')}
                      </li>
                    ))}
                </ul>
              )}
              {days.length > 0 && (
                <AskPoll
                  days={askDays}
                  fromTime={fromTime}
                  toTime={toTime}
                  who={who}
                  groups={groups}
                  onPickBest={pickBest}
                  onClear={() => setAsk(new Set())}
                  posted={posted}
                  onPosted={setPosted}
                />
              )}
            </>
          )}
          <button type="button" className="link" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </Section>
  )
}

type Day = {
  day: string
  weekday: string
  date: string
  busy: Map<string, string> // member id -> why
  free: number
  scheduled: string[]
}

// Most a poll can carry (cleanPoll in glowtape_lib.js).
const MAX_ASK = 20
// How many starred days "Pick the best days" fills in.
const BEST_PICK = 6

// The Doodle step: turn the days picked in the grid into a 📅 When works?
// poll in a channel, so people confirm (conflict lists go stale; a poll asks).
function AskPoll({
  days,
  fromTime,
  toTime,
  who,
  groups,
  onPickBest,
  onClear,
  posted,
  onPosted,
}: {
  days: Day[]
  fromTime: string
  toTime: string
  who: string
  groups: GroupRecord[]
  onPickBest: () => void
  onClear: () => void
  posted: { channel: string; name: string } | null
  onPosted: (p: { channel: string; name: string } | null) => void
}) {
  const { production } = useProduction()
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [channel, setChannel] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const groupId = who.startsWith('group:') ? who.slice('group:'.length) : ''
  const groupName = groups.find((g) => g.id === groupId)?.name

  useEffect(() => {
    pb.collection('channels')
      .getFullList<ChannelRecord>({
        filter: pb.filter('production = {:p} && archived = false', { p: production.id }),
        sort: 'created',
      })
      .then((list) => setChannels(list.filter((c) => !c.member && !c.dmUsers?.length)))
      .catch(() => setChannels([]))
  }, [production.id])

  // Default to the chosen group's own 🔒 channel, else the first show-wide one.
  useEffect(() => {
    if (!channels.length) return
    const own = groupId ? channels.find((c) => c.group === groupId) : undefined
    const everyone = channels.find((c) => !c.group && c.audience === 'all')
    setChannel((own ?? everyone ?? channels[0]).id)
  }, [channels, groupId])

  async function post() {
    if (days.length < 2) return setErr('Tap at least two days in the grid first.')
    if (!channel) return setErr('Pick a channel to post the poll in.')
    setBusy(true)
    try {
      const options = days.map((d) => ({
        start: new Date(`${d.day}T${fromTime}`).toISOString(),
        end: new Date(`${d.day}T${toTime}`).toISOString(),
      }))
      const q =
        question.trim() ||
        `Which of these works for you${groupName ? ` (${groupName})` : ''}? ${formatTime12(fromTime)}–${formatTime12(toTime)}`
      await pb.collection('messages').create<MessageRecord>({
        channel,
        author: pb.authStore.record?.id,
        text: q,
        poll: { kind: 'times', question: q, multi: true, options },
      })
      onPosted({ channel, name: channels.find((c) => c.id === channel)?.name ?? 'the chat' })
      onClear()
      setQuestion('')
      setErr('')
    } catch (e) {
      const data = (e as { response?: { message?: string; status?: number } })?.response
      setErr(
        data?.status && data.status < 500 && data.message
          ? data.message
          : "That poll didn't post — check your connection and try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <strong>📅 Ask them which works</strong>
      {posted ? (
        <p role="status" style={{ margin: 0 }}>
          ✓ Poll posted in {posted.name}.{' '}
          <Link className="link" to={`/production/${production.id}/messages?channel=${posted.channel}`}>
            See the answers →
          </Link>
        </p>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {days.length === 0
            ? 'Tap days in the grid (or pick the starred ones) and post them as a poll. Everyone marks Works or Maybe, like a Doodle.'
            : `${days.length} ${days.length === 1 ? 'day' : 'days'} picked: ${days.map((d) => `${d.weekday} ${d.date}`).join(', ')}.`}
        </p>
      )}
      <div className="row">
        <button type="button" className="link" onClick={onPickBest}>
          ★ Pick the best days
        </button>
        {days.length > 0 && (
          <button type="button" className="link" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {days.length > 0 && (
        <>
          <label>
            Question
            <input
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Example: Which night works for an extra ${groupName ?? 'rehearsal'}?`}
            />
          </label>
          <label>
            Post it in
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy || days.length < 2} onClick={post}>
            Post the poll
          </button>
        </>
      )}
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}
