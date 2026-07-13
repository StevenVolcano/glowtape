import { useEffect, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import ChannelView from '../components/ChannelView.tsx'
import { useProduction } from './Production.tsx'
import type {
  AnnouncementAckRecord,
  AnnouncementRecord,
  ChannelPrefRecord,
  ChannelRecord,
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
          if (c.member) return true // semi-private: the server already gated who sees it
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
  const noPhotoMembers = useProduction().members.filter((m) => m.noPhotos)

  return (
    <div>
      <Announcements />
      <section>
        <h2>Channels</h2>
        {noPhotoMembers.length > 0 && (
          <p className="hint">
            📷 Heads up: this production includes {noPhotoMembers.length}{' '}
            {noPhotoMembers.length === 1 ? 'person' : 'people'} without photo consent — please
            check faces before posting pictures.
          </p>
        )}
        <div className="chips">
          {channels.map((c) => (
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
        🔒 Message the production team privately
      </button>
      <span className="hint">
        {' '}
        — a channel just between you (and your guardians) and the whole production team.
      </span>
    </p>
  )
}
