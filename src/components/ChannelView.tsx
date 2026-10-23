import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { scrubImage } from '../lib/images.ts'
import { STAGEHAND_TITLE, chatName, formatStamp, pbDate } from '../lib/types.ts'
import { PollCard, PollComposer } from './Poll.tsx'
import GifPicker, { gifFallbackUrl, gifStillUrl, gifUrl, type GifChoice } from './GifPicker.tsx'
import type { MemberRecord, MessageRecord, ReactionRecord } from '../lib/types.ts'

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

// GIFs loop forever, so people whose device asks for reduced motion get the
// still frame and a button to play it.
function GifImage({ id, title }: { id: string; title: string }) {
  const reduce =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [playing, setPlaying] = useState(!reduce)
  const [src, setSrc] = useState(playing ? gifUrl(id) : gifStillUrl(id))
  const alt = `GIF: ${title || 'animated picture'}`
  return (
    <span className="msg-gif">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => {
          if (playing && src !== gifFallbackUrl(id)) setSrc(gifFallbackUrl(id))
        }}
      />
      {reduce && (
        <button
          type="button"
          className="link"
          aria-pressed={playing}
          onClick={() => {
            setPlaying(!playing)
            setSrc(playing ? gifStillUrl(id) : gifUrl(id))
          }}
        >
          {playing ? '⏸ Stop GIF' : '▶ Play GIF'}
        </button>
      )}
    </span>
  )
}

const PAGE = 50
const EXPAND = 'author,replyTo,replyTo.author'

function snippet(m: MessageRecord): string {
  if (m.text) return m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text
  if (m.gif) return 'GIF'
  if (m.image) return '📷 photo'
  return ''
}

