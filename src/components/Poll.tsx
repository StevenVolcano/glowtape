import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMaybeProduction } from '../pages/Production.tsx'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { chatName, formatWhen, memberName, productionPlaces } from '../lib/types.ts'
import type { MemberRecord, MessageRecord, Poll, PollPick, PollVotes } from '../lib/types.ts'

// Polls live on chat messages (migration 1758700000). Managers start them
// from the chat composer; everyone who can read the channel votes and sees
// the results. Anyone in a show channel can start one; the author or a
// manager closes it, managers pin it. Votes, closing and pinning go
// through polls.pb.js.

function errText(err: unknown, fallback: string) {
  const data = (err as { response?: { message?: string; status?: number } })?.response
  return data && data.status && data.status < 500 && data.message ? data.message : fallback
}

// "First L. (Role)", preferring a non-guardian row — same as chat bylines.
function voterLabel(members: MemberRecord[], userId: string, name: string): string {
  const rows = members.filter((m) => m.user === userId)
  const row = rows.find((m) => m.role !== 'guardian') ?? rows[0] ?? null
  return chatName(name || '…', row)
}

export function optionLabel(poll: Poll, o: Poll['options'][number]): string {
  if (poll.kind !== 'times' || !o.start) return o.label
  const when = formatWhen(o.start, o.end)
  return o.label ? `${when} — ${o.label}` : when
}

