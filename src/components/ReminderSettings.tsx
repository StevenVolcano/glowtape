import { useState } from 'react'
import { pb } from '../lib/pb.ts'
import { REMINDER_DEFAULT, REMINDER_OPTIONS } from '../lib/types.ts'
import type { UserRecord } from '../lib/types.ts'

const MAX = 3

// When to be reminded about calls. One choice drives both the text reminders
// and the app notifications (cron in backend/pb_hooks/sms.pb.js).
export default function ReminderSettings({ user }: { user: UserRecord }) {
  const [chosen, setChosen] = useState<string[]>(
    Array.isArray(user.reminderTimes) ? user.reminderTimes : REMINDER_DEFAULT,
  )
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function toggle(key: string) {
    const next = chosen.includes(key)
      ? chosen.filter((k) => k !== key)
      : chosen.length >= MAX
        ? chosen
        : [...chosen, key]
    if (next === chosen) return
    const before = chosen
    setChosen(next)
    setSaving(true)
    setError('')
    setStatus('')
    try {
      // keep the list in the same order as the chips
      const ordered = REMINDER_OPTIONS.map((o) => o.key).filter((k) => next.includes(k))
      await pb.collection('users').update(user.id, { reminderTimes: ordered })
      setStatus(ordered.length === 0 ? 'Saved — no reminders.' : 'Saved. ✓')
    } catch {
      setChosen(before)
      setError("Couldn't save that — check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  const full = chosen.length >= MAX

  return (
    <section>
      <h2>When to remind me</h2>
      <div className="card stack">
        <p className="hint" style={{ margin: 0 }}>
          Pick up to {MAX} times before each call. Reminders come as a phone notification (if
          you've turned notifications on) and a text (if you've added your cell below — texts
          are the two closest to the call). Never between 9pm and 7am: a reminder that would
          land then comes the evening before instead.
        </p>
        <div className="chips" role="group" aria-label="Reminder times">
          {REMINDER_OPTIONS.map((o) => {
            const on = chosen.includes(o.key)
            return (
              <button
                key={o.key}
                type="button"
                className={on ? 'chip chip-active' : 'chip'}
                aria-pressed={on}
                disabled={saving || (!on && full)}
                onClick={() => toggle(o.key)}
              >
                {on ? '✓ ' : ''}
                {o.label}
              </button>
            )
          })}
        </div>
        {full && <p className="hint" style={{ margin: 0 }}>That's {MAX} — tap one off to pick a different time.</p>}
        {chosen.length === 0 && (
          <p className="warn" style={{ margin: 0 }}>
            No reminders picked — you'll still get schedule emails, just no heads-up before calls.
          </p>
        )}
        {status && <p className="acked" role="status" style={{ margin: 0 }}>{status}</p>}
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    </section>
  )
}