function dayLabel(iso: string): string {
  const d = pbDate(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return formatStamp(iso)
}

export default function ChannelView({
  channelId,
  members = [],
  canModerate = false,
  canPoll = false,
}: {
  channelId: string
  members?: MemberRecord[]
  // Managers of the show (or the operator on the community board) can
  // remove anyone's message.
  canModerate?: boolean
  // Show channels (not the community board) can carry polls.
  canPoll?: boolean
}) {
  const { user } = useAuth()

  // Within a show, people are "First L. (Role)" — the character/position if
  // cast, the role label otherwise. Prefer a non-guardian row when someone
  // has several.
  function authorLabel(m: MessageRecord): string {
    const name = m.expand?.author?.name || '…'
    const rows = members.filter((x) => x.user === m.author)
    const row = rows.find((x) => x.role !== 'guardian') ?? rows[0] ?? null
    // The operator posting in a show they're not part of gets their admin
    // title, so a message from a stranger's name explains itself.
    if (!row && members.length > 0 && m.expand?.author?.operator) {
      return `${chatName(name)} (${STAGEHAND_TITLE})`
    }
    return chatName(name, row)
  }
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [hasEarlier, setHasEarlier] = useState(false)
  const [reactions, setReactions] = useState<ReactionRecord[]>([])
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [gif, setGif] = useState<GifChoice | null>(null)
  const [showGifs, setShowGifs] = useState(false)
  const [showPoll, setShowPoll] = useState(false)
  const [replyTo, setReplyTo] = useState<MessageRecord | null>(null)
  const [editing, setEditing] = useState<MessageRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const QUICK_EMOJI = ['👍', '❤️', '😂', '👏', '🎭', '😢', '🎉', '😮']

  async function loadReactions() {
    const list = await pb.collection('reactions').getFullList<ReactionRecord>({
      filter: pb.filter('message.channel = {:c}', { c: channelId }),
    })
    setReactions(list)
  }

  // Realtime records may arrive without expands; keep what we already had.
  function merge(prev: MessageRecord | undefined, next: MessageRecord): MessageRecord {
    if (!prev) return next
    return { ...next, expand: { ...prev.expand, ...next.expand } }
  }

  useEffect(() => {
    let cancelled = false
    setMessages([])
    setReplyTo(null)
    setEditing(null)
    setGif(null)
    setShowGifs(false)
    setShowPoll(false)

    pb.collection('messages')
      .getList<MessageRecord>(1, PAGE, {
        filter: pb.filter('channel = {:c}', { c: channelId }),
        sort: '-created',
        expand: EXPAND,
      })
      .then((res) => {
        if (cancelled) return
        setMessages(res.items.reverse())
        setHasEarlier(res.totalPages > 1)
      })
      .catch(() => {})

    loadReactions().catch(() => {})

    const unsubMessages = pb.collection('messages').subscribe<MessageRecord>(
      '*',
      (e) => {
        if (e.record.channel !== channelId) return
        if (e.action === 'create') {
          setMessages((prev) =>
            prev.some((m) => m.id === e.record.id) ? prev : [...prev, e.record],
          )
        }
        if (e.action === 'update') {
          setMessages((prev) => prev.map((m) => (m.id === e.record.id ? merge(m, e.record) : m)))
        }
        if (e.action === 'delete') {
          setMessages((prev) => prev.filter((m) => m.id !== e.record.id))
        }
      },
      { expand: EXPAND },
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

  // Follow the conversation when a new message lands at the bottom, but not
  // when older ones are loaded in above.
  const lastId = messages[messages.length - 1]?.id
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lastId])

  const [loadErr, setLoadErr] = useState('')

  async function loadEarlier() {
    const oldest = messages[0]
    if (!oldest) return
    try {
      const res = await pb.collection('messages').getList<MessageRecord>(1, PAGE, {
        filter: pb.filter('channel = {:c} && created < {:t}', { c: channelId, t: oldest.created }),
        sort: '-created',
        expand: EXPAND,
      })
      setMessages((prev) => [...res.items.reverse(), ...prev])
      setHasEarlier(res.totalPages > 1)
      setLoadErr('')
    } catch {
      setLoadErr("Couldn't load earlier messages — check your connection and try again.")
    }
  }

  const [sendErr, setSendErr] = useState('')

  function errText(err: unknown, fallback: string) {
    const data = (err as { response?: { message?: string; status?: number } })?.response
    return data?.status === 400 && data.message ? data.message : fallback
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (editing) return saveEdit(body)
    if (!body && !file && !gif) return
    setBusy(true)
    try {
      const created = await pb.collection('messages').create<MessageRecord>(
        {
          channel: channelId,
          author: user!.id,
          text: body,
          ...(file ? { image: await scrubImage(file) } : {}),
          ...(gif ? { gif: gif.id } : {}),
          ...(replyTo ? { replyTo: replyTo.id } : {}),
        },
        { expand: EXPAND },
      )
      setMessages((prev) =>
        prev.some((m) => m.id === created.id) ? prev : [...prev, created],
      )
      setText('')
      setFile(null)
      setGif(null)
      setReplyTo(null)
      setSendErr('')
    } catch (err) {
      setSendErr(
        errText(
          err,
          "That didn't send — check your connection and try again. Your message is still typed below.",
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(body: string) {
    if (!editing) return
    if (!body && !editing.image && !editing.gif) {
      setSendErr("A message can't be empty. To take it back, use Delete instead.")
      return
    }
    setBusy(true)
    try {
      const saved = await pb.collection('messages').update<MessageRecord>(editing.id, { text: body })
      setMessages((prev) => prev.map((m) => (m.id === saved.id ? merge(m, saved) : m)))
      setEditing(null)
      setText('')
      setSendErr('')
    } catch (err) {
      setSendErr(errText(err, "That didn't save — check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  function startReply(m: MessageRecord) {
    setPickerFor(null)
    setEditing(null)
    setReplyTo(m)
    inputRef.current?.focus()
  }

  function startEdit(m: MessageRecord) {
    setPickerFor(null)
    setReplyTo(null)
    setFile(null)
    setGif(null)
    setShowGifs(false)
    setEditing(m)
    setText(m.text)
    inputRef.current?.focus()
  }

  function cancelCompose() {
    if (editing) setText('')
    setEditing(null)
    setReplyTo(null)
  }

  async function remove(m: MessageRecord) {
    setPickerFor(null)
    const whose = m.author === user?.id ? 'your message' : `this message from ${authorLabel(m)}`
    if (!window.confirm(`Delete ${whose} for everyone? This can't be undone.`)) return
    try {
      await pb.collection('messages').delete(m.id)
      setMessages((prev) => prev.filter((x) => x.id !== m.id))
      setSendErr('')
    } catch {
      setSendErr("That message didn't delete — check your connection and try again.")
    }
  }

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('msg-flash')
    window.setTimeout(() => el.classList.remove('msg-flash'), 1600)
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

  const timeOf = (iso: string) =>
    pbDate(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="channel">
      <div className="messages" role="log" aria-live="polite" aria-label="Messages">
        {hasEarlier && (
          <button type="button" className="link load-earlier" onClick={loadEarlier}>
            Show earlier messages
          </button>
        )}
        {loadErr && (
          <p className="error" role="alert">
            {loadErr}
          </p>
        )}
        {messages.length === 0 && <p className="hint">No messages yet. Say hi!</p>}
        {messages.map((m, i) => {
          const mine = m.author === user?.id
          const original = m.expand?.replyTo
          const newDay =
            i === 0 || pbDate(messages[i - 1].created).toDateString() !== pbDate(m.created).toDateString()
          return (
            <div key={m.id} className="msg-wrap">
              {newDay && (
                <p className="msg-day" role="separator">
                  {dayLabel(m.created)}
                </p>
              )}
              <div id={`msg-${m.id}`} className={`msg ${mine ? 'mine' : ''}`}>
                <span className="msg-author">
                  {authorLabel(m)} · <time dateTime={pbDate(m.created).toISOString()}>{timeOf(m.created)}</time>
                  {m.edited && <span className="msg-edited"> · edited</span>}
                </span>
                <span className="msg-text">
                  {m.replyTo && (
                    <button
                      type="button"
                      className="msg-quote"
                      onClick={() => jumpTo(m.replyTo)}
                      aria-label={
                        original
                          ? `Replying to ${authorLabel(original)}: ${snippet(original)}. Show that message.`
                          : 'Replying to an earlier message. Show that message.'
                      }
                    >
                      <span aria-hidden="true">↩ </span>
                      {original ? (
                        <>
                          <strong>{authorLabel(original)}</strong> {snippet(original)}
                        </>
                      ) : (
                        'an earlier message'
                      )}
                    </button>
                  )}
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
                  {m.gif && <GifImage id={m.gif} title={m.gifTitle} />}
                  {m.poll ? (
                    <PollCard
                      message={m}
                      members={members}
                      canManage={canModerate}
                      onChange={(patch) =>
                        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch } : x)))
                      }
                    />
                  ) : (
                    <Linkified text={m.text} />
                  )}
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
                    aria-label="React, reply, and more"
                    aria-expanded={pickerFor === m.id}
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
                          aria-label={`React with ${emoji}`}
                          onClick={() => toggleReaction(m, emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                      <button type="button" className="reaction" onClick={() => startReply(m)}>
                        <span aria-hidden="true">↩</span> Reply
                      </button>
                      {mine && !m.poll && (
                        <button type="button" className="reaction" onClick={() => startEdit(m)}>
                          <span aria-hidden="true">✎</span> Edit
                        </button>
                      )}
                      {(mine || canModerate) && (
                        <button type="button" className="reaction" onClick={() => remove(m)}>
                          <span aria-hidden="true">🗑</span> Delete
                        </button>
                      )}
                      {!mine && (
                        <button
                          type="button"
                          className="reaction report-button"
                          onClick={() => report(m)}
                        >
                          <span aria-hidden="true">⚑</span> Report
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      {(replyTo || editing) && (
        <div className="row hint compose-context">
          {editing ? (
            <span>✎ Editing your message</span>
          ) : (
            <span>
              ↩ Replying to <strong>{authorLabel(replyTo!)}</strong>: {snippet(replyTo!)}
            </span>
          )}
          <button type="button" className="link" onClick={cancelCompose}>
            cancel
          </button>
        </div>
      )}
      {file && (
        <div className="row hint">
          📷 {file.name}
          <button type="button" className="link" onClick={() => setFile(null)}>
            remove
          </button>
        </div>
      )}
      {gif && (
        <div className="row hint">
          <img className="gif-pending" src={gif.preview} alt="" />
          GIF: {gif.title || 'ready to send'}
          <button type="button" className="link" onClick={() => setGif(null)}>
            remove
          </button>
        </div>
      )}
      {showGifs && !editing && (
        <GifPicker
          onPick={(g) => {
            setGif(g)
            setFile(null)
            setShowGifs(false)
            inputRef.current?.focus()
          }}
          onClose={() => setShowGifs(false)}
        />
      )}
      {showPoll && !editing && (
        <PollComposer
          channelId={channelId}
          onCancel={() => setShowPoll(false)}
          onCreated={(created) => {
            setMessages((prev) => (prev.some((x) => x.id === created.id) ? prev : [...prev, created]))
            setShowPoll(false)
            setSendErr('')
          }}
        />
      )}
      <form onSubmit={send} className="row composer">
        {!editing && (
          <>
            <label className="photo-btn" aria-label="Attach a photo">
              📷
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label="Attach a photo"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setGif(null)
                }}
              />
            </label>
            <button
              type="button"
              className="photo-btn gif-btn"
              aria-label="Add a GIF"
              aria-expanded={showGifs}
              onClick={() => setShowGifs(!showGifs)}
            >
              GIF
            </button>
            {canPoll && (
              <button
                type="button"
                className="photo-btn gif-btn"
                aria-label="Start a poll"
                aria-expanded={showPoll}
                onClick={() => {
                  setShowPoll(!showPoll)
                  setShowGifs(false)
                }}
              >
                <span aria-hidden="true">📊</span>
              </button>
            )}
          </>
        )}
        <input
          ref={inputRef}
          aria-label={editing ? 'Edit your message' : 'Message'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && (editing || replyTo)) cancelCompose()
          }}
          placeholder="Message…"
        />
        <button type="submit" disabled={busy || (!editing && !text.trim() && !file && !gif)}>
          {editing ? 'Save' : 'Send'}
        </button>
      </form>
      {sendErr && (
        <p className="error" role="alert">
          {sendErr}
        </p>
      )}
    </div>
  )
}
