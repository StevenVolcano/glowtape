import { useEffect, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import { pbErrorMessage } from '../lib/files.ts'
import { memberName } from '../lib/types.ts'
import { RSVP_ANSWERS, invitees, myInvitees } from '../lib/rsvp.ts'
import type { EventRecord, MemberRecord, RsvpRecord } from '../lib/types.ts'

// Going / Maybe / Can't go on a party (or any event a manager switched RSVP
// on for). Invitees answer for themselves and their kids, plus how many
// guests they're bringing. Managers get the headcount and the names; the
// cast only ever sees their own answers (collection rules).
export default function RsvpPanel({ event }: { event: EventRecord }) {
  const { members, isManager } = useProduction()
  const { user } = useAuth()
  const [rows, setRows] = useState<RsvpRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showNames, setShowNames] = useState(false)

  async function load() {
    const list = await pb.collection('rsvps').getFullList<RsvpRecord>({
      filter: pb.filter('event = {:e}', { e: event.id }),
    })
    setRows(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id])

  async function answer(m: MemberRecord, value: string, guests: number) {
    setBusy(true)
    setErr('')
    try {
      await pb.send('/api/glowtape/rsvp', {
        method: 'POST',
        body: { event: event.id, member: m.id, answer: value, guests },
      })
      await load()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't save that — try again."))
    } finally {
      setBusy(false)
    }
  }

  const mine = user ? myInvitees(event, members, user.id) : []
  const rowFor = (m: MemberRecord) => rows.find((r) => r.member === m.id)
  const name = (m: MemberRecord) => m.displayName || memberName(m)

  // Headcount (managers): everyone answering for the people called.
  const list = invitees(event, members)
  const going = rows.filter((r) => r.answer === 'yes')
  const guests = going.reduce((n, r) => n + (r.guests || 0), 0)
  const maybe = rows.filter((r) => r.answer === 'maybe')
  const no = rows.filter((r) => r.answer === 'no')
  const unanswered = list.filter((m) => !rowFor(m))
  const namesOf = (rs: RsvpRecord[]) =>
    rs
      .map((r) => {
        const m = members.find((x) => x.id === r.member)
        const n = m ? name(m) : 'someone'
        return r.guests ? `${n} +${r.guests}` : n
      })
      .join(', ')

  return (
    <div className="stack rsvp">
      {mine.map((m) => {
        const r = rowFor(m)
        const isMe = m.user === user?.id
        return (
          <div key={m.id} className="stack">
            <strong>{isMe ? '🎉 Are you coming?' : `🎉 Is ${name(m)} coming?`}</strong>
            <div className="chips" role="group" aria-label={isMe ? 'Your RSVP' : `RSVP for ${name(m)}`}>
              {RSVP_ANSWERS.map((a) => {
                const on = r?.answer === a.value
                return (
                  <button
                    key={a.value}
                    type="button"
                    className={`chip${on ? ' chip-active' : ''}`}
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => answer(m, on ? '' : a.value, r?.guests ?? 0)}
                  >
                    {a.label}
                  </button>
                )
              })}
            </div>
            {r && r.answer !== 'no' && (
              <div className="row">
                <span>Bringing guests:</span>
                <button
                  type="button"
                  className="chip"
                  aria-label="One fewer guest"
                  disabled={busy || !r.guests}
                  onClick={() => answer(m, r.answer, (r.guests || 0) - 1)}
                >
                  −
                </button>
                <span aria-live="polite">{r.guests || 0}</span>
                <button
                  type="button"
                  className="chip"
                  aria-label="One more guest"
                  disabled={busy || (r.guests || 0) >= 20}
                  onClick={() => answer(m, r.answer, (r.guests || 0) + 1)}
                >
                  +
                </button>
              </div>
            )}
          </div>
        )
      })}
      {isManager && (
        <div className="stack">
          <div role="status">
            <strong>
              🎉 {going.length} going
              {guests > 0 && ` + ${guests} guest${guests === 1 ? '' : 's'} = ${going.length + guests}`}
            </strong>
            {' · '}
            {maybe.length} maybe · {no.length} can't go · {unanswered.length} haven't answered
          </div>
          <button
            type="button"
            className="link"
            aria-expanded={showNames}
            onClick={() => setShowNames(!showNames)}
          >
            {showNames ? '▾ Hide names' : '▸ Who said what'}
          </button>
          {showNames && (
            <div className="stack">
              {going.length > 0 && <div>Going: {namesOf(going)}</div>}
              {maybe.length > 0 && <div>Maybe: {namesOf(maybe)}</div>}
              {no.length > 0 && <div>Can't go: {namesOf(no)}</div>}
              {unanswered.length > 0 && (
                <div className="hint">No answer yet: {unanswered.map(name).join(', ')}</div>
              )}
            </div>
          )}
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  )
}
