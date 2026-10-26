import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import ChannelView from '../components/ChannelView.tsx'
import { useProduction } from './Production.tsx'
import { chatName, memberName } from '../lib/types.ts'
import type {
  AnnouncementAckRecord,
  AnnouncementRecord,
  ChannelPrefRecord,
  ChannelRecord,
  DmBlockRecord,
  MemberRecord,
} from '../lib/types.ts'
import Section, { openSection } from '../components/Section.tsx'

const isDm = (c: ChannelRecord) => (c.dmUsers?.length ?? 0) > 0

export default function MessagesTab() {
  const { production, members, myMember, isManager } = useProduction()
  const { user } = useAuth()
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [prefs, setPrefs] = useState<ChannelPrefRecord[]>([])
  const [active, setActive] = useState<string | null>(null)
  // ?channel=<id> (from a message notification) opens that channel.
  const [params] = useSearchParams()
  const wanted = params.get('channel')

  useEffect(() => {
    pb.collection('channels')
      .getFullList<ChannelRecord>({
        filter: pb.filter('production = {:p} && archived != true', { p: production.id }),
        sort: 'created',
      })
      .then((list) => {
        // The server enforces who sees what (team = managers, 🔒 = group
        // members + guardians + managers) — whatever comes back is visible.
        setChannels(list)
        const pick = wanted && list.some((c) => c.id === wanted) ? wanted : null
        // Sections start folded; a link to a channel should land on it open.
        if (pick) openSection(list.find((c) => c.id === pick && isDm(c)) ? 'direct-messages' : 'channels')
        setActive((prev) => pick ?? prev ?? list.find((c) => !isDm(c))?.id ?? null)
      })
      .catch(() => {})

    pb.collection('channel_prefs')
      .getFullList<ChannelPrefRecord>({ filter: pb.filter('user = {:u}', { u: user!.id }) })
      .then(setPrefs)
      .catch(() => {})
  }, [production.id, user, wanted])

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
  const noPhotoMembers = members.filter((m) => m.noPhotos)
  const showChannels = channels.filter((c) => !isDm(c))
  const dms = channels.filter(isDm)
  const activeIsDm = !!activeChannel && isDm(activeChannel)

  const muteButton = activeChannel && (
    <button className="link" onClick={() => toggleMute(activeChannel)}>
      {isMuted(activeChannel)
        ? '🔕 This conversation is muted — tap to turn notifications on'
        : '🔔 Notifications on — tap to mute this conversation'}
    </button>
  )

  return (
    <div>
      <Announcements />
      <Section id="channels" title="Channels">
        {noPhotoMembers.length > 0 && (
          <p className="hint">
            📷 Heads up: this production includes {noPhotoMembers.length}{' '}
            {noPhotoMembers.length === 1 ? 'person' : 'people'} without photo consent — please
            check faces before posting pictures.
          </p>
        )}
        <div className="chips">
          {showChannels.map((c) => (
            <button
              key={c.id}
              aria-pressed={active === c.id}
              className={`chip ${active === c.id ? 'chip-active' : ''}`}
              onClick={() => setActive(c.id)}
            >
              {c.name}
              {isMuted(c) ? ' 🔕' : ''}
            </button>
          ))}
        </div>
        {!isManager && myMember && (
          <TeamChannelButton
            channels={channels}
            onOpened={(ch) => {
              setChannels((prev) => (prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]))
              setActive(ch.id)
            }}
          />
        )}
        {activeChannel && !activeIsDm && muteButton}
        {activeChannel && !activeIsDm && (
          <ChannelView channelId={activeChannel.id} members={members} canModerate={isManager} canPoll />
        )}
        {activeIsDm && <p className="hint">You're in a direct message — it's open below.</p>}
      </Section>
      <DirectMessages
        dms={dms}
        active={active}
        onPick={(id) => setActive(id)}
        onOpened={(ch) => {
          setChannels((prev) => (prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]))
          setActive(ch.id)
        }}
        muteButton={activeIsDm ? muteButton : null}
        isMuted={isMuted}
      />
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

// Direct messages: private between two adults who share this show. The
// server decides who may use them (both accounts 18+) — teens never get DM
// channels back from the API, and the section stays hidden for them.
function DirectMessages({
  dms,
  active,
  onPick,
  onOpened,
  muteButton,
  isMuted,
}: {
  dms: ChannelRecord[]
  active: string | null
  onPick: (id: string) => void
  onOpened: (ch: ChannelRecord) => void
  muteButton: ReactNode
  isMuted: (c: ChannelRecord) => boolean
}) {
  const { production, members, archived } = useProduction()
  const { user } = useAuth()
  const [adult, setAdult] = useState(false)
  const [blocks, setBlocks] = useState<DmBlockRecord[]>([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    pb.send<{ ageBand: string }>('/api/glowtape/me', { method: 'GET' })
      .then((r) => setAdult(r.ageBand === 'adult'))
      .catch(() => {})
    pb.collection('dm_blocks')
      .getFullList<DmBlockRecord>()
      .then(setBlocks)
      .catch(() => {})
  }, [user?.id])

  if (!adult && dms.length === 0) return null

  const me = user!.id
  const activeDm = dms.find((c) => c.id === active) ?? null
  const activeOther = activeDm ? otherPerson(activeDm, me, members) : null
  const myBlock = activeOther ? blocks.find((b) => b.blocked === activeOther.id) : undefined

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

  async function block() {
    if (!activeOther) return
    if (!confirm(`Block ${activeOther.name}? Neither of you will be able to send direct messages to the other until you unblock them. They aren't told.`)) return
    setErr('')
    try {
      const b = await pb.collection('dm_blocks').create<DmBlockRecord>({ user: me, blocked: activeOther.id })
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
    <Section id="direct-messages" title="Direct messages">
      <p className="hint">
        💬 Private conversations between two adults (18 or older) in this show. Managers can't read them.
        If something's wrong, ⚑ report the message — reports go to Glow Tape's operator.
      </p>
      {dms.length > 0 && (
        <div className="chips">
          {dms.map((c) => (
            <button
              key={c.id}
              aria-pressed={active === c.id}
              className={`chip ${active === c.id ? 'chip-active' : ''}`}
              onClick={() => onPick(c.id)}
            >
              {otherPerson(c, me, members).name}
              {isMuted(c) ? ' 🔕' : ''}
            </button>
          ))}
        </div>
      )}
      {adult && !archived && (
        <form className="row" onSubmit={start}>
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
          <button type="submit" disabled={!pick || busy}>
            💬 Start
          </button>
        </form>
      )}
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      {activeDm && activeOther && (
        <>
          <h3>💬 {activeOther.name}</h3>
          {muteButton}{' '}
          {myBlock ? (
            <button className="link" onClick={unblock}>
              🚫 You blocked {activeOther.name} — tap to unblock
            </button>
          ) : (
            <button className="link" onClick={block}>
              🚫 Block {activeOther.name}
            </button>
          )}
          <ChannelView channelId={activeDm.id} members={members} />
        </>
      )}
    </Section>
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

  if (existing) return null // it's already in the chip row

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
