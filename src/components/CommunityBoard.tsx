import { useEffect, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import ChannelView from './ChannelView.tsx'
import type { ChannelPrefRecord, ChannelRecord } from '../lib/types.ts'

// The all-of-Grays-Harbor space: channels that belong to no production,
// readable and postable by every signed-in user.
export default function CommunityBoard() {
  const { user } = useAuth()
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [prefs, setPrefs] = useState<ChannelPrefRecord[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    pb.collection('channels')
      .getFullList<ChannelRecord>({
        filter: "production = '' && archived != true",
        sort: 'created',
      })
      .then((list) => {
        setChannels(list)
        setActive((prev) => prev ?? list[0]?.id ?? null)
      })
      .catch(() => {})
    pb.collection('channel_prefs')
      .getFullList<ChannelPrefRecord>({ filter: pb.filter('user = {:u}', { u: user!.id }) })
      .then(setPrefs)
      .catch(() => {})
  }, [user])

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

  if (channels.length === 0) return null

  const activeChannel = channels.find((c) => c.id === active) ?? null

  return (
    <section>
      <div className="row space-between">
        <h2>Grays Harbor theater community</h2>
        <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Open'}
        </button>
      </div>
      {!open && (
        <p className="hint">
          Chat for everyone in local theater — auditions, borrowing props, general talk.
        </p>
      )}
      {open && (
        <>
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
          {activeChannel && (
            <button className="link" onClick={() => toggleMute(activeChannel)}>
              {isMuted(activeChannel)
                ? '🔕 This channel is muted — tap to turn notifications on'
                : '🔔 Notifications on — tap to mute this channel'}
            </button>
          )}
          {active && <ChannelView channelId={active} />}
        </>
      )}
    </section>
  )
}
