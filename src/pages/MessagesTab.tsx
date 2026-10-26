import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import ChannelView from '../components/ChannelView.tsx'
import { useProduction } from './Production.tsx'
import { chatName, firstLastInitial, memberName, pbDate } from '../lib/types.ts'
import type {
  AnnouncementAckRecord,
  AnnouncementRecord,
  ChannelPrefRecord,
  ChannelRecord,
  DmBlockRecord,
  MemberRecord,
  MessageRecord,
} from '../lib/types.ts'
import Section from '../components/Section.tsx'

const isDm = (c: ChannelRecord) => (c.dmUsers?.length ?? 0) > 0

// Messages is laid out like a phone's messaging app: a list of
// conversations (newest activity first, unread in bold), and tapping one
// opens it full width with a back link. Which one is open lives in the URL
// (?channel=), so notifications land on it and the phone's back button
// returns to the list. "Read" is remembered per device (localStorage) —
// good enough for a bold dot, no server bookkeeping.

type Preview = { text: string; who: string; author: string; created: string }

const readKey = (id: string) => `gt-read-${id}`
function lastRead(id: string): string {
  try {
    return localStorage.getItem(readKey(id)) ?? ''
  } catch {
    return ''
  }
}
function markRead(id: string) {
  try {
    localStorage.setItem(readKey(id), new Date().toISOString())
  } catch {
    // private window — everything just stays "read" on open
  }
}

function previewText(m: MessageRecord): string {
  if (m.poll) return m.text
  if (m.text) return m.text
  if (m.gif) return 'GIF'
  if (m.image) return '📷 photo'
  return ''
}

function whenShort(iso: string): string {
  const d = pbDate(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function MessagesTab() {
  const { production, members, myMember, isManager, archived } = useProduction()
  const { user } = useAuth()
  const me = user!.id
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [prefs, setPrefs] = useState<ChannelPrefRecord[]>([])
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const [adult, setAdult] = useState(false)
  const [blocks, setBlocks] = useState<DmBlockRecord[]>([])
  const [, setTick] = useState(0) // re-render after marking read
  const [params, setParams] = useSearchParams()
  const active = params.get('channel')

  function open(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('channel', id)
    else next.delete('channel')
    setParams(next)
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    pb.collection('channels')
      .getFullList<ChannelRecord>({
        filter: pb.filter('production = {:p} && archived != true', { p: production.id }),
        sort: 'created',
      })
      .then(async (list) => {
        // The server enforces who sees what (team = managers, 🔒 = group
        // members + guardians + managers, 💬 = the two adults) — whatever
        // comes back is visible.
        setChannels(list)
        const latest = await Promise.all(
          list.map((c) =>
            pb
              .collection('messages')
              .getList<MessageRecord>(1, 1, {
                filter: pb.filter('channel = {:c}', { c: c.id }),
                sort: '-created',
                expand: 'author',
              })
              .then((r) => [c.id, r.items[0]] as const)
              .catch(() => [c.id, undefined] as const),
          ),
        )
        const next: Record<string, Preview> = {}
        for (const [id, m] of latest) {
          if (m) next[id] = { text: previewText(m), who: m.expand?.author?.name ?? '', author: m.author, created: m.created }
        }
        setPreviews(next)
      })
      .catch(() => {})

    pb.collection('channel_prefs')
      .getFullList<ChannelPrefRecord>({ filter: pb.filter('user = {:u}', { u: me }) })
      .then(setPrefs)
      .catch(() => {})
    pb.send<{ ageBand: string }>('/api/glowtape/me', { method: 'GET' })
      .then((r) => setAdult(r.ageBand === 'adult'))
      .catch(() => {})
    pb.collection('dm_blocks')
      .getFullList<DmBlockRecord>()
      .then(setBlocks)
      .catch(() => {})
  }, [production.id, me])

  // Keep the list's previews live.
  useEffect(() => {
    const unsub = pb.collection('messages').subscribe<MessageRecord>(
      '*',
      (e) => {
        if (e.action !== 'create') return
        setPreviews((prev) =>
          prev[e.record.channel] || channels.some((c) => c.id === e.record.channel)
            ? {
                ...prev,
                [e.record.channel]: {
                  text: previewText(e.record),
                  who: e.record.expand?.author?.name ?? '',
                  author: e.record.author,
                  created: e.record.created,
                },
              }
            : prev,
        )
      },
      { expand: 'author' },
    )
    return () => {
      unsub.then((fn) => fn()).catch(() => {})
    }
  }, [channels])

  // Opening a conversation reads it; so does leaving it (messages that
  // arrived while it was open were seen).
  useEffect(() => {
    if (!active) return
    markRead(active)
    return () => {
      markRead(active)
      setTick((t) => t + 1)
    }
  }, [active])

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
        user: me,
        muted: !c.defaultMuted,
      })
    }
    const fresh = await pb
      .collection('channel_prefs')
      .getFullList<ChannelPrefRecord>({ filter: pb.filter('user = {:u}', { u: me }) })
    setPrefs(fresh)
  }

  function added(ch: ChannelRecord) {
    setChannels((prev) => (prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]))
    open(ch.id)
  }

  const nameOf = (c: ChannelRecord) => (isDm(c) ? `💬 ${otherPerson(c, me, members).name}` : c.name)
  const unread = (c: ChannelRecord) => {
    const p = previews[c.id]
    return !!p && p.author !== me && p.created.replace(' ', 'T') > lastRead(c.id)
  }
  const byActivity = (a: ChannelRecord, b: ChannelRecord) =>
    (previews[b.id]?.created ?? '').localeCompare(previews[a.id]?.created ?? '')

  const activeChannel = channels.find((c) => c.id === active) ?? null
  const showChannels = channels.filter((c) => !isDm(c) && !c.member)
  const privateChats = channels.filter((c) => isDm(c) || c.member).sort(byActivity)

  if (activeChannel) {
    return (
      <Conversation
        channel={activeChannel}
        name={nameOf(activeChannel)}
        muted={isMuted(activeChannel)}
        onToggleMute={() => toggleMute(activeChannel)}
        onBack={() => open(null)}
        blocks={blocks}
        setBlocks={setBlocks}
      />
    )
  }

  const row = (c: ChannelRecord) => {
    const p = previews[c.id]
    const isNew = unread(c)
    return (
      <li key={c.id}>
        <button
          type="button"
          className={`inbox-row ${isNew ? 'inbox-unread' : ''}`}
          onClick={() => open(c.id)}
          aria-label={`${nameOf(c)}${isNew ? ', new messages' : ''}${isMuted(c) ? ', muted' : ''}`}
        >
          <span className="inbox-top">
            <span className="inbox-name">
              {isNew && <span className="inbox-dot" aria-hidden="true" />}
              {nameOf(c)}
              {isMuted(c) && <span aria-hidden="true"> 🔕</span>}
            </span>
            {p && <span className="inbox-when">{whenShort(p.created)}</span>}
          </span>
          <span className="inbox-preview">
            {p ? `${p.author === me ? 'You' : firstLastInitial(p.who || '…')}: ${p.text}` : 'No messages yet'}
          </span>
        </button>
      </li>
    )
  }

  return (
    <div>
      <Announcements />
      <h2>Conversations</h2>
      <ul className="inbox" aria-label="Show chat">
        {showChannels.map(row)}
      </ul>
      {(privateChats.length > 0 || !isManager || adult) && (
        <>
          <h3 className="inbox-heading">Private</h3>
          {privateChats.length > 0 && (
            <ul className="inbox" aria-label="Private conversations">
              {privateChats.map(row)}
            </ul>
          )}
          {!isManager && myMember && <TeamChannelButton channels={channels} onOpened={added} />}
          {adult && !archived && <StartDm dms={channels.filter(isDm)} onOpened={added} />}
        </>
      )}
    </div>
  )
}

