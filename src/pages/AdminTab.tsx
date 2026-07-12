import { useEffect, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import EventForm from '../components/EventForm.tsx'
import { MANAGER_ROLES, ROLE_LABELS } from '../lib/types.ts'
import type { ChannelRecord, MemberRecord, MemberRole } from '../lib/types.ts'

export default function AdminTab() {
  return (
    <div>
      <JoinCodeSection />
      <NewEventSection />
      <NewAnnouncementSection />
      <ChannelsSection />
      <MembersSection />
    </div>
  )
}

function JoinCodeSection() {
  const { production } = useProduction()
  return (
    <section>
      <h2>Invite people</h2>
      <p className="hint">
        Share this code at the read-through. Anyone can sign in at this site and join with it —
        no invitation email required.
      </p>
      <div className="join-code">{production.joinCode}</div>
      <p className="hint">
        Handing out paper at the read-through?{' '}
        <a href="/handout.html" target="_blank" rel="noreferrer">
          Print the getting-started handout
        </a>{' '}
        and write this code in the blank.
      </p>
    </section>
  )
}

function NewEventSection() {
  return (
    <section>
      <h2>Add to the schedule</h2>
      <EventForm onDone={async () => {}} />
    </section>
  )
}

function NewAnnouncementSection() {
  const { production } = useProduction()
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  async function post(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setDone('')
    try {
      await pb.collection('announcements').create({
        production: production.id,
        author: user!.id,
        title,
        body,
        pinned,
      })
      setTitle('')
      setBody('')
      setPinned(false)
      setDone('Posted, and emailed to everyone in the production.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Post an announcement</h2>
      <form onSubmit={post} className="stack">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details" rows={3} />
        <label className="row">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin to the top
        </label>
        <button type="submit" disabled={busy || !title}>
          {busy ? 'Posting…' : 'Post announcement'}
        </button>
        {done && <p className="acked">{done}</p>}
      </form>
    </section>
  )
}

function ChannelsSection() {
  const { production } = useProduction()
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [name, setName] = useState('')
  const [audience, setAudience] = useState<'all' | 'cast' | 'crew' | 'team'>('all')
  const [busy, setBusy] = useState(false)

  const AUDIENCE_LABELS = {
    all: 'Everyone',
    cast: 'Cast',
    crew: 'Crew',
    team: 'Production team',
  } as const

  async function load() {
    const list = await pb.collection('channels').getFullList<ChannelRecord>({
      filter: pb.filter('production = {:p}', { p: production.id }),
      sort: 'created',
    })
    setChannels(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await pb.collection('channels').create({ production: production.id, name, audience })
      setName('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function rename(c: ChannelRecord, newName: string) {
    if (!newName.trim() || newName === c.name) return
    await pb.collection('channels').update(c.id, { name: newName.trim() })
    await load()
  }

  async function setArchived(c: ChannelRecord, archived: boolean) {
    await pb.collection('channels').update(c.id, { archived })
    await load()
  }

  return (
    <section>
      <h2>Channels</h2>
      <ul className="plain-list">
        {channels.map((c) => (
          <li key={c.id} className="member-row">
            <input
              aria-label={`Rename ${c.name}`}
              defaultValue={c.name}
              onBlur={(e) => rename(c, e.target.value)}
            />
            <span className="hint">{AUDIENCE_LABELS[c.audience]}</span>
            {c.archived ? (
              <button className="link" onClick={() => setArchived(c, false)}>
                restore
              </button>
            ) : (
              <button className="link" onClick={() => setArchived(c, true)}>
                archive
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="row">
        <input
          aria-label="New channel name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New channel — e.g. Costumes"
        />
        <select
          aria-label="Who can see it"
          value={audience}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
        >
          <option value="all">Everyone</option>
          <option value="cast">Cast</option>
          <option value="crew">Crew</option>
          <option value="team">Production team</option>
        </select>
        <button type="submit" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
      <p className="hint">
        Archiving hides a channel without deleting its messages; restore it any time.
      </p>
    </section>
  )
}

function MembersSection() {
  const { production, members, reload } = useProduction()
  const [busyId, setBusyId] = useState('')

  // Keep the denormalized managers list in sync with member roles so the
  // API rules (which check production.managers) stay correct.
  async function syncManagers(updated: MemberRecord[]) {
    const managerUserIds = updated
      .filter((m) => MANAGER_ROLES.includes(m.role))
      .map((m) => m.user)
    const next = Array.from(new Set(managerUserIds))
    const current = [...production.managers].sort()
    if (JSON.stringify(next.slice().sort()) !== JSON.stringify(current)) {
      await pb.collection('productions').update(production.id, { managers: next })
    }
  }

  async function setRole(member: MemberRecord, role: MemberRole) {
    setBusyId(member.id)
    try {
      await pb.collection('members').update(member.id, { role })
      const updated = members.map((m) => (m.id === member.id ? { ...m, role } : m))
      await syncManagers(updated)
      await reload()
    } finally {
      setBusyId('')
    }
  }

  async function setPosition(member: MemberRecord, position: string) {
    await pb.collection('members').update(member.id, { position })
    await reload()
  }

  async function remove(member: MemberRecord) {
    if (!window.confirm(`Remove ${member.expand?.user?.name} from ${production.title}?`)) return
    setBusyId(member.id)
    try {
      await pb.collection('members').delete(member.id)
      await syncManagers(members.filter((m) => m.id !== member.id))
      await reload()
    } finally {
      setBusyId('')
    }
  }

  return (
    <section>
      <h2>People &amp; roles</h2>
      <ul className="plain-list">
        {members.map((m) => (
          <li key={m.id} className="member-row">
            <strong>{m.expand?.user?.name}</strong>
            <select
              aria-label={`Role for ${m.expand?.user?.name}`}
              value={m.role}
              disabled={busyId === m.id}
              onChange={(e) => setRole(m, e.target.value as MemberRole)}
            >
              {(Object.keys(ROLE_LABELS) as MemberRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <input
              aria-label={`Position for ${m.expand?.user?.name}`}
              defaultValue={m.position}
              placeholder="Character / position"
              onBlur={(e) => {
                if (e.target.value !== m.position) setPosition(m, e.target.value)
              }}
            />
            <button className="link" disabled={busyId === m.id} onClick={() => remove(m)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">
        Directors, assistant directors, and stage managers can manage the production (this tab).
      </p>
    </section>
  )
}
