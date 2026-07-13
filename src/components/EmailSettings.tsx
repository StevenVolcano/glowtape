import { useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import type { UserRecord } from '../lib/types.ts'

// Change the sign-in email. The code goes to the NEW address — proving they
// own that inbox before the account switches to it (there's no password).
export default function EmailSettings({ user }: { user: UserRecord }) {
  const [editing, setEditing] = useState(false)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function start(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await pb.send('/api/glowtape/email/start', { method: 'POST', body: { email } })
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a code there.")
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await pb.send('/api/glowtape/email/confirm', { method: 'POST', body: { email, code } })
      await pb.collection('users').authRefresh()
      setEditing(false)
      setStep('email')
      setCode('')
      setDone('Done — sign in with the new address from now on. ✓')
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't match.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>My email</h2>
      <div className="card stack">
        <div>
          ✉️ <strong>{user.email}</strong> is your sign-in address.
        </div>
        {done && <p className="acked" role="status">{done}</p>}
        {!editing ? (
          <button className="link" onClick={() => { setEditing(true); setDone('') }}>
            Change email
          </button>
        ) : step === 'email' ? (
          <form onSubmit={start} className="row">
            <input
              aria-label="New email address"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="The new address"
            />
            <button type="submit" disabled={busy || !email.includes('@')}>
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
            <button type="button" className="link" onClick={() => setEditing(false)}>
              Never mind
            </button>
          </form>
        ) : (
          <form onSubmit={confirm} className="row">
            <p className="hint" style={{ width: '100%', margin: 0 }}>
              A 6-digit code went to <strong>{email}</strong> — check that inbox (and spam).
            </p>
            <input
              aria-label="Confirmation code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="The 6-digit code"
            />
            <button type="submit" disabled={busy || code.trim().length < 6}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
            <button type="button" className="link" onClick={() => setStep('email')}>
              Start over
            </button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
