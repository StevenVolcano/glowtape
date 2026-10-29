import { useState } from 'react'
import { pb } from '../lib/pb.ts'
import { pbErrorMessage } from '../lib/files.ts'
import { useProduction } from '../pages/Production.tsx'
import { formatWhen, pbDate } from '../lib/types.ts'
import { invitees } from '../lib/rsvp.ts'
import type { AckRecord, EventRecord } from '../lib/types.ts'

interface RemindResult {
  reminded: string[]
  answered: number
  unreachable: string[]
  texted: number
  quiet?: boolean
  smsOn?: boolean
}

// 🔔 Manager nudge for one event: everyone called who hasn't tapped Got it
// (or RSVP'd) gets a push + email, and a text if they said yes to texts.
// If the time or place changed, the reminder says what changed. The server
// (POST /api/glowtape/events/remind) picks who and limits it to one every
// few hours.
export default function RemindButton({ event, acks }: { event: EventRecord; acks: AckRecord[] }) {
  const { members } = useProduction()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RemindResult | null>(null)
  const [error, setError] = useState('')

  const ends = pbDate(event.end || event.start).getTime()
  if (event.status === 'cancelled' || ends < Date.now()) return null

  // Client-side count for the button label (Got-it events only — RSVP rows
  // live in RsvpPanel). The server makes the real list.
  const waiting = event.rsvp
    ? null
    : invitees(event, members).filter((m) => {
        const people = [m.user, ...(m.guardians ?? [])].filter(Boolean)
        return !acks.some((a) => a.event === event.id && people.includes(a.user))
      }).length
  if (waiting === 0) return null

  const who = event.rsvp
    ? "everyone who hasn't RSVP'd"
    : `the ${waiting} ${waiting === 1 ? "person who hasn't" : "people who haven't"} tapped “Got it”`

  async function send() {
    const changed = event.changeNote ? `\n\nIt will lead with what changed: ${event.changeNote}.` : ''
    if (!window.confirm(`Send a reminder to ${who}? They get a notification and an email, plus a text if they've said yes to texts.${changed}`)) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await pb.send<RemindResult>('/api/glowtape/events/remind', { method: 'POST', body: { event: event.id } }))
    } catch (err) {
      setError(pbErrorMessage(err, "Couldn't send the reminder."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="link" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : `🔔 Remind ${who}`}
        </button>
      </div>
      {event.remindedAt && !result && (
        <div className="hint">Last reminder sent {formatWhen(event.remindedAt)}.</div>
      )}
      {result && (
        <div className="hint" role="status">
          {result.reminded.length === 0
            ? 'Everyone has already answered — nobody to remind.'
            : `Reminded ${result.reminded.join(', ')}.`}
          {result.texted > 0 && ` ${result.texted} got a text.`}
          {result.quiet && result.smsOn && ' No texts went out because it’s quiet hours (9pm–7am).'}
          {result.unreachable.length > 0 &&
            ` Not on Glow Tape and no email on file: ${result.unreachable.join(', ')}.`}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
