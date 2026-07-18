import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { TimelineView } from '../components/Timeline.tsx'
import { formatWhen, mapsUrl, pbDate, productionPlaces } from '../lib/types.ts'
import type {
  AckRecord,
  AnnouncementRecord,
  ConflictRecord,
  EventRecord,
  LineNoteRecord,
  SlotRecord,
  TaskRecord,
} from '../lib/types.ts'

// The landing page: what's in front of us right this moment. Countdown to
// opening (starting at 20% — by the time anyone sees this they've already
// auditioned, been cast, and signed in), the next event YOU'RE called to,
// what needs you, the pinned announcement, and a quote of the day. Everything
// derived from data that already exists; the quotes are human-curated
// (public-domain built-ins + whatever the director types in) — no AI.

// Public-domain and traditional only. Director-entered lines join this pool.
const BUILTIN_QUOTES: { text: string; by: string }[] = [
  { text: "All the world's a stage, and all the men and women merely players.", by: 'As You Like It' },
  { text: "The play's the thing.", by: 'Hamlet' },
  { text: 'Speak the speech, I pray you, trippingly on the tongue.', by: 'Hamlet' },
  { text: 'Action is eloquence.', by: 'Coriolanus' },
  { text: 'We know what we are, but know not what we may be.', by: 'Hamlet' },
  { text: 'Boldness be my friend.', by: 'Cymbeline' },
  { text: 'Assume a virtue, if you have it not.', by: 'Hamlet' },
  { text: 'Better a witty fool than a foolish wit.', by: 'Twelfth Night' },
  { text: 'With mirth and laughter let old wrinkles come.', by: 'The Merchant of Venice' },
  { text: 'And though she be but little, she is fierce.', by: "A Midsummer Night's Dream" },
  { text: 'Break a leg.', by: 'the oldest blessing backstage' },
  { text: 'The show must go on.', by: 'every stage manager ever' },
  { text: 'Bad dress rehearsal, great opening night.', by: 'theater proverb' },
  { text: 'There are no small parts, only small actors.', by: 'attributed to Stanislavski' },
  { text: 'The audience never knows what was supposed to happen.', by: 'backstage wisdom' },
]

const isPerformance = (e: EventRecord) => /performance/i.test(e.kind)
const isRehearsalish = (e: EventRecord) => !/performance|audition|strike|party/i.test(e.kind)

