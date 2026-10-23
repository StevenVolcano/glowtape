import { useEffect, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { formatStamp } from '../lib/types.ts'
import { deviceLabel, isCancel, passkeysSupported, registerPasskey } from '../lib/passkeys.ts'
import Section from './Section.tsx'

type Passkey = { id: string; label: string; created: string; lastUsed: string }

// Set up fingerprint / face sign-in on this device, and see or remove the
// devices already set up. Optional — the emailed code always still works.
export default function PasskeySettings() {
  const [keys, setKeys] = useState<Passkey[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const supported = passkeysSupported()

  async function load() {
    try {
      setKeys(await pb.collection('passkeys').getFullList<Passkey>({ sort: 'created' }))
    } catch {
      setKeys([])
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function add() {
    setBusy(true)
    setError('')
    setDone('')
    try {
      await registerPasskey(deviceLabel())
      setDone("Done — next time, tap \"Sign in with fingerprint or face\". ✓")
      await load()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        setError('This device is already set up.')
      } else if (!isCancel(err)) {
        setError(err instanceof Error ? err.message : "Couldn't set that up.")
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(k: Passkey) {
    if (!confirm(`Stop fingerprint sign-in on "${k.label}"? You can always set it up again.`)) return
    setError('')
    setDone('')
    try {
      await pb.collection('passkeys').delete(k.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that.")
    }
  }

  if (!supported && !keys?.length) return null

  return (
    <Section id="passkeys" title="Fingerprint sign-in">
      <div className="card stack">
        <p className="hint" style={{ margin: 0 }}>
          Skip the emailed code: sign in with your fingerprint, face, or the PIN that unlocks
          this phone or computer. Your fingerprint never leaves your device — Glow Tape never
          sees it.
        </p>
        {keys && keys.length > 0 && (
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {keys.map((k) => (
              <li key={k.id} className="row">
                <span>
                  👆 <strong>{k.label}</strong>{' '}
                  <span className="hint">
                    — added {formatStamp(k.created)}
                    {k.lastUsed && `, last used ${formatStamp(k.lastUsed)}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove fingerprint sign-in on ${k.label}`}
                  onClick={() => remove(k)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {supported && (
          <button type="button" onClick={add} disabled={busy}>
            {busy ? 'Waiting for your device…' : '👆 Set up fingerprint sign-in on this device'}
          </button>
        )}
        {done && <p className="acked" role="status">{done}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Section>
  )
}
