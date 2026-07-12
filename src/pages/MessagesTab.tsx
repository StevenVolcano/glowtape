import { useEffect, useRef, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import type {
  AnnouncementAckRecord,
  AnnouncementRecord,
  ChannelPrefRecord,
  ChannelRecord,
  MessageRecord,
  ReactionRecord,
} from '../lib/types.ts'

export default function MessagesTab() {
  const { production, myMember, isManager } = useProduction()
  const { user } = useAuth()
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [prefs, setPrefs] = useState<ChannelPrefRecord[]>([])
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    pb.collection('channels')
      .getFullList<ChannelRecord>({
        filter: pb.filter('production = {:p} && archived != true', { p: production.id }),
        sort: 'created',
      })
      .then((list) => {
        // Audience filtering is a UI courtesy in the pilot; managers see all.
        const role = myMember?.role
        const visible = list.filter((c) => {
          if (isManager || !role) return true
          if (c.audience === 'all') return true
          if (c.audience === 'cast') return role === 'performer'
          if (c.audience === 'crew') return role === 'crew'
          return false // team
        })
        setChannels(visible)
        setActive((prev) => prev ?? visible[0]?.id ?? null)
      })
      .catch(() => {})

    pb.collection('channel_prefs')
      .getFullList<ChannelPrefRecord>({ filter: pb.filter('user = {:u}', { u: user!.id }) })
      .then(setPrefs)
      .catch(() => {})
  }, [production.id, myMember?.role, isManager, user])

  const prefFor = (channelId: string) => prefs.find((p) => p.channel === channelId)
  const isMuted = (c: ChannelRecord) => {
    const pref = prefFor(c.id)
    return pref ? pref.muted : c.defaultMuted
  }

  async function toggleMute(c: ChannelRecord) {
    const pref = prefFor(c.id)
    if (pref) {
      await pb.collection('channel_prefs').update(pref.id, { muted: !pref.muted })
    } else {
      await pb.collection('channel_prefs').create({
        channel: c.id,
        user: user!.id,
        muted: !c.defaultMuted,
      })
    }
    const fresh = await pb
      .collection('channel_prefs')
      .getFullList<ChannelPrefRecord>({ filter: pb.filter('user = {:u}', { u: user!.id }) })
    setPrefs(fresh)
  }

  const activeChannel = channels.find((c) => c.id === active) ?? null

  return (
    <div>
      <Announcements />
      <section>
        <h2>Channels</h2>
        <div className="chips" role="tablist">
          {channels.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={active === c.id}
              className={`chip ${active === c.id ? 'chip-active' : ''}`}
              onClick={() => setActive(c.id)}
            >
              {c.name}
              {isMuted(c) ? ' 🔕' : ''}
            </button>
          ))}
        </div>
        {activeChannel && (
          <button className="link" onClick={() => toggleMute(activeChannel)}>
            {isMuted(activeChannel)
              ? '🔕 This channel is muted — tap to turn notifications on'
              : '🔔 Notifications on — tap to mute this channel'}
          </button>
        )}
        {active && <ChannelView channelId={active} />}
      </section>
    </div>
  )
}

function ChannelView({ channelId }: { channelId: string }) {
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
      <div className="messages">
        {messages.length === 0 && <p className="hint">No messages yet. Say hi!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.author === user?.id ? 'mine' : ''}`}>
            <span className="msg-author">{m.expand?.author?.name || '…'}</span>
            <span className="msg-text">
              {m.image && (
                <a href={imageUrl(m)} target="_blank" rel="noreferrer">
                  <img className="msg-img" src={imageUrl(m, '400x0')} alt="" loading="lazy" />
                </a>
              )}
              {m.text}
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
              {pickerFor === m.id &&
                QUICK_EMOJI.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    className="reaction"
                    onClick={() => toggleReaction(m, emoji)}
                  >
                    {emoji}
                  </button>
                ))}
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

function Announcements() {
  const { production, isManager } = useProduction()
  const { user } = useAuth()
  const [items, setItems] = useState<AnnouncementRecord[]>([])
  const [acks, setAcks] = useState<AnnouncementAckRecord[]>([])

  async function load() {
    const [a, ak] = await Promise.all([
      pb.collection('announcements').getFullList<AnnouncementRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: '-pinned,-created',
        expand: 'author',
      }),
      pb.collection('announcement_acks').getFullList<AnnouncementAckRecord>({
        filter: pb.filter('announcement.production = {:p}', { p: production.id }),
      }),
    ])
    setItems(a)
    setAcks(ak)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  async function ack(a: AnnouncementRecord) {
    await pb.collection('announcement_acks').create({ announcement: a.id, user: user!.id })
    await load()
  }

  if (items.length === 0) return null

  return (
    <section>
      <h2>Announcements</h2>
      <ul className="cards">
        {items.map((a) => {
          const mine = acks.some((k) => k.announcement === a.id && k.user === user?.id)
          const count = acks.filter((k) => k.announcement === a.id).length
          return (
            <li key={a.id} className="card announcement">
              {a.pinned && <span className="pill">Pinned</span>}
              <strong>{a.title}</strong>
              {a.body && <p>{a.body}</p>}
              <div className="hint">— {a.expand?.author?.name}</div>
              {mine ? (
                <div className="acked">✓ Acknowledged</div>
              ) : (
                <button onClick={() => ack(a)}>Got it 👍</button>
              )}
              {isManager && (
                <div className="hint">
                  {count} {count === 1 ? 'person has' : 'people have'} acknowledged
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