// One open conversation, full width, with a way back to the list.
function Conversation({
  channel,
  name,
  muted,
  onToggleMute,
  onBack,
  blocks,
  setBlocks,
}: {
  channel: ChannelRecord
  name: string
  muted: boolean
  onToggleMute: () => void
  onBack: () => void
  blocks: DmBlockRecord[]
  setBlocks: (fn: (prev: DmBlockRecord[]) => DmBlockRecord[]) => void
}) {
  const { members, isManager } = useProduction()
  const { user } = useAuth()
  const [err, setErr] = useState('')
  const dm = isDm(channel)
  const other = dm ? otherPerson(channel, user!.id, members) : null
  const myBlock = other ? blocks.find((b) => b.blocked === other.id) : undefined
  const noPhotoMembers = members.filter((m) => m.noPhotos)

  async function block() {
    if (!other) return
    if (!confirm(`Block ${other.name}? Neither of you will be able to send direct messages to the other until you unblock them. They aren't told.`)) return
    setErr('')
    try {
      const b = await pb.collection('dm_blocks').create<DmBlockRecord>({ user: user!.id, blocked: other.id })
      setBlocks((prev) => [...prev, b])
    } catch {
      setErr("Couldn't block them just now. Try again in a minute.")
    }
  }

  async function unblock() {
    if (!myBlock) return
    setErr('')
    try {
      await pb.collection('dm_blocks').delete(myBlock.id)
      setBlocks((prev) => prev.filter((b) => b.id !== myBlock.id))
    } catch {
      setErr("Couldn't unblock them just now. Try again in a minute.")
    }
  }

  return (
    <div className="conversation">
      <button type="button" className="link" onClick={onBack}>
        ← All conversations
      </button>
      <h2 className="conversation-title">{name}</h2>
      <div className="row conversation-tools">
        <button type="button" className="link" aria-pressed={muted} onClick={onToggleMute}>
          {muted ? '🔕 Muted — turn notifications on' : '🔔 Mute'}
        </button>
        {other &&
          (myBlock ? (
            <button type="button" className="link" onClick={unblock}>
              🚫 Unblock {other.name}
            </button>
          ) : (
            <button type="button" className="link" onClick={block}>
              🚫 Block
            </button>
          ))}
      </div>
      {dm ? (
        <p className="hint" style={{ margin: 0 }}>
          Private between the two of you — managers can't read it. If something's wrong, ⚑ report the
          message; reports go to Glow Tape's operator.
        </p>
      ) : (
        noPhotoMembers.length > 0 && (
          <p className="hint" style={{ margin: 0 }}>
            📷 {noPhotoMembers.length} {noPhotoMembers.length === 1 ? 'person' : 'people'} in this show
            didn't give photo consent — check faces before posting pictures.
          </p>
        )
      )}
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      {dm ? (
        <ChannelView channelId={channel.id} members={members} />
      ) : (
        <ChannelView channelId={channel.id} members={members} canModerate={isManager} canPoll />
      )}
    </div>
  )
}

