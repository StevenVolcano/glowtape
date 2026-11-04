import { useRef, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useTitle } from '../lib/useTitle.ts'
import { CORE_VIDEOS, HOWTO_VIDEOS, seenCount, type HowToVideo } from '../lib/howto.ts'
import SiteMenu from '../components/SiteMenu.tsx'

// The how-to video series. Works signed out too (the first video is about
// signing in), but only a signed-in viewer gets their watched list saved —
// that's what ticks off "Watch the how-to videos" in Getting settled.
export default function HowTo() {
  useTitle('How-to videos')
  const { user } = useAuth()
  const [seen, setSeen] = useState<string[]>(() => user?.videosSeen ?? [])
  const saving = useRef(new Set<string>())

  async function markSeen(slug: string) {
    if (!user || seen.includes(slug) || saving.current.has(slug)) return
    saving.current.add(slug)
    const next = [...seen, slug]
    setSeen(next)
    try {
      await pb.collection('users').update(user.id, { videosSeen: next })
    } catch {
      // Watching still worked; the tick just won't stick on other devices.
    } finally {
      saving.current.delete(slug)
    }
  }

  const done = seenCount(seen)

  return (
    <main className="page">
      <header className="topbar">
        {user && <SiteMenu />}
        <span className="brand-small">Glow Tape</span>
      </header>

      <h1>How-to videos</h1>
      <p className="hint">
        Short videos, about a minute each, that walk you through getting started. Each one has
        captions on the screen and a written version under it.
        {user && (
          <>
            {' '}
            <strong>
              {done === CORE_VIDEOS.length
                ? "✓ You've watched them all."
                : `You've watched ${done} of ${CORE_VIDEOS.length}.`}
            </strong>
          </>
        )}
      </p>

      <ol className="howto-list">
        {HOWTO_VIDEOS.map((v, i) => (
          <VideoCard key={v.slug} v={v} n={i + 1} seen={seen.includes(v.slug)} onSeen={markSeen} />
        ))}
      </ol>

      <p className="hint">
        More questions? The <a href="/help.html">Help page</a> has the whole manual.
        {!user && (
          <>
            {' '}
            <a href="/">Back to sign in</a>
          </>
        )}
      </p>
    </main>
  )
}

function VideoCard({
  v,
  n,
  seen,
  onSeen,
}: {
  v: HowToVideo
  n: number
  seen: boolean
  onSeen: (slug: string) => void
}) {
  const mins = `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}`
  return (
    <li className="card stack howto-card" id={v.slug}>
      <h2 className="howto-title">
        {v.bonus ? 'Bonus' : `Part ${n}`}: {v.title}{' '}
        <span className="hint">({mins})</span>
        {seen && <span className="acked howto-seen"> ✓ Watched</span>}
      </h2>
      <p className="hint" style={{ margin: 0 }}>
        {v.blurb}
      </p>
      <video
        className="howto-video"
        controls
        playsInline
        preload="none"
        poster={`/videos/${v.slug}.jpg`}
        aria-label={`${v.title} video, with captions`}
        onTimeUpdate={(e) => {
          const el = e.currentTarget
          if (el.duration && el.currentTime / el.duration > 0.8) onSeen(v.slug)
        }}
        onEnded={() => onSeen(v.slug)}
      >
        <source src={`/videos/${v.slug}.mp4`} type="video/mp4" />
      </video>
      <details>
        <summary>Read it instead</summary>
        {v.transcript.map((line, k) => (
          <p key={k}>{line}</p>
        ))}
      </details>
    </li>
  )
}
