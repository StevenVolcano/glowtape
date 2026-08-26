import { useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { SMS_READY, copyrightLine } from '../lib/types.ts'
import { useTitle } from '../lib/useTitle.ts'

type Method = 'email' | 'phone'
type Step = 'enter' | 'code'

// Passwordless sign-in, two ways: email a code, or text a code.
// (Text sign-in only works for phones already verified on an account,
// and only once the server has an SMS provider configured.)
export default function SignIn() {
  useTitle('Sign in')
  const [method, setMethod] = useState<Method>('email')
  const [step, setStep] = useState<Step>('enter')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState(localStorage.getItem('gt-pending-code') ?? '')
  const [ageBand, setAgeBand] = useState<'' | 'under13' | 'teen' | 'adult'>('')
  const [age, setAge] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [otpId, setOtpId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function switchMethod(m: Method) {
    setMethod(m)
    setStep('enter')
    setCode('')
    setError('')
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (method === 'email') {
        await pb.send('/api/glowtape/signup', {
          method: 'POST',
          body: { email, name, code: joinCode, band: ageBand, age: Number(age) || 0 },
        })
        if (joinCode.trim()) localStorage.setItem('gt-pending-code', joinCode.trim())
        const result = await pb.collection('users').requestOTP(email.trim().toLowerCase())
        setOtpId(result.otpId)
      } else {
        await pb.send('/api/glowtape/signin-sms/start', { method: 'POST', body: { phone } })
      }
      setStep('code')
    } catch (err) {
      setError(
        err instanceof Error && err.message.length < 120
          ? err.message
          : "We couldn't send a code. Check what you entered and try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirmCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (method === 'email') {
        await pb.collection('users').authWithOTP(otpId, code.trim())
      } else {
        const res = await pb.send('/api/glowtape/signin-sms/confirm', {
          method: 'POST',
          body: { phone, code },
        })
        pb.authStore.save(res.token, res.record)
      }
    } catch {
      setError("That code didn't match. Check the message and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand">
          <img className="brand-lamp" src="/icons/glowtape.svg" alt="" width="44" height="44" />
          <h1>Glow Tape</h1>
        </div>
        <p className="tagline">Grays Harbor's theater community</p>

        {SMS_READY && (
          <div className="chips">
            <button
              type="button"
              aria-pressed={method === 'email'}
              className={`chip ${method === 'email' ? 'chip-active' : ''}`}
              onClick={() => switchMethod('email')}
            >
              Email me a code
            </button>
            <button
              type="button"
              aria-pressed={method === 'phone'}
              className={`chip ${method === 'phone' ? 'chip-active' : ''}`}
              onClick={() => switchMethod('phone')}
            >
              Text me a code
            </button>
          </div>
        )}

        {step === 'enter' ? (
          <form onSubmit={sendCode}>
            {method === 'email' ? (
              <>
                <label htmlFor="name">Your name</label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="As it should appear on the contact sheet"
                  required
                />
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Example: pat@gmail.com"
                  required
                />
                <span id="age-band-label" style={{ fontWeight: 600 }}>
                  New here? How old are you?{' '}
                  <span className="hint" style={{ fontWeight: 400 }}>
                    (already have an account? skip this)
                  </span>
                </span>
                <div className="chips" role="group" aria-labelledby="age-band-label">
                  {(
                    [
                      ['under13', 'Under 13'],
                      ['teen', '13–17'],
                      ['adult', '18 or older'],
                    ] as const
                  ).map(([band, label]) => (
                    <button
                      type="button"
                      key={band}
                      className={`chip ${ageBand === band ? 'chip-active' : ''}`}
                      aria-pressed={ageBand === band}
                      onClick={() => setAgeBand(band)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {ageBand === 'under13' && (
                  <p className="hint" role="status">
                    Glow Tape accounts start at 13 — but you're not left out! Ask a parent or
                    guardian to claim your role: they sign up instead, and they'll get your
                    whole schedule and messages. (That's our safety model, on purpose.)
                  </p>
                )}
                {ageBand === 'teen' && (
                  <>
                    <label htmlFor="age">Your age</label>
                    <input
                      id="age"
                      type="number"
                      inputMode="numeric"
                      min="13"
                      max="17"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      placeholder="13–17"
                      required
                    />
                    <p className="hint" style={{ margin: 0 }}>
                      This just sets when grown-up features unlock automatically at 18. Your
                      age is never shown to anyone and isn't kept — only the range.
                    </p>
                  </>
                )}
                <p className="hint" style={{ margin: 0 }}>
                  We ask because theater includes kids — the range sets the right safety
                  protections and nothing else.
                </p>
                <label htmlFor="joincode">Code</label>
                <input
                  id="joincode"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="From your production or the organizer"
                />
                <p className="hint">
                  New accounts need a code — a production join code, a role code, or a community
                  code. Already have an account? Leave it blank.
                </p>
              </>
            ) : (
              <>
                <label htmlFor="phone">Cell phone number</label>
                <input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Example: (360) 555-0123"
                  required
                />
                <p className="hint">
                  Works once you've added your phone in Glow Tape. New here? Start with email —
                  it takes a minute.
                </p>
              </>
            )}
            <button
              type="submit"
              disabled={
                busy ||
                (method === 'email' &&
                  (ageBand === 'under13' ||
                    (ageBand === 'teen' && (Number(age) < 13 || Number(age) > 17))))
              }
            >
              {busy ? 'Sending…' : method === 'email' ? 'Email me a sign-in code' : 'Text me a sign-in code'}
            </button>
            {method === 'email' && (
              <p className="hint">No password to remember. We email you a 6-digit code instead.</p>
            )}
          </form>
        ) : (
          <form onSubmit={confirmCode}>
            <label htmlFor="code">
              Enter the 6-digit code we {method === 'email' ? `emailed to ${email}` : `texted to ${phone}`}
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="The 6-digit code"
              required
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="link" onClick={() => setStep('enter')}>
              Start over
            </button>
          </form>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <p className="hint legal-links">
          <a href="/help.html">Help</a> · <a href="/privacy.html">Privacy</a> ·{' '}
          <a href="/terms.html">Terms</a> · Free for Grays Harbor theater
          <br />
          {copyrightLine()}
        </p>
      </div>
    </main>
  )
}
