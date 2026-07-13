import { useEffect, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

type PushState =
  | 'checking'
  | 'unavailable' // server has no VAPID keys yet — render nothing
  | 'unsupported' // browser can't do push at all — render nothing
  | 'ios-install' // iPhone Safari tab: push needs Add to Home Screen first
  | 'denied'
  | 'off'
  | 'on'

// Per-device notification toggle: messages, announcements, schedule changes,
// and task pings arrive as real notifications on this phone/computer.
export default function PushSettings() {
  const { user } = useAuth()
  const [state, setState] = useState<PushState>('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function check() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
        const standalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          (navigator as unknown as { standalone?: boolean }).standalone === true
        setState(isIos && !standalone ? 'ios-install' : 'unsupported')
        return
      }
      try {
        await pb.send('/api/glowtape/push/key', { method: 'GET' })
      } catch {
        setState('unavailable')
        return
      }
      if (Notification.permission === 'denied') {
        setState('denied')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
    }
    check().catch(() => setState('unsupported'))
  }, [])

  async function enable() {
    setBusy(true)
    setError('')
    try {
      const { key } = await pb.send('/api/glowtape/push/key', { method: 'GET' })
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
      const json = sub.toJSON()
      try {
        await pb.collection('push_subscriptions').create({
          user: user?.id,
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          ua: navigator.userAgent.slice(0, 200),
        })
      } catch {
        /* endpoint already registered — that's fine */
      }
      setState('on')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn on notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError('')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        try {
          const rows = await pb.collection('push_subscriptions').getFullList({
            filter: pb.filter('user = {:u} && endpoint = {:e}', {
              u: user?.id,
              e: sub.endpoint,
            }),
          })
          for (const r of rows) await pb.collection('push_subscriptions').delete(r.id)
        } catch {
          /* record already gone */
        }
        await sub.unsubscribe()
      }
      setState('off')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'checking' || state === 'unavailable' || state === 'unsupported') return null

  return (
    <section>
      <h2>Notifications</h2>
      {state === 'ios-install' && (
        <p className="hint">
          To get notifications on an iPhone, first add Glow Tape to your Home Screen (Safari →
          Share → <em>Add to Home Screen</em>), then open it from there and this switch appears.
        </p>
      )}
      {state === 'denied' && (
        <p className="hint">
          Notifications are blocked for glowtape.net in your browser settings — allow them
          there, then come back.
        </p>
      )}
      {state === 'off' && (
        <>
          <p className="hint">
            Get messages, schedule changes, and reminders as notifications on this device —
            like a real app, because it is one.
          </p>
          <button onClick={enable} disabled={busy}>
            {busy ? 'One moment…' : '🔔 Turn on notifications'}
          </button>
        </>
      )}
      {state === 'on' && (
        <>
          <p className="acked">🔔 Notifications are on for this device.</p>
          <button className="link" onClick={disable} disabled={busy}>
            Turn them off
          </button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}
