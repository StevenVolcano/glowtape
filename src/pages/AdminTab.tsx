import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import EventForm from '../components/EventForm.tsx'
import { MANAGER_ROLES, ROLE_LABELS } from '../lib/types.ts'
import type { ChannelRecord, ConflictRecord, EventRecord, MemberRecord, MemberRole } from '../lib/types.ts'
import { DEFAULT_EVENT_KINDS, memberName, normalizePlaces, pbDate, productionPlaces, shareInvite } from '../lib/types.ts'
import type { Place } from '../lib/types.ts'

export default function AdminTab() {
  return (
    <div>
      <JoinCodeSection />
      <ConflictAlertsSection />
      <BiosSection />
      <NewEventSection />
      <ScheduleTableSection />
      <PresetsSection />
      <NewAnnouncementSection />
      <ChannelsSection />
      <MembersSection />
    </div>
  )
}

function JoinCodeSection() {
  const { production } = useProduction()
  const [feedback, setFeedback] = useState('')

  async function share(code: string) {
    const result = await shareInvite(code, production.title)
    if (result === 'copied') setFeedback('Link copied — paste it into a text or email.')
    if (result === 'shared') setFeedback('Shared!')
    setTimeout(() => setFeedback(''), 3000)
  }

  return (
    <section>
      <h2>Invite people</h2>
      <p className="hint">
        Share this code at the read-through, or send the invite link — opening it fills
        everything in automatically.
      </p>
      <div className="join-code">{production.joinCode}</div>
      <div className="row">
        <button onClick={() => share(production.joinCode)}>📤 Share invite link</button>
        {feedback && <span className="acked">{feedback}</span>}
      </div>
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

interface EditRow {
  id: string
  kind: string
  title: string
  date: string
  startTime: string
  endTime: string
  location: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function rowFromEvent(e: EventRecord): EditRow {
  const s = pbDate(e.start)
  const end = e.end ? pbDate(e.end) : null
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    date: `${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`,
    startTime: `${pad2(s.getHours())}:${pad2(s.getMinutes())}`,
    endTime: end ? `${pad2(end.getHours())}:${pad2(end.getMinutes())}` : '',
    location: e.location,
  }
}

// Fix up several nights at once; Save all sends ONE digest email covering
// every event whose time or place actually moved.
function ScheduleTableSection() {
  const { production } = useProduction()
  const [rows, setRows] = useState<EditRow[]>([])
  const [originals, setOriginals] = useState<Record<string, EditRow>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const kinds = production.eventKinds?.length ? production.eventKinds : DEFAULT_EVENT_KINDS
  const locations = productionPlaces(production).map((pl) => pl.name)

  async function load() {
    const list = await pb.collection('events').getFullList<EventRecord>({
      filter: pb.filter("production = {:p} && status != 'cancelled'", { p: production.id }),
      sort: 'start',
    })
    const now = Date.now() - 86400e3
    const upcoming = list.filter((e) => pbDate(e.start).getTime() >= now).slice(0, 60)
    const rs = upcoming.map(rowFromEvent)
    setRows(rs)
    setOriginals(Object.fromEntries(rs.map((r) => [r.id, { ...r }])))
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  function setField(id: string, field: keyof EditRow, value: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const dirty = rows.filter((r) => {
    const o = originals[r.id]
    return o && JSON.stringify(o) !== JSON.stringify(r)
  })

  async function saveAll() {
    setBusy(true)
    setMessage('')
    try {
      const res = await pb.send('/api/glowtape/events/update', {
        method: 'POST',
        body: {
          events: dirty.map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            location: r.location,
            start: new Date(`${r.date}T${r.startTime}`).toISOString(),
            end: r.endTime ? new Date(`${r.date}T${r.endTime}`).toISOString() : '',
          })),
        },
      })
      setMessage(
        res.notified > 0
          ? `Saved ${res.saved} — one email went out about ${res.notified} changed ${
              res.notified === 1 ? 'time/place' : 'times/places'
            }.`
          : `Saved ${res.saved} — nothing moved, so nobody was emailed.`,
      )
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (rows.length === 0) return null

  return (
    <section>
      <h2>Fix up the schedule</h2>
      <p className="hint">
        Adjust several events at once — type, title, day, times, place. Save all sends a single
        email covering everything that moved.
      </p>
      <div className="edit-table">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Title</th>
              <th>Date</th>
              <th>Start</th>
              <th>End</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <select value={r.kind} onChange={(e) => setField(r.id, 'kind', e.target.value)}>
                    <option value="">—</option>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input value={r.title} onChange={(e) => setField(r.id, 'title', e.target.value)} />
                </td>
                <td>
                  <input
                    type="date"
                    value={r.date}
                    onChange={(e) => setField(r.id, 'date', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={r.startTime}
                    onChange={(e) => setField(r.id, 'startTime', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={r.endTime}
                    onChange={(e) => setField(r.id, 'endTime', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    list="gt-locations"
                    value={r.location}
                    onChange={(e) => setField(r.id, 'location', e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="gt-locations">
        {locations.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <button onClick={saveAll} disabled={busy || dirty.length === 0}>
        {busy ? 'Saving…' : dirty.length > 0 ? `Save all (${dirty.length} changed)` : 'Save all'}
      </button>
      {message && <p className="acked">{message}</p>}
    </section>
  )
}

// Per-production preset lists used by the event forms. Places carry
// addresses so calendar entries and map links know where to point;
// company-wide places live on the org (dashboard-managed) and are inherited.
function PresetsSection() {
  const { production, reload } = useProduction()
  const [kinds, setKinds] = useState((production.eventKinds ?? []).join(', '))
  const [places, setPlaces] = useState<Place[]>(normalizePlaces(production.locations))
  const [saved, setSaved] = useState('')

  const orgPlaces = normalizePlaces(production.expand?.org?.locations)

  function setPlace(i: number, field: keyof Place, value: string) {
    setPlaces((prev) => prev.map((pl, idx) => (idx === i ? { ...pl, [field]: value } : pl)))
  }

  async function save() {
    const toList = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    await pb.collection('productions').update(production.id, {
      eventKinds: toList(kinds),
      locations: places.filter((pl) => pl.name.trim()),
    })
    setSaved('Saved.')
    setTimeout(() => setSaved(''), 2000)
    await reload()
  }

  return (
    <section>
      <h2>Event types &amp; places</h2>
      <div className="stack">
        <label>
          Event types (comma-separated; leave empty for the standard list)
          <input
            value={kinds}
            onChange={(e) => setKinds(e.target.value)}
            placeholder={DEFAULT_EVENT_KINDS.join(', ')}
          />
        </label>
        <div>
          <label>Rehearsal places (with an address, calendar entries open in map apps)</label>
          {places.map((pl, i) => (
            <div className="row" key={i}>
              <input
                aria-label="Place name"
                value={pl.name}
                onChange={(e) => setPlace(i, 'name', e.target.value)}
                placeholder="Driftwood Playhouse"
              />
              <input
                aria-label="Address"
                value={pl.address}
                onChange={(e) => setPlace(i, 'address', e.target.value)}
                placeholder="120 E 3rd St, Aberdeen, WA"
              />
              <button
                type="button"
                className="link"
                onClick={() => setPlaces((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link"
            onClick={() => setPlaces((prev) => [...prev, { name: '', address: '' }])}
          >
            + Add place
          </button>
          {orgPlaces.length > 0 && (
            <p className="hint">
              Also inherited from {production.expand?.org?.name}:{' '}
              {orgPlaces.map((pl) => pl.name).join(', ')}
            </p>
          )}
        </div>
        <div className="row">
          <button onClick={save}>Save presets</button>
          {saved && <span className="acked">{saved}</span>}
        </div>
      </div>
    </section>
  )
}

// "This production needs bios": one task per cast member, compiled view for
// the program.
function BiosSection() {
  const { production, members } = useProduction()
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const withBio = members.filter((m) => (m.bio ?? '').trim()).length
  const eligible = members.filter(
    (m) => m.role !== 'guardian' && !(m.multi && !m.user) && (m.user || m.minor),
  ).length

  async function request() {
    setBusy(true)
    setMessage('')
    try {
      const res = await pb.send('/api/glowtape/bios/request', {
        method: 'POST',
        body: { production: production.id, due },
      })
      setMessage(
        res.created > 0
          ? `Created ${res.created} bio task${res.created === 1 ? '' : 's'} — each person (or their guardian) was emailed.`
          : 'Everyone already has a bio or an open bio task. Nothing to do!',
      )
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Program bios</h2>
      <p className="hint">
        {withBio} of {eligible} bios written. Requesting creates a to-do for everyone still
        missing one; people write theirs on the People tab, and it compiles below for the
        program.
      </p>
      <div className="row">
        <label>
          Due (optional)
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button onClick={request} disabled={busy}>
          {busy ? 'Working…' : 'Request bios from the cast'}
        </button>
      </div>
      {message && <p className="acked">{message}</p>}
      <p>
        <Link className="link" to={`/production/${production.id}/bios`}>
          📄 View compiled bios (print / copy for the program)
        </Link>
      </p>
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

  // The server keeps productions.managers in sync with member `manager`
  // flags; promoting to a manager role auto-checks the flag, demoting
  // auto-unchecks it, and the checkbox handles everyone else (producer,
  // choreographer, ...).
  async function setRole(member: MemberRecord, role: MemberRole) {
    setBusyId(member.id)
    try {
      await pb.collection('members').update(member.id, {
        role,
        manager: MANAGER_ROLES.includes(role),
      })
      await reload()
    } finally {
      setBusyId('')
    }
  }

  async function setManager(member: MemberRecord, manager: boolean) {
    setBusyId(member.id)
    try {
      await pb.collection('members').update(member.id, { manager })
      await reload()
    } finally {
      setBusyId('')
    }
  }

  async function setNoPhotos(member: MemberRecord, noPhotos: boolean) {
    await pb.collection('members').update(member.id, { noPhotos })
    await reload()
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
            <strong>
              {m.user ? (
                m.expand?.user?.name
              ) : (
                <>
                  <em>{memberName(m)}</em>{' '}
                  {m.minor && <span className="pill">child</span>}{' '}
                  <span className="pill">{production.joinCode}-{m.roleCode}</span>
                  {m.multi && <span className="hint"> shared</span>}
                  {m.minor && (
                    <span className="hint">
                      {' '}
                      {m.guardians?.length
                        ? `${m.guardians.length} guardian${m.guardians.length > 1 ? 's' : ''}`
                        : 'no guardian yet — share the code with a parent'}
                    </span>
                  )}
                  <button
                    className="link"
                    onClick={() => shareInvite(`${production.joinCode}-${m.roleCode}`, production.title)}
                  >
                    📤 share
                  </button>
                </>
              )}
            </strong>
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
            <label className="row manage-toggle">
              <input
                type="checkbox"
                checked={m.manager}
                disabled={busyId === m.id}
                onChange={(e) => setManager(m, e.target.checked)}
              />
              Manage
            </label>
            <button
              className="link"
              title="Photo consent — tap to toggle"
              onClick={() => setNoPhotos(m, !m.noPhotos)}
            >
              {m.noPhotos ? '🚫📷 no photos' : '📷 ok'}
            </button>
            <button className="link" disabled={busyId === m.id} onClick={() => remove(m)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <AddRoleForm onAdded={reload} />
      <p className="hint">
        The <strong>Manage</strong> checkbox grants this tab — it checks itself for directors,
        assistant directors, and stage managers, and you can grant it to anyone else (producer,
        choreographer). Roles added before casting get a claim code — hand it to whoever is
        cast, they join with it, and their whole schedule (and Manage access, if it's a staff
        role) is waiting.
      </p>
    </section>
  )
}

// Pre-cast roles: exist on the schedule before auditions; claimed later by code.
function AddRoleForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const { production, members } = useProduction()
  const [position, setPosition] = useState('')
  const [role, setRole] = useState<MemberRole>('performer')
  const [multi, setMulti] = useState(false)
  const [minor, setMinor] = useState(false)
  const [childName, setChildName] = useState('')
  const [busy, setBusy] = useState(false)

  function makeRoleCode(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const taken = new Set(members.map((m) => m.roleCode).filter(Boolean))
    for (let i = 0; i < 200; i++) {
      const code =
        alphabet[Math.floor(Math.random() * alphabet.length)] +
        alphabet[Math.floor(Math.random() * alphabet.length)]
      if (!taken.has(code)) return code
    }
    return ''
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await pb.collection('members').create({
        production: production.id,
        role,
        position: position.trim(),
        roleCode: makeRoleCode(),
        multi: minor ? false : multi,
        minor,
        displayName: minor ? childName.trim() : '',
        manager: minor ? false : MANAGER_ROLES.includes(role),
      })
      setPosition('')
      setMulti(false)
      setMinor(false)
      setChildName('')
      await onAdded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={add} className="stack">
      <input
        aria-label="Role or position name"
        value={position}
        onChange={(e) => setPosition(e.target.value)}
        placeholder="Add a role before casting — e.g. Ophelia or Ensemble"
      />
      <select aria-label="Role type" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
        {(Object.keys(ROLE_LABELS) as MemberRole[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <label className="row">
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        Multiple people share this role (ensemble, crew) — everyone uses the same code
      </label>
      <label className="row">
        <input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
        This is a child (under 13) — a parent/guardian claims the code and manages everything
      </label>
      {minor && (
        <input
          aria-label="Child's name"
          value={childName}
          onChange={(e) => setChildName(e.target.value)}
          placeholder="Child's first name + last initial — e.g. Emma R."
        />
      )}
      <button type="submit" disabled={busy || !position.trim() || (minor && !childName.trim())}>
        Add role
      </button>
      {minor && (
        <p className="hint">
          Children never get logins. Share the role code with their parent or guardian — both
          parents can claim the same code, and each sees the full schedule and messages.
        </p>
      )}
    </form>
  )
}

// Auto to-do: called people whose conflicts collide with upcoming events.
function ConflictAlertsSection() {
  const { production, members } = useProduction()
  const [alerts, setAlerts] = useState<string[]>([])

  useEffect(() => {
    async function compute() {
      const [events, conflicts] = await Promise.all([
        pb.collection('events').getFullList<EventRecord>({
          filter: pb.filter("production = {:p} && status != 'cancelled'", { p: production.id }),
          sort: 'start',
        }),
        pb.collection('conflicts').getFullList<ConflictRecord>({
          filter: pb.filter('production = {:p}', { p: production.id }),
          expand: 'user',
        }),
      ])
      const now = Date.now() - 3600e3
      const out: string[] = []
      for (const ev of events) {
        const evDate = pbDate(ev.start)
        if (evDate.getTime() < now) continue
        const evDay = `${evDate.getFullYear()}-${pad2(evDate.getMonth() + 1)}-${pad2(evDate.getDate())}`
        const calledUsers =
          ev.called.length === 0
            ? members.filter((m) => m.user).map((m) => m.user)
            : members
                .filter(
                  (m) =>
                    m.user &&
                    (ev.called.includes(m.id) ||
                      (!!m.claimedFrom && ev.called.includes(m.claimedFrom))),
                )
                .map((m) => m.user)
        for (const c of conflicts) {
          if (!calledUsers.includes(c.user)) continue
          const from = String(c.start).slice(0, 10)
          const to = String(c.end || c.start).slice(0, 10)
          if (evDay >= from && evDay <= to) {
            const who = c.expand?.user?.name || 'Someone'
            out.push(
              `${who} has a conflict${c.note ? ` (${c.note})` : ''} but is called to “${ev.title}” on ${evDay}`,
            )
          }
        }
      }
      setAlerts(out)
    }
    compute().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id, members])

  if (alerts.length === 0) return null

  return (
    <section>
      <h2>⚠️ To sort out</h2>
      <p className="hint">
        People who are called to an event that lands on one of their conflicts. Move the event in
        “Fix up the schedule,” adjust who's called, or talk it through with them.
      </p>
      <ul className="plain-list">
        {alerts.map((a, i) => (
          <li key={i} className="conflict-alert">
            {a}
          </li>
        ))}
      </ul>
    </section>
  )
}