export default function TonightTab() {
  const { production, members, myMember, isManager } = useProduction()
  const { user } = useAuth()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [acks, setAcks] = useState<AckRecord[]>([])
  const [lineNotes, setLineNotes] = useState<LineNoteRecord[]>([])
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [pinned, setPinned] = useState<AnnouncementRecord | null>(null)
  const [slots, setSlots] = useState<SlotRecord[]>([])
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([])
  const [pushOn, setPushOn] = useState<boolean | null>(null)
  const [settledHidden, setSettledHidden] = useState(
    () => localStorage.getItem(`gt-settled-${production.id}`) === '1',
  )

  const base = `/production/${production.id}`
  const myMemberIds = members
    .filter((m) => m.user === user?.id || m.guardians?.includes(user?.id ?? ''))
    .map((m) => m.id)

  async function load() {
    const p = production.id
    const [ev, ak, ln, tk, an, sl, cf] = await Promise.all([
      pb.collection('events').getFullList<EventRecord>({
        filter: pb.filter("production = {:p} && status != 'cancelled'", { p }),
        sort: 'start',
      }),
      pb.collection('acks').getFullList<AckRecord>({
        filter: pb.filter('event.production = {:p} && user = {:u}', { p, u: user?.id ?? '' }),
      }),
      pb
        .collection('line_notes')
        .getFullList<LineNoteRecord>({
          filter: pb.filter('production = {:p} && done = false', { p }),
        })
        .catch(() => [] as LineNoteRecord[]),
      pb.collection('tasks').getFullList<TaskRecord>({
        filter: pb.filter('production = {:p} && done = false', { p }),
      }),
      pb
        .collection('announcements')
        .getFullList<AnnouncementRecord>({
          filter: pb.filter('production = {:p} && pinned = true', { p }),
          sort: '-created',
        })
        .catch(() => [] as AnnouncementRecord[]),
      pb.collection('slots').getFullList<SlotRecord>({
        filter: pb.filter('production = {:p}', { p }),
        sort: 'start',
      }),
      pb.collection('conflicts').getFullList<ConflictRecord>({
        filter: pb.filter('production = {:p} && user = {:u}', { p, u: user?.id ?? '' }),
      }),
    ])
    setEvents(ev)
    setAcks(ak)
    setLineNotes(ln)
    setTasks(tk)
    setPinned(an[0] ?? null)
    setSlots(sl)
    setConflicts(cf)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushOn(false)
      return
    }
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => setPushOn(!!s))
      .catch(() => setPushOn(false))
  }, [])

  const now = new Date()

  // --- Countdown & the tape progress bar ---
  const performances = events.filter(isPerformance)
  const opening = performances.find((e) => pbDate(e.start) >= now) ?? null
  const firstPerformance = performances[0] ?? null
  const lastPerformance = performances[performances.length - 1] ?? null
  const runOver = !!lastPerformance && pbDate(lastPerformance.end || lastPerformance.start) < now
  const inRun =
    !runOver && !!firstPerformance && pbDate(firstPerformance.start) < now
  const performancesLeft = performances.filter((e) => pbDate(e.start) >= now).length
  const rehearsalsLeft = opening
    ? events.filter((e) => isRehearsalish(e) && pbDate(e.start) >= now && pbDate(e.start) < pbDate(opening.start)).length
    : events.filter((e) => isRehearsalish(e) && pbDate(e.start) >= now).length
  const daysUntil = opening
    ? Math.max(0, Math.ceil((pbDate(opening.start).getTime() - now.getTime()) / 86400e3))
    : null

  // The bar never starts at zero: auditions, casting, and joining already
  // happened — the first 20% is the road behind everyone by day one.
  const firstEvent = events[0] ?? null
  let progress: number | null = null
  if (runOver) progress = 100
  else if (firstPerformance && firstEvent) {
    const start = pbDate(firstEvent.start).getTime()
    const end = pbDate(firstPerformance.start).getTime()
    const frac = end > start ? (now.getTime() - start) / (end - start) : 1
    progress = Math.round(20 + 80 * Math.min(1, Math.max(0, frac)))
  }

  // --- Next event I'm (or my kids are) called to ---
  const calledToMe = (e: EventRecord) =>
    e.called.length === 0 ||
    myMemberIds.some((id) => e.called.includes(id)) ||
    members.some(
      (m) => myMemberIds.includes(m.id) && !!m.claimedFrom && e.called.includes(m.claimedFrom),
    )
  const next = events.find((e) => pbDate(e.end || e.start) >= now && calledToMe(e)) ?? null
  const nextIsToday =
    !!next && pbDate(next.start).toDateString() === now.toDateString()
  const nextAcked = !!next && acks.some((a) => a.event === next.id)
  const places = productionPlaces(production)

  async function gotIt() {
    if (!next) return
    try {
      await pb.collection('acks').create({ event: next.id, user: user!.id })
      await load()
    } catch {
      /* raced */
    }
  }

  // --- Needs you ---
  const unackedCount = events.filter(
    (e) => pbDate(e.end || e.start) >= now && calledToMe(e) && !acks.some((a) => a.event === e.id),
  ).length
  const myLineNotes = lineNotes.filter((n) => myMemberIds.includes(n.member)).length
  const myTasks = tasks.filter((t) => t.assignee && myMemberIds.includes(t.assignee)).length
  const bioMissing = members.some(
    (m) => myMemberIds.includes(m.id) && m.role !== 'guardian' && !m.claimedFrom && !m.bio?.trim(),
  )
  const openSheets = [...new Set(slots.filter((s) => pbDate(s.start) >= now).map((s) => s.title))]
  const unbookedSheet = openSheets.find(
    (title) => !slots.some((s) => s.title === title && myMemberIds.includes(s.member)),
  )
  const needs: { key: string; label: string; to: string }[] = []
  if (myLineNotes > 0)
    needs.push({ key: 'ln', label: `🎯 ${myLineNotes} line note${myLineNotes === 1 ? '' : 's'} to work on`, to: `${base}/todo` })
  if (unackedCount > 0)
    needs.push({ key: 'ack', label: `👍 ${unackedCount} event${unackedCount === 1 ? '' : 's'} waiting for your "Got it"`, to: `${base}/schedule` })
  if (myTasks > 0)
    needs.push({ key: 'task', label: `☑ ${myTasks} to-do${myTasks === 1 ? '' : 's'} with your name on ${myTasks === 1 ? 'it' : 'them'}`, to: `${base}/todo` })
  if (unbookedSheet)
    needs.push({ key: 'slot', label: `📐 "${unbookedSheet}" is booking — you haven't picked a time`, to: `${base}/schedule#signups` })
  if (bioMissing)
    needs.push({ key: 'bio', label: '✍ Your program bio is still blank', to: `${base}/todo` })

  // --- Quote of the day: same one for the whole cast, changes daily ---
  const directorQuotes = (production.quotes ?? []).filter((q) => q.trim())
  const pool: { text: string; by: string }[] = [
    ...directorQuotes.map((q) => ({ text: q, by: production.title })),
    ...BUILTIN_QUOTES,
  ]
  const dayNumber = Math.floor(Date.now() / 86400e3)
  const quote = pool[dayNumber % pool.length]

  // --- Get settled (new members) ---
  const settled: { key: string; label: string; done: boolean; to: string }[] = [
    { key: 'push', label: '🔔 Turn on notifications', done: pushOn === true, to: '/' },
    { key: 'conf', label: '🚫 Enter your conflicts — dates and work hours', done: conflicts.length > 0, to: `${base}/schedule#conflicts` },
    { key: 'ack', label: '📅 Look over the schedule and tap "Got it"', done: acks.length > 0, to: `${base}/schedule` },
    { key: 'bio', label: '✍ Write your program bio', done: !bioMissing, to: `${base}/todo` },
  ]
  const showSettled = !settledHidden && settled.some((s) => !s.done) && !isManager

  return (
    <div>
      <section>
        <h2>Tonight! Tonight!</h2>

        {(daysUntil !== null || inRun || runOver) && (
          <div className="card stack">
            {runOver ? (
              <strong>🎉 That's a wrap — {production.title} closed. Well done, everyone.</strong>
            ) : inRun ? (
              <strong>
                🎭 {performancesLeft} performance{performancesLeft === 1 ? '' : 's'} to go —
                you're in the run!
              </strong>
            ) : (
              <strong>
                🎭 Opening night{opening ? `: ${formatWhen(opening.start, '')}` : ''} —{' '}
                {daysUntil === 0 ? "it's today!" : `${daysUntil} day${daysUntil === 1 ? '' : 's'}`}
                {rehearsalsLeft > 0 && daysUntil !== 0
                  ? ` · ${rehearsalsLeft} rehearsal${rehearsalsLeft === 1 ? '' : 's'} between here and there`
                  : ''}
              </strong>
            )}
            {progress !== null && (
              <div
                className="tape-track"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress toward opening night"
              >
                <div className="tape-fill" style={{ width: `${progress}%` }} />
              </div>
            )}
            {progress !== null && !runOver && (
              <p className="hint" style={{ margin: 0 }}>
                Auditions ✓ · Cast ✓ · {inRun ? 'Opened ✓ ·' : ''} the tape runs out on{' '}
                {inRun ? 'closing' : 'opening'} night.
              </p>
            )}
          </div>
        )}
        {daysUntil === null && !inRun && !runOver && (
          <p className="hint">
            Rehearsals under way — opening night isn't on the calendar yet.
          </p>
        )}

        {next && (
          <div className="card stack">
            <strong>
              {nextIsToday ? '🌟 Tonight: ' : 'Next up for you: '}
              {next.title}
            </strong>
            <span>{formatWhen(next.start, next.end)}</span>
            {next.location && (
              <a href={mapsUrl(places, next.location)} target="_blank" rel="noreferrer">
                📍 {next.location}
              </a>
            )}
            {next.calledNote && <span className="hint">{next.calledNote}</span>}
            <TimelineView event={next} />
            <div className="row">
              {!nextAcked ? (
                <button onClick={gotIt}>Got it 👍</button>
              ) : (
                <span className="acked">✓ You got it</span>
              )}
              <Link className="link" to={`${base}/schedule`}>
                Full schedule →
              </Link>
            </div>
          </div>
        )}
        {!next && events.length > 0 && (
          <p className="hint">Nothing on the calendar for you right now — enjoy the breather.</p>
        )}
        {events.length === 0 && (
          <p className="hint">
            The schedule is still being built — it'll show up here the moment it exists.
          </p>
        )}

        {needs.length > 0 && (
          <div className="card stack">
            <strong>Needs you</strong>
            <ul className="plain-list">
              {needs.map((n) => (
                <li key={n.key}>
                  <Link className="link" to={n.to}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {pinned && (
          <div className="card stack">
            <strong>📌 {pinned.title}</strong>
            {pinned.body && (
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {pinned.body.length > 200 ? `${pinned.body.slice(0, 200)}…` : pinned.body}
              </p>
            )}
            <Link className="link" to={`${base}/messages`}>
              All announcements →
            </Link>
          </div>
        )}

        {showSettled && (
          <div className="card stack">
            <strong>Getting settled</strong>
            <p className="hint" style={{ margin: 0 }}>
              Welcome to the show! A few small things and you're all set:
            </p>
            <ul className="plain-list">
              {settled.map((s) => (
                <li key={s.key}>
                  {s.done ? (
                    <span className="acked">✓ {s.label.replace(/^\S+\s/, '')}</span>
                  ) : (
                    <Link className="link" to={s.to}>
                      {s.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="link"
              onClick={() => {
                localStorage.setItem(`gt-settled-${production.id}`, '1')
                setSettledHidden(true)
              }}
            >
              Hide this — I'm settled
            </button>
          </div>
        )}

        {quote && (
          <blockquote className="quote-card">
            <p>“{quote.text}”</p>
            <footer className="hint">— {quote.by}</footer>
          </blockquote>
        )}

        {isManager && (
          <p className="hint">
            Add your own quotes — favorite lines from the show, things you say in the room —
            in <Link to={`${base}/admin#tonight`}>Manage → Tonight page</Link>. The whole cast
            sees the same quote each day.
          </p>
        )}
        {myMember && !isManager && (
          <p className="hint">
            You're {myMember.position ? <strong>{myMember.position}</strong> : 'part of the company'}
            {members.length > 0 ? ` — one of ${members.filter((m) => m.role !== 'guardian').length} making this show happen.` : '.'}
          </p>
        )}
      </section>
    </div>
  )
}
