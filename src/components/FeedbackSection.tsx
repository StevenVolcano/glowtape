import { useEffect, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import type { FeedbackRecord } from '../lib/types.ts'

const KIND_LABELS = {
  idea: '💡 An idea',
  problem: '🐞 Something broken',
  question: '❓ A question',
  praise: '🎉 Something nice',
} as const

export const STATUS_LABELS: Record<string, string> = {
  '': 'received',
  new: 'received',
  planned: 'planned',
  done: 'done ✓',
  declined: 'not planned',
}

// Anyone can send feedback; it lands in the operator console (and one email).
// Your own submissions show below with whatever status the operator set.
export default function FeedbackSection() {
  const { user } = useAuth()
  const [kind, setKind] = useState<FeedbackRecord['kind']>('idea')
  const [message, setMessage] = useState('')
  const [mine, setMine] = useState<FeedbackRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [open, setOpen] = useState(false)

  async function load() {
    const list = await pb.collection('feedback').getFullList<FeedbackRecord>({
      filter: pb.filter('user = {:u}', { u: user?.id }),
      sort: '-created',
    })
    setMine(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setDone('')
    try {
      await pb.collection('feedback').create({
        user: user?.id,
        kind,
        message: message.trim(),
        page: window.location.pathname,
        status: 'new',
      })
      setMessage('')
      setDone('Sent — thank you! A human reads every one.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Ideas &amp; feedback</h2>
      {!open && (
        <p className="hint">
          <button className="link" aria-expanded={false} onClick={() => setOpen(true)}>
            💬 Send an idea, problem, or question
          </button>{' '}
          — a human reads every one
          {mine.length > 0 && <>, and yours are tracked here ({mine.length})</>}.
        </p>
      )}
      {open && (
      <form onSubmit={send} className="stack">
        <div className="row">
          <select
            aria-label="What kind of feedback"
            value={kind}
            onChange={(e) => setKind(e.target.value as FeedbackRecord['kind'])}
          >
            {(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <textarea
          aria-label="Your feedback"
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What would make Glow Tape better for your productions?"
        />
        <button type="submit" disabled={busy || !message.trim()}>
          Send feedback
        </button>
        {done && <p className="acked" role="status">{done}</p>}
      </form>
      )}

      {open && mine.length > 0 && (
        <ul className="plain-list">
          {mine.map((f) => (
            <li key={f.id} className="hint">
              {KIND_LABELS[f.kind]?.slice(0, 2)} “{f.message.slice(0, 80)}
              {f.message.length > 80 ? '…' : ''}” — <em>{STATUS_LABELS[f.status] ?? f.status}</em>
              {f.reply && <> · {f.reply}</>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
