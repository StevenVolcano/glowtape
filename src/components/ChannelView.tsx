import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import type { MessageRecord, ReactionRecord } from '../lib/types.ts'

// Note links render with the note's actual title; a tiny cache keeps a busy
// channel from refetching the same note per message.
const noteTitleCache = new Map<string, string>()

function NoteLink({ path }: { path: string }) {
  const id = path.split('/notes/')[1]?.split(/[/?#]/)[0] ?? ''
  const [title, setTitle] = useState(noteTitleCache.get(id) ?? '')

  useEffect(() => {
    if (!id || noteTitleCache.has(id)) return
    pb.collection('notes')
      .getOne<{ title: string }>(id)
      .then((n) => {
        noteTitleCache.set(id, n.title)
        setTitle(n.title)
      })
      .catch(() => {}) // not visible to this viewer; keep the generic label
  }, [id])

  return <Link to={path}>📝 {title || 'Open the note'}</Link>
}

// Make pasted URLs tappable. Links into Glow Tape itself (rehearsal notes,
// events) stay in the app; anything else opens in a new tab.
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return part
        try {
          const url = new URL(part)
          if (url.origin === window.location.origin) {
            if (url.pathname.includes('/notes/')) {
              return <NoteLink key={i} path={url.pathname} />
            }
            return (
              <Link key={i} to={url.pathname + url.search}>
                {part}
              </Link>
            )
          }
        } catch {
          /* not a real URL after all */
        }
        return (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        )
      })}
    </>
  )
}

export default function ChannelView({ channelId }: { channelId: string }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [reactions, setReactions] = useState<ReactionRecord[]>([])
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const QUICK_EMOJI = ['👍', '❤️', '😂', '👏', '🎭', '😢']

  async function loadReactions() {
    const list = await pb.collection('reactions').getFullList<ReactionRecord>({
      filter: pb.filter('message.channel = {:c}', { c: channelId }),
    })
    setReactions(list)
  }

  useEffect(() => {
    let cancelled = false

    pb.collection('messages')
      .getList<MessageRecord>(1, 100, {
        filter: pb.filter('channel = {:c}', { c: channelId }),
        sort: '-created',
        expand: 'author',
      })
      .then((res) => {
        if (!cancelled) setMessages(res.items.reverse())
      })
      .catch(() => {})

    loadReactions().catch(() => {})

    const unsubMessages = pb.collection('messages').subscribe<MessageRecord>(
      '*',
      (e) => {
        if (e.action === 'create' && e.record.channel === channelId) {
          setMessages((prev) => [...prev, e.record])
        }
      },
      { expand: 'author' },
    )
    const unsubReactions = pb.collection('reactions').subscribe<ReactionRecord>('*', (e) => {
      if (e.action === 'create') setReactions((prev) => [...prev.filter((r) => r.id !== e.record.id), e.record])
      if (e.action === 'delete') setReactions((prev) => prev.filter((r) => r.id !== e.record.id))
    })

    return () => {
      cancelled = true
      unsubMessages.then((fn) => fn()).catch(() => {})
      unsubReactions.then((fn) => fn()).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body && !file) return
    setBusy(true)
    try {
      await pb.collection('messages').create({
        channel: channelId,
        author: user!.id,
        text: body,
        ...(file ? { image: file } : {}),
      })
      setText('')
      setFile(null)
    } finally {
      setBusy(false)
    }
  }

  async function toggleReaction(message: MessageRecord, emoji: string) {
    setPickerFor(null)
    const mine = reactions.find(
      (r) => r.message === message.id && r.user === user?.id && r.emoji === emoji,
    )
    if (mine) {
      await pb.collection('reactions').delete(mine.id)
    } else {
      await pb.collection('reactions').create({ message: message.id, user: user!.id, emoji })
    }
    await loadReactions()
  }

  async function report(message: MessageRecord) {
    setPickerFor(null)
    const reason = window.prompt(
      'Report this message to the Glow Tape operator?\nTell us what concerns you (optional):',
    )
    if (reason === null) return
    await pb.send('/api/glowtape/messages/report', {
      method: 'POST',
      body: { message: message.id, reason },
    })
    window.alert('Reported — a human will take a look. Thank you.')
  }

  function reactionSummary(message: MessageRecord) {
    const rows = reactions.filter((r) => r.message === message.id)
    const byEmoji = new Map<string, ReactionRecord[]>()
    for (const r of rows) {
      byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r])
    }
    return [...byEmoji.entries()]
  }

  const imageUrl = (m: MessageRecord, thumb?: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pb.files.getURL(m as any, m.image, thumb ? { thumb } : undefined)

  return (
    <div className="channel">
      <div className="messages" role="log" aria-live="polite" aria-label="Messages">
        {messages.length === 0 && <p className="hint">No messages yet. Say hi!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.author === user?.id ? 'mine' : ''}`}>
            <span className="msg-author">{m.expand?.author?.name || '…'}</span>
            <span className="msg-text">
              {m.image && (
                <a href={imageUrl(m)} target="_blank" rel="noreferrer">
                  <img
                    className="msg-img"
                    src={imageUrl(m, '400x0')}
                    alt={`Photo from ${m.expand?.author?.name || 'a member'}`}
                    loading="lazy"
                  />
                </a>
              )}
              <Linkified text={m.text} />
            </span>
            <span className="reactions">
              {reactionSummary(m).map(([emoji, rows]) => (
                <button
                  type="button"
                  key={emoji}
                  className={`reaction ${rows.some((r) => r.user === user?.id) ? 'mine' : ''}`}
                  onClick={() => toggleReaction(m, emoji)}
                >
                  {emoji} {rows.length}
                </button>
              ))}
              <button
                type="button"
                className="reaction reaction-add"
                aria-label="Add reaction"
                onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
              >
                +
              </button>
              {pickerFor === m.id && (
                <>
                  {QUICK_EMOJI.map((emoji) => (
                    <button
                      type="button"
                      key={emoji}
                      className="reaction"
                      onClick={() => toggleReaction(m, emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                  {m.author !== user?.id && (
                    <button
                      type="button"
                      className="reaction"
                      aria-label="Report this message"
                      onClick={() => report(m)}
                    >
                      ⚑
                    </button>
                  )}
                </>
              )}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {file && (
        <div className="row hint">
          📷 {file.name}
          <button type="button" className="link" onClick={() => setFile(null)}>
            remove
          </button>
        </div>
      )}
      <form onSubmit={send} className="row">
        <label className="photo-btn" aria-label="Attach a photo">
          📷
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <input
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
        />
        <button type="submit" disabled={busy || (!text.trim() && !file)}>
          Send
        </button>
      </form>
    </div>
  )
}
