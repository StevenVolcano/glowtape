import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { pbErrorMessage } from '../lib/files.ts'
import { formatWhen, memberName } from '../lib/types.ts'
import type { AttendanceRecord, EventRecord } from '../lib/types.ts'
import QrCode from '../components/QrCode.tsx'

// The page behind the door QR: one big "I'm here" button. Parents see one
// button per child they manage. The server route verifies the code and the
// time window; this page just makes tapping it unmissable.
export default function CheckIn() {
  const { eventId } = useParams()
  const [searchParams] = useSearchParams()
  const code = searchParams.get('c') ?? ''
  const { production, members } = useProduction()
  const { user } = useAuth()
  const [event, setEvent] = useState<EventRecord | null>(null)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const base = `/production/${production.id}`

  async function load() {
    if (!eventId) return
    const [ev, at] = await Promise.all([
      pb.collection('events').getOne<EventRecord>(eventId),
      pb.collection('attendance').getFullList<AttendanceRecord>({
        filter: pb.filter('event = {:e}', { e: eventId }),
      }),
    ])
    setEvent(ev)
    setAttendance(at)
  }

  useEffect(() => {
    load()
      .catch(() => setError("Couldn't open this event."))
      .finally(() => setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  const mine = members.filter(
    (m) =>
      (m.user === user?.id || m.guardians?.includes(user?.id ?? '')) &&
      m.role !== 'guardian' &&
      !(m.multi && !m.user),
  )

  const statusFor = (memberId: string) =>
    attendance.find((a) => a.member === memberId) ?? null

  async function checkIn(memberIds: string[]) {
    if (!eventId) return
    setBusy(true)
    setError('')
    try {
      await pb.send('/api/glowtape/attendance/signin', {
        method: 'POST',
        body: { event: eventId, code, members: memberIds },
      })
      await load()
    } catch (err) {
      setError(pbErrorMessage(err, "Check-in didn't go through — try again, or grab your stage manager."))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <p>Loading…</p>
  if (!event) {
    return (
      <section>
        <p className="error">{error || "Couldn't open this event."}</p>
        <Link className="link" to={`${base}/schedule`}>
          ← Schedule
        </Link>
      </section>
    )
  }

  const allIn = mine.length > 0 && mine.every((m) => statusFor(m.id)?.status === 'present')

  return (
    <section className="stack">
      <h2>✋ Check in</h2>
      <div className="card stack">
        <strong>{event.title}</strong>
        <span className="hint">
          {formatWhen(event.start, event.end)}
          {event.location ? ` · ${event.location}` : ''}
        </span>
      </div>
      {mine.length === 0 && (
        <p className="hint">
          You're not in this production's cast list — nothing to check in. If that seems
          wrong, grab your stage manager.
        </p>
      )}
      {allIn && (
        <p className="acked" role="status" style={{ fontSize: '1.15rem' }}>
          🎉 {mine.length === 1 ? "You're checked in" : 'Everyone is checked in'} — have a
          great rehearsal!
        </p>
      )}
      {mine.map((m) => {
        const row = statusFor(m.id)
        const isMe = m.user === user?.id
        const name = isMe ? "I'm here" : `${m.displayName || memberName(m)} is here`
        if (row?.status === 'present') {
          return (
            <p key={m.id} className="acked" role="status">
              ✓ {isMe ? "You're" : `${m.displayName || memberName(m)} is`} checked in
              {row.note ? ` (${row.note})` : ''}
            </p>
          )
        }
        return (
          <button
            key={m.id}
            type="button"
            disabled={busy}
            onClick={() => checkIn([m.id])}
            style={{ fontSize: '1.3rem', padding: '0.9rem 1.2rem' }}
          >
            ✋ {name}
          </button>
        )
      })}
      {error && <p className="error" role="alert">{error}</p>}
      <p>
        <Link className="link" to={`${base}/schedule`}>
          → Tonight's schedule
        </Link>
      </p>
    </section>
  )
}

// A one-page poster for the door: big QR, big title. The print stylesheet
// already strips the app chrome, so the browser's print dialog does the rest.
// Doubles as a kiosk screen for an old phone propped by the door: it holds a
// screen wake lock while visible, and kiosk mode hides the app chrome so
// there's nothing to wander into (pair it with the phone's screen pinning /
// Guided Access to really lock it down).
export function CheckInPoster() {
  const { eventId } = useParams()
  const { production } = useProduction()
  const [event, setEvent] = useState<EventRecord | null>(null)
  const [kiosk, setKiosk] = useState(false)

  useEffect(() => {
    if (!eventId) return
    pb.collection('events')
      .getOne<EventRecord>(eventId)
      .then(setEvent)
      .catch(() => {})
  }, [eventId])

  // Keep the door phone's screen awake while this page is showing. The lock
  // is dropped by the OS when the tab hides, so re-grab it on return.
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> }
    let lock: WakeLockSentinel | null = null
    const wl = (navigator as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } })
      .wakeLock
    const acquire = () => {
      wl?.request('screen')
        .then((l) => {
          lock = l
        })
        .catch(() => {})
    }
    acquire()
    const onVis = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      lock?.release().catch(() => {})
    }
  }, [])

  // Kiosk mode: fullscreen + a body class the stylesheet uses to hide the
  // production header/tabs. Exiting fullscreen (or leaving) restores both.
  useEffect(() => {
    document.body.classList.toggle('kiosk', kiosk)
    const onFsChange = () => {
      if (!document.fullscreenElement) setKiosk(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.body.classList.remove('kiosk')
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [kiosk])

  async function enterKiosk() {
    setKiosk(true)
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      /* fullscreen unsupported (e.g. iPhone Safari) — the body class still hides the chrome */
    }
  }

  if (!event) return <p>Loading…</p>
  if (!event.signinCode) {
    return (
      <p className="hint">
        Door check-in isn't turned on for this event — turn it on from roll call on the
        Schedule tab.
      </p>
    )
  }

  const url = `${window.location.origin}/production/${production.id}/signin/${event.id}?c=${event.signinCode}`

  return (
    <section className="stack" style={{ textAlign: 'center', alignItems: 'center' }}>
      <h2 style={{ fontSize: '1.8rem' }}>✋ Check in here!</h2>
      <p style={{ fontSize: '1.2rem', margin: 0 }}>
        <strong>{production.title}</strong>
        <br />
        {event.title} — {formatWhen(event.start, event.end)}
      </p>
      <QrCode text={url} label="Scan with your phone camera, then tap I'm here" size={320} />
      <p className="hint no-print">Scan with your phone's camera and tap the big button.</p>
      {!kiosk && (
        <div className="row no-print" style={{ justifyContent: 'center' }}>
          <button type="button" onClick={() => window.print()}>
            🖨 Print this poster
          </button>
          <button type="button" onClick={enterKiosk}>
            📺 Kiosk mode
          </button>
        </div>
      )}
      {!kiosk && (
        <p className="hint no-print" style={{ maxWidth: '34rem' }}>
          Leaving an old phone by the door? Tap <em>Kiosk mode</em> — the screen stays awake
          and the rest of the app hides. Then pin the screen so taps can't leave it: on
          Android, Settings → Security → App pinning; on iPhone, Guided Access. And keep it
          plugged in.
        </p>
      )}
    </section>
  )
}