export function PollCard({
  message,
  members,
  canManage,
  onChange,
}: {
  message: MessageRecord
  members: MemberRecord[]
  canManage: boolean
  onChange: (patch: Partial<MessageRecord>) => void
}) {
  const { user } = useAuth()
  const poll = message.poll!
  const votes: PollVotes = message.pollVotes ?? {}
  const mine = votes[user?.id ?? '']?.picks ?? {}
  const closed = message.pollClosed
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [grid, setGrid] = useState(false)
  const [scheduling, setScheduling] = useState<string | null>(null) // option id
  const isTimes = poll.kind === 'times'
  const canClose = canManage || message.author === user?.id

  const voters = Object.entries(votes)
  const tally = poll.options.map((o) => {
    const yes = voters.filter(([, v]) => v.picks[o.id] === 'yes')
    const maybe = voters.filter(([, v]) => v.picks[o.id] === 'maybe')
    return { o, yes, maybe }
  })
  // A "maybe" counts half, so the best time is the one most people can make.
  const score = (t: (typeof tally)[number]) => t.yes.length + t.maybe.length / 2
  const best = Math.max(0, ...tally.map(score))

  async function vote(optionId: string, pick: PollPick) {
    let picks: Record<string, PollPick>
    if (mine[optionId] === pick) {
      picks = { ...mine }
      delete picks[optionId]
    } else if (!isTimes && !poll.multi) {
      picks = { [optionId]: pick }
    } else {
      picks = { ...mine, [optionId]: pick }
    }
    setBusy(true)
    try {
      const res = await pb.send<{ pollVotes: PollVotes }>('/api/glowtape/polls/vote', {
        method: 'POST',
        body: { message: message.id, picks },
      })
      onChange({ pollVotes: res.pollVotes })
      setErr('')
    } catch (e) {
      setErr(errText(e, "Your vote didn't save — check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  async function manage(body: { closed?: boolean; pinned?: boolean }) {
    setBusy(true)
    try {
      const res = await pb.send<{ pollClosed: boolean; pollPinned: boolean }>('/api/glowtape/polls/manage', {
        method: 'POST',
        body: { message: message.id, ...body },
      })
      onChange(res)
      setErr('')
    } catch (e) {
      setErr(errText(e, "That didn't save — check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  // Hand-picked polls say who they're asking and who hasn't answered yet
  // (a parent's answer counts for their child).
  const asked = (message.pollFor ?? [])
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is MemberRecord => !!m)
  const answered = (m: MemberRecord) => [m.user, ...(m.guardians ?? [])].some((u) => !!u && !!votes[u])
  const waiting = asked.filter((m) => !answered(m))
  const memberLabel = (m: MemberRecord) => chatName(memberName(m), m)

  const names = (rows: [string, PollVotes[string]][]) =>
    rows.map(([uid, v]) => voterLabel(members, uid, v.name)).join(', ')

  return (
    <div className="poll stack" role="group" aria-label={`Poll: ${poll.question}`}>
      <strong className="poll-question">
        <span aria-hidden="true">{isTimes ? '📅 ' : '📊 '}</span>
        {poll.question}
      </strong>
      <span className="hint">
        {closed
          ? 'This poll is closed.'
          : isTimes
            ? 'Mark every time that works for you — or “maybe” if it could.'
            : poll.multi
              ? 'Pick as many as you like.'
              : 'Pick one.'}{' '}
        {voters.length === 1 ? '1 person has' : `${voters.length} people have`} answered.
      </span>
      {asked.length > 0 && (
        <span className="hint">
          Asking {asked.length === 1 ? '1 person' : `${asked.length} people`}: {asked.map(memberLabel).join(', ')}.
          {!closed &&
            (waiting.length === 0
              ? ' ✓ Everyone has answered.'
              : ` Still waiting on ${waiting.map(memberLabel).join(', ')}.`)}
        </span>
      )}
      <ul className="poll-options">
        {tally.map((t) => {
          const label = optionLabel(poll, t.o)
          const top = best > 0 && score(t) === best
          const pct = voters.length ? Math.round((score(t) / voters.length) * 100) : 0
          return (
            <li key={t.o.id} className={top ? 'poll-option poll-top' : 'poll-option'}>
              <div className="poll-option-head">
                <span>
                  {label}
                  {top && <span className="poll-best"> ★ {isTimes ? 'Best so far' : 'Leading'}</span>}
                </span>
                <span className="poll-count">
                  {t.yes.length}
                  {isTimes && t.maybe.length > 0 ? ` + ${t.maybe.length} maybe` : ''}
                </span>
              </div>
              <div className="tape-track poll-bar" aria-hidden="true">
                <div className="tape-fill" style={{ width: `${pct}%` }} />
              </div>
              {/* While a poll is open only the leading times offer it, to keep the card calm; once closed, any time can be picked. */}
              {isTimes && canManage && t.o.start && (top || closed || scheduling === t.o.id) && (
                <button
                  type="button"
                  className="link"
                  aria-expanded={scheduling === t.o.id}
                  onClick={() => setScheduling(scheduling === t.o.id ? null : t.o.id)}
                >
                  📅 Put this on the schedule
                </button>
              )}
              {scheduling === t.o.id && (
                <ScheduleFromPoll
                  message={message}
                  option={t.o}
                  yesVoters={t.yes.map(([uid]) => uid)}
                  onDone={() => {
                    if (!closed) manage({ closed: true })
                  }}
                  onCancel={() => setScheduling(null)}
                />
              )}
              {(t.yes.length > 0 || t.maybe.length > 0) && (
                <span className="hint poll-names">
                  {names(t.yes)}
                  {t.maybe.length > 0 && <>{t.yes.length > 0 ? ' · ' : ''}maybe: {names(t.maybe)}</>}
                </span>
              )}
              {!closed && (
                <div className="chips">
                  <button
                    type="button"
                    className={mine[t.o.id] === 'yes' ? 'chip chip-active' : 'chip'}
                    aria-pressed={mine[t.o.id] === 'yes'}
                    aria-label={`${isTimes ? 'Works for me' : 'Vote for'}: ${label}`}
                    disabled={busy}
                    onClick={() => vote(t.o.id, 'yes')}
                  >
                    {mine[t.o.id] === 'yes' ? '✓ ' : ''}
                    {isTimes ? 'Works' : 'This one'}
                  </button>
                  {isTimes && (
                    <button
                      type="button"
                      className={mine[t.o.id] === 'maybe' ? 'chip chip-active' : 'chip'}
                      aria-pressed={mine[t.o.id] === 'maybe'}
                      aria-label={`Maybe: ${label}`}
                      disabled={busy}
                      onClick={() => vote(t.o.id, 'maybe')}
                    >
                      {mine[t.o.id] === 'maybe' ? '✓ ' : ''}Maybe
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {isTimes && voters.length > 0 && (
        <button type="button" className="link" aria-expanded={grid} onClick={() => setGrid(!grid)}>
          {grid ? 'Hide the grid' : '▦ See everyone’s answers as a grid'}
        </button>
      )}
      {isTimes && grid && (
        <div className="doodle-scroll" tabIndex={0} aria-label="Everyone's answers — scrolls sideways">
          <table className="doodle">
            <caption className="sr-only">Who can make each time</caption>
            <thead>
              <tr>
                <th scope="col" className="doodle-name">
                  Who
                </th>
                {tally.map((t) => (
                  <th scope="col" key={t.o.id} className={best > 0 && score(t) === best ? 'doodle-best' : ''}>
                    <span className="doodle-day doodle-day-static">{optionLabel(poll, t.o)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {voters.map(([uid, v]) => (
                <tr key={uid}>
                  <th scope="row" className="doodle-name">
                    {voterLabel(members, uid, v.name)}
                  </th>
                  {poll.options.map((o) => {
                    const p = v.picks[o.id]
                    return (
                      <td key={o.id} className={p === 'yes' ? 'doodle-yes' : p === 'maybe' ? 'doodle-maybe' : 'doodle-no'}>
                        <span aria-hidden="true">{p === 'yes' ? '✓' : p === 'maybe' ? '~' : '✕'}</span>
                        <span className="sr-only">{p === 'yes' ? 'works' : p === 'maybe' ? 'maybe' : 'no'}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="doodle-name">
                  Can make it
                </th>
                {tally.map((t) => (
                  <td key={t.o.id} className={best > 0 && score(t) === best ? 'doodle-best' : ''}>
                    {best > 0 && score(t) === best && <span aria-hidden="true">★</span>}
                    {t.yes.length}
                    {t.maybe.length > 0 ? ` +${t.maybe.length}?` : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {(canClose || canManage) && (
        <div className="row">
          {canClose && (
            <button type="button" className="link" disabled={busy} onClick={() => manage({ closed: !closed })}>
              {closed ? 'Reopen the poll' : 'Close the poll'}
            </button>
          )}
          {canManage && !closed && (
            <button
              type="button"
              className="link"
              aria-pressed={message.pollPinned}
              disabled={busy}
              onClick={() => manage({ pinned: !message.pollPinned })}
            >
              {message.pollPinned ? '📌 Unpin from the Dashboard' : '📌 Pin to the Dashboard'}
            </button>
          )}
        </div>
      )}
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

// A manager turns a winning time into a real rehearsal: the normal events
// route (one email to everyone called, acks, reminders — same as the
// Schedule tab), pre-filled from the poll. Who's called defaults to the
// people the poll asked, else everyone who said it works.
function ScheduleFromPoll({
  message,
  option,
  yesVoters,
  onDone,
  onCancel,
}: {
  message: MessageRecord
  option: Poll['options'][number]
  yesVoters: string[] // user ids
  onDone: () => void
  onCancel: () => void
}) {
  const ctx = useMaybeProduction()
  const [title, setTitle] = useState('Rehearsal')
  const [location, setLocation] = useState('')
  const asked = message.pollFor ?? []
  const [who, setWho] = useState<'asked' | 'yes' | 'all'>(asked.length ? 'asked' : 'yes')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  if (!ctx) return null
  const { production, members } = ctx
  const places = productionPlaces(production)

  // A "Works" from an account counts for that person's own row, or — for a
  // parent with no role of their own — for the children they answer for.
  const yesMembers = (() => {
    const out = new Set<string>()
    for (const uid of yesVoters) {
      const own = members.filter((m) => m.user === uid && m.role !== 'guardian')
      if (own.length) own.forEach((m) => out.add(m.id))
      else members.filter((m) => m.guardians?.includes(uid) && m.role !== 'guardian').forEach((m) => out.add(m.id))
    }
    return [...out]
  })()
  const called = who === 'asked' ? asked : who === 'yes' ? yesMembers : []

  async function add() {
    if (!title.trim()) return setErr('Give it a title.')
    if (who === 'yes' && called.length === 0) return setErr('Nobody has said this time works yet — pick Everyone, or wait for answers.')
    setBusy(true)
    try {
      await pb.send('/api/glowtape/events', {
        method: 'POST',
        body: {
          production: production.id,
          title: title.trim(),
          kind: 'Rehearsal',
          location,
          called,
          notes: `Picked from the poll: ${message.poll?.question ?? ''}`.slice(0, 500),
          occurrences: [{ start: option.start, end: option.end ?? '' }],
        },
      })
      setDone(true)
      setErr('')
      onDone()
    } catch (e) {
      setErr(errText(e, "That didn't save — check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p role="status" className="poll-schedule" style={{ margin: 0 }}>
        ✓ It's on the schedule — everyone called got an email, and the poll is closed.{' '}
        <Link className="link" to={`/production/${production.id}/schedule`}>
          See the schedule →
        </Link>
      </p>
    )
  }

  return (
    <div className="card stack poll-schedule">
      <strong>📅 {optionLabel(message.poll!, option)}</strong>
      <label>
        Title
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Where
        <input
          value={location}
          list={`poll-places-${message.id}`}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Example: Driftwood Playhouse"
        />
        <datalist id={`poll-places-${message.id}`}>
          {places.map((p) => (
            <option key={p.name} value={p.name} />
          ))}
        </datalist>
      </label>
      <fieldset className="stack">
        <legend>Who's called</legend>
        {asked.length > 0 && (
          <label className="row">
            <input type="radio" name={`who-${message.id}`} checked={who === 'asked'} onChange={() => setWho('asked')} />
            The {asked.length === 1 ? 'person' : `${asked.length} people`} the poll asked
          </label>
        )}
        <label className="row">
          <input type="radio" name={`who-${message.id}`} checked={who === 'yes'} onChange={() => setWho('yes')} />
          Everyone who said it works ({yesMembers.length})
        </label>
        <label className="row">
          <input type="radio" name={`who-${message.id}`} checked={who === 'all'} onChange={() => setWho('all')} />
          The whole show
        </label>
      </fieldset>
      <p className="hint" style={{ margin: 0 }}>
        Adds one rehearsal and emails everyone called, just like the Schedule tab. The poll closes. You can
        edit details on the Schedule tab afterwards.
      </p>
      <div className="row">
        <button type="button" disabled={busy} onClick={add}>
          Add to the schedule
        </button>
        <button type="button" className="link" onClick={onCancel}>
          cancel
        </button>
      </div>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

type TimeRow = { date: string; from: string; to: string }

// The "start a poll" form, shown above the chat composer.
export function PollComposer({
  channelId,
  onCreated,
  onCancel,
}: {
  channelId: string
  onCreated: (m: MessageRecord) => void
  onCancel: () => void
}) {
  const { user } = useAuth()
  const [kind, setKind] = useState<Poll['kind']>('choice')
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [times, setTimes] = useState<TimeRow[]>([{ date: '', from: '18:00', to: '21:00' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function setTime(i: number, patch: Partial<TimeRow>) {
    setTimes(times.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    let options: { label?: string; start?: string; end?: string }[]
    if (kind === 'times') {
      const rows = times.filter((t) => t.date && t.from)
      if (rows.length < 2) return setErr('Add at least two dates with a start time.')
      options = rows.map((t) => ({
        start: new Date(`${t.date}T${t.from}`).toISOString(),
        ...(t.to && t.to > t.from ? { end: new Date(`${t.date}T${t.to}`).toISOString() } : {}),
      }))
    } else {
      const filled = answers.map((a) => a.trim()).filter(Boolean)
      if (filled.length < 2) return setErr('Add at least two answers.')
      options = filled.map((label) => ({ label }))
    }
    if (!question.trim()) return setErr('Type the question first.')
    setBusy(true)
    try {
      const created = await pb.collection('messages').create<MessageRecord>(
        {
          channel: channelId,
          author: user!.id,
          text: question.trim(),
          poll: { kind, question: question.trim(), multi, options },
        },
        { expand: 'author' },
      )
      onCreated(created)
    } catch (e2) {
      setErr(errText(e2, "That poll didn't post — check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack poll-composer" onSubmit={submit} aria-label="Start a poll">
      <strong>Start a poll</strong>
      <div className="chips" role="group" aria-label="Kind of poll">
        <button
          type="button"
          className={kind === 'choice' ? 'chip chip-active' : 'chip'}
          aria-pressed={kind === 'choice'}
          onClick={() => setKind('choice')}
        >
          📊 Question with answers
        </button>
        <button
          type="button"
          className={kind === 'times' ? 'chip chip-active' : 'chip'}
          aria-pressed={kind === 'times'}
          onClick={() => setKind('times')}
        >
          📅 When works? (dates &amp; times)
        </button>
      </div>
      <label>
        Question
        <input
          value={question}
          maxLength={300}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            kind === 'times' ? 'Example: Which night works for an extra music rehearsal?' : 'Example: Cast party — pizza or tacos?'
          }
        />
      </label>
      {kind === 'choice' ? (
        <>
          {answers.map((a, i) => (
            <div className="row" key={i}>
              <input
                aria-label={`Answer ${i + 1}`}
                value={a}
                maxLength={150}
                onChange={(e) => setAnswers(answers.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Answer ${i + 1}`}
              />
              {answers.length > 2 && (
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove answer ${i + 1}`}
                  onClick={() => setAnswers(answers.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {answers.length < 20 && (
            <button type="button" className="link" onClick={() => setAnswers([...answers, ''])}>
              + Add an answer
            </button>
          )}
          <label className="row">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            People can pick more than one
          </label>
        </>
      ) : (
        <>
          <p className="hint" style={{ margin: 0 }}>
            Add each date and time you're considering. Everyone marks the ones that work for them.
          </p>
          {times.map((t, i) => (
            <div className="row poll-time-row" key={i}>
              <label>
                Date
                <input type="date" value={t.date} onChange={(e) => setTime(i, { date: e.target.value })} />
              </label>
              <label>
                From
                <input type="time" value={t.from} onChange={(e) => setTime(i, { from: e.target.value })} />
              </label>
              <label>
                To
                <input type="time" value={t.to} onChange={(e) => setTime(i, { to: e.target.value })} />
              </label>
              {times.length > 1 && (
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove time ${i + 1}`}
                  onClick={() => setTimes(times.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {times.length < 20 && (
            <button
              type="button"
              className="link"
              onClick={() => setTimes([...times, { ...times[times.length - 1], date: '' }])}
            >
              + Add a time
            </button>
          )}
        </>
      )}
      <div className="row">
        <button type="submit" disabled={busy}>
          Post the poll
        </button>
        <button type="button" className="link" onClick={onCancel}>
          cancel
        </button>
      </div>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </form>
  )
}