// The person on the other end of a DM, as shown in this show.
function otherPerson(c: ChannelRecord, me: string, members: MemberRecord[]) {
  const other = (c.dmUsers ?? []).find((u) => u !== me) ?? ''
  const rows = members.filter((m) => m.user === other)
  const m = rows.find((r) => r.role !== 'guardian') ?? rows[0] ?? null
  return { id: other, name: m ? chatName(memberName(m), m) : 'Someone no longer in the show' }
}

// Start (or reopen) a direct message: private between two adults who share
// this show. The server decides who may use them (both accounts 18+) — the
// form only shows for adults.
function StartDm({ dms, onOpened }: { dms: ChannelRecord[]; onOpened: (ch: ChannelRecord) => void }) {
  const { production, members } = useProduction()
  const { user } = useAuth()
  const me = user!.id
  const [showForm, setShowForm] = useState(false)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // One choice per person: their own row wins over a parent row.
  const seen = new Set<string>([me])
  const people: MemberRecord[] = []
  for (const m of [...members].sort((a, b) => (a.role === 'guardian' ? 1 : 0) - (b.role === 'guardian' ? 1 : 0))) {
    if (!m.user || seen.has(m.user)) continue
    seen.add(m.user)
    people.push(m)
  }
  people.sort((a, b) => memberName(a).localeCompare(memberName(b)))

  async function start(e: FormEvent) {
    e.preventDefault()
    if (!pick) return
    setBusy(true)
    setErr('')
    try {
      const res = await pb.send<{ channel: string }>('/api/glowtape/dm/start', {
        method: 'POST',
        body: { production: production.id, member: pick },
      })
      const ch = dms.find((c) => c.id === res.channel) ?? (await pb.collection('channels').getOne<ChannelRecord>(res.channel))
      onOpened(ch)
      setPick('')
    } catch (ex) {
      setErr((ex as { message?: string }).message || "Couldn't start that conversation.")
    } finally {
      setBusy(false)
    }
  }

  if (!showForm) {
    return (
      <p>
        <button type="button" className="link" aria-expanded={false} onClick={() => setShowForm(true)}>
          💬 Message someone privately
        </button>
        <span className="hint"> — just between two adults (18+) in this show.</span>
      </p>
    )
  }

  return (
    <form className="stack" onSubmit={start}>
      <label>
        Message someone privately
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Pick a person…</option>
          {people.map((m) => (
            <option key={m.id} value={m.id}>
              {chatName(memberName(m), m)}
            </option>
          ))}
        </select>
      </label>
      <p className="hint" style={{ margin: 0 }}>
        💬 Private between two adults (18 or older) in this show. Managers can't read it.
      </p>
      <div className="row">
        <button type="submit" disabled={!pick || busy}>
          💬 Start
        </button>
        <button type="button" className="link" onClick={() => setShowForm(false)}>
          cancel
        </button>
      </div>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </form>
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
    <Section id="announcements" title="Announcements">
      <ul className="cards">
        {items.map((a) => {
          const mine = acks.some((k) => k.announcement === a.id && k.user === user?.id)
          const count = acks.filter((k) => k.announcement === a.id).length
          return (
            <li key={a.id} className="card announcement">
              {a.pinned && <span className="pill">Pinned</span>}{a.pinned && ' '}
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
    </Section>
  )
}

// Find-or-create the semi-private channel between this member and the
// production team. Managers don't need it — they're already the team.
function TeamChannelButton({
  channels,
  onOpened,
}: {
  channels: ChannelRecord[]
  onOpened: (ch: ChannelRecord) => void
}) {
  const { production } = useProduction()
  const [busy, setBusy] = useState(false)

  const existing = channels.find((c) => c.member)

  async function open() {
    setBusy(true)
    try {
      const res = await pb.send('/api/glowtape/team-channel', {
        method: 'POST',
        body: { production: production.id },
      })
      const ch =
        channels.find((c) => c.id === res.channel) ??
        (await pb.collection('channels').getOne<ChannelRecord>(res.channel))
      onOpened(ch)
    } finally {
      setBusy(false)
    }
  }

  if (existing) return null // it's already in the Private list

  return (
    <p>
      <button className="link" onClick={open} disabled={busy}>
        🔒 Message the managers privately
      </button>
      <span className="hint">
        {' '}
        — a channel just between you (and your guardians) and all the show's managers.
      </span>
    </p>
  )
}
