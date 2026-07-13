import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import EventForm from '../components/EventForm.tsx'
import ManageJumpNav from '../components/ManageJumpNav.tsx'
import QrCode from '../components/QrCode.tsx'
import { MANAGER_ROLES, ROLE_LABELS } from '../lib/types.ts'
import type { AttendanceRecord, AuditionRecord, ChannelRecord, ConflictRecord, EventRecord, MemberRecord, MemberRole, ProfileRecord, ResourceRecord } from '../lib/types.ts'
import { DEFAULT_EVENT_KINDS, memberName, normalizePlaces, pbDate, productionPlaces, shareInvite } from '../lib/types.ts'
import type { Place } from '../lib/types.ts'

export default function AdminTab() {
  return (
    <div>
      <ManageJumpNav />
      <JoinCodeSection />
      <AuditionsSection />
      <ConflictAlertsSection />
      <AttendanceHistorySection />
      <BiosSection />
      <NewEventSection />
      <ScheduleTableSection />
      <PresetsSection />
      <NewAnnouncementSection />
      <ResourcesSection />
      <ChannelsSection />
      <MembersSection />
    </div>
  )
}

function JoinCodeSection() {
  const { production } = useProduction()
  const [feedback, setFeedback] = useState('')
  const [showQr, setShowQr] = useState(false)

  async function share(code: string) {
    const result = await shareInvite(code, production.title)
    if (result === 'copied') setFeedback('Link copied — paste it into a text or email.')
    if (result === 'shared') setFeedback('Shared!')
    setTimeout(() => setFeedback(''), 3000)
  }

  return (
    <section id="invite">
      <h2>Invite people</h2>
      <p className="hint">
        Share this code at the read-through, or send the invite link — opening it fills
        everything in automatically.
      </p>
      <div className="join-code">{production.joinCode}</div>
      <div className="row">
        <button onClick={() => share(production.joinCode)}>📤 Share invite link</button>
        <button className="link" aria-expanded={showQr} onClick={() => setShowQr(!showQr)}>
          {showQr ? 'Hide QR code' : '📱 Show QR code'}
        </button>
        {feedback && <span className="acked" role="status">{feedback}</span>}
      </div>
      {showQr && (
        <QrCode
          text={`${window.location.origin}/?code=${encodeURIComponent(production.joinCode)}`}
          label={`Scan to join ${production.title} — code ${production.joinCode}`}
        />
      )}
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
    <section id="add-events">
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
    <section id="announce">
      <h2>Post an announcement</h2>
      <form onSubmit={post} className="stack">
        <input
          aria-label="Announcement title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          required
        />
        <textarea
          aria-label="Announcement details"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details"
          rows={3}
        />
        <label className="row">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin to the top
        </label>
        <button type="submit" disabled={busy || !title}>
          {busy ? 'Posting…' : 'Post announcement'}
        </button>
        {done && <p className="acked" role="status">{done}</p>}
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
              <th scope="col">Type</th>
              <th scope="col">Title</th>
              <th scope="col">Date</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
              <th scope="col">Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <select
                    aria-label={`Type for ${r.title}`}
                    value={r.kind}
                    onChange={(e) => setField(r.id, 'kind', e.target.value)}
                  >
                    <option value="">—</option>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label="Title"
                    value={r.title}
                    onChange={(e) => setField(r.id, 'title', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Date for ${r.title}`}
                    type="date"
                    value={r.date}
                    onChange={(e) => setField(r.id, 'date', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Start time for ${r.title}`}
                    type="time"
                    value={r.startTime}
                    onChange={(e) => setField(r.id, 'startTime', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`End time for ${r.title}`}
                    type="time"
                    value={r.endTime}
                    onChange={(e) => setField(r.id, 'endTime', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Location for ${r.title}`}
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
      {message && <p className="acked" role="status">{message}</p>}
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
    <section id="presets">
      <h2>Event types &amp; places</h2>
      <div className="stack">
        <label>
          Event types (comma-separated; leave empty for the standard list)
          <input
            value={kinds}
            onChange={(e) => setKinds(e.target.value)}
            placeholder={'Standard list: ' + DEFAULT_EVENT_KINDS.join(', ')}
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
                placeholder="Example: Driftwood Playhouse"
              />
              <input
                aria-label="Address"
                value={pl.address}
                onChange={(e) => setPlace(i, 'address', e.target.value)}
                placeholder="Example: 120 E 3rd St, Aberdeen, WA"
              />
              <button
                type="button"
                className="link"
                aria-label={`Remove ${pl.name || 'place'}`}
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
          {saved && <span className="acked" role="status">{saved}</span>}
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
  const [audience, setAudience] = useState<'performers' | 'team' | 'everyone'>('everyone')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const inAudience = (m: MemberRecord) => {
    if (m.role === 'guardian' || (m.multi && !m.user) || (!m.user && !m.minor)) return false
    if (audience === 'performers') return m.role === 'performer'
    if (audience === 'team') return MANAGER_ROLES.includes(m.role) || m.manager
    return true
  }
  const pool = members.filter(inAudience)
  const withBio = pool.filter((m) => (m.bio ?? '').trim()).length
  const eligible = pool.length

  async function request() {
    setBusy(true)
    setMessage('')
    try {
      const res = await pb.send('/api/glowtape/bios/request', {
        method: 'POST',
        body: { production: production.id, due, audience },
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
    <section id="bios">
      <h2>Program bios</h2>
      <p className="hint">
        {eligible === 0
          ? `Nobody matches "${
              audience === 'performers'
                ? 'Performers only'
                : audience === 'team'
                  ? 'Production team'
                  : 'Everyone'
            }" yet — pick a different group below, or add people in People & roles first.`
          : `${withBio} of ${eligible} bios written for this group. Requesting creates a to-do
        for everyone still missing one; people write theirs on the To-Do tab, and it compiles
        below for the program.`}
      </p>
      <div className="row">
        <label>
          Who writes one?
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as typeof audience)}
          >
            <option value="everyone">Everyone</option>
            <option value="performers">Performers only</option>
            <option value="team">Production team</option>
          </select>
        </label>
        <label>
          Due (optional)
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button onClick={request} disabled={busy}>
          {busy ? 'Working…' : 'Request bios'}
        </button>
      </div>
      {message && <p className="acked" role="status">{message}</p>}
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
          placeholder="New channel — for example: Costumes"
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
    <section id="people">
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
              aria-label={`Photo consent for ${memberName(m)}: ${
                m.noPhotos ? 'no photos allowed' : 'photos OK'
              } — tap to toggle`}
              onClick={() => setNoPhotos(m, !m.noPhotos)}
            >
              {m.noPhotos ? '🚫📷 no photos' : '📷 ok'}
            </button>
            <button className="link" disabled={busyId === m.id} onClick={() => remove(m)}>
              remove
            </button>
            {!m.user && !m.minor && !m.multi && (
              <OfflineContact member={m} onSaved={reload} />
            )}
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
        placeholder="Add a role before casting — for example: Ophelia or Ensemble"
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
          placeholder="Child's first name + last initial — for example: Emma R."
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

// Audition setup + signups, aggregated in-app (no per-signup emails).
function AuditionsSection() {
  const { production, reload } = useProduction()
  const [notes, setNotes] = useState(production.auditionNotes ?? '')
  const [questions, setQuestions] = useState(
    Array.isArray(production.auditionQuestions) ? production.auditionQuestions.join('\n') : '',
  )
  const [signups, setSignups] = useState<AuditionRecord[]>([])
  const [profiles, setProfiles] = useState<Map<string, ProfileRecord>>(new Map())
  const [openId, setOpenId] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [shared, setShared] = useState('')
  const [showAuditionQr, setShowAuditionQr] = useState(false)

  async function shareAuditionLink() {
    const url = `${window.location.origin}/audition/${production.id}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Glow Tape', text: `Audition for ${production.title}`, url })
        setShared('Shared!')
      } catch {
        /* cancelled */
      }
    } else {
      await navigator.clipboard.writeText(url)
      setShared('Link copied — paste it anywhere.')
    }
    setTimeout(() => setShared(''), 3000)
  }

  async function loadSignups() {
    const list = await pb.collection('auditions').getFullList<AuditionRecord>({
      filter: pb.filter('production = {:p}', { p: production.id }),
      expand: 'user',
      sort: 'created',
    })
    setSignups(list)
    const userIds = [...new Set(list.map((a) => a.user))]
    if (userIds.length) {
      const filter = userIds.map((_, i) => `user = {:u${i}}`).join(' || ')
      const params = Object.fromEntries(userIds.map((id, i) => [`u${i}`, id]))
      const profs = await pb
        .collection('profiles')
        .getFullList<ProfileRecord>({ filter: pb.filter(filter, params) })
      setProfiles(new Map(profs.map((p) => [p.user, p])))
    }
  }

  useEffect(() => {
    loadSignups().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  async function toggleOpen() {
    await pb.collection('productions').update(production.id, {
      auditionOpen: !production.auditionOpen,
    })
    await reload()
  }

  async function saveSetup() {
    setBusy(true)
    setSaved('')
    try {
      await pb.collection('productions').update(production.id, {
        auditionNotes: notes.trim(),
        auditionQuestions: questions
          .split('\n')
          .map((q) => q.trim())
          .filter(Boolean),
      })
      await reload()
      setSaved('Saved. ✓')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="auditions">
      <h2>Auditions</h2>
      <p className="hint">
        Get everything ready first — details, questions, a look at the form — then open
        signups when it's all set.
      </p>
      <div className="stack" style={{ marginTop: '0.5rem' }}>
        <label>
          Details for auditioners (dates, place, what to prepare)
          <textarea
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Example: Auditions June 3–4, 6:30pm at the Driftwood. Prepare 16 bars…"
          />
        </label>
        <label>
          Your questions, one per line (optional)
          <textarea
            rows={3}
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            placeholder={'Examples:\nWill you accept another role if offered?\nAny costume sizes we should know?'}
          />
        </label>
        <div className="row">
          <button onClick={saveSetup} disabled={busy}>
            Save audition setup
          </button>
          <Link className="link" to={`/audition/${production.id}`}>
            👁 Preview the signup form
          </Link>
          {saved && <span className="acked" role="status">{saved}</span>}
        </div>
        <div className="row">
          <button onClick={shareAuditionLink}>📤 Share the audition link</button>
          <button
            className="link"
            aria-expanded={showAuditionQr}
            onClick={() => setShowAuditionQr(!showAuditionQr)}
          >
            {showAuditionQr ? 'Hide QR code' : '📱 Show QR code'}
          </button>
          {shared && <span className="acked" role="status">{shared}</span>}
        </div>
        {showAuditionQr && (
          <QrCode
            text={`${window.location.origin}/audition/${production.id}`}
            label={`Scan to audition for ${production.title}`}
          />
        )}
        <p className="hint">
          The link opens the signup form directly. Anyone already on Glow Tape just taps it;
          newcomers also need a signup code (your join code works, or a community code from
          the organizer).{' '}
          <Link className="link" to={`/audition/${production.id}/print`}>
            🖨 Print blank paper forms
          </Link>{' '}
          for the audition table — same questions, hand-fillable. Attach sides or packets
          under <em>Documents &amp; links</em> below (area: Auditions).
        </p>
      </div>

      <label className="row manage-toggle" style={{ marginTop: '0.8rem' }}>
        <input type="checkbox" checked={!!production.auditionOpen} onChange={toggleOpen} />
        Auditions are open — everyone on Glow Tape sees this show and can sign up
      </label>
      {!production.auditionOpen && (
        <p className="hint" role="status">
          ⏸ Signups are closed. Until you check the box, the form is a preview only you and
          the production team can open — sharing the link with anyone else shows them nothing.
        </p>
      )}

      {signups.length > 0 && (
        <>
          <h3 className="dept-heading">
            {signups.length} signup{signups.length === 1 ? '' : 's'}
          </h3>
          <ul className="plain-list">
            {signups.map((a) => {
              const profile = profiles.get(a.user)
              const open = openId === a.id
              return (
                <li key={a.id}>
                  <button
                    className="link"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? '' : a.id)}
                  >
                    {open ? '▾' : '▸'} {a.expand?.user?.name || 'Someone'}
                    {a.roles && <span className="hint"> — {a.roles}</span>}
                  </button>
                  {open && (
                    <div className="stack" style={{ margin: '0.3rem 0 0.8rem 1.2rem' }}>
                      {profile?.headshot && (
                        <img
                          src={pb.files.getURL(profile, profile.headshot, { thumb: '400x0' })}
                          alt={`Headshot of ${a.expand?.user?.name}`}
                          style={{ maxWidth: '140px', borderRadius: '10px' }}
                        />
                      )}
                      {profile?.pronouns && <p className="hint">Pronouns: {profile.pronouns}</p>}
                      {a.conflicts && (
                        <p>
                          <strong>Conflicts:</strong> {a.conflicts}
                        </p>
                      )}
                      {Object.entries(a.answers ?? {}).map(
                        ([q, ans]) =>
                          ans && (
                            <p key={q}>
                              <strong>{q}</strong>
                              <br />
                              {ans}
                            </p>
                          ),
                      )}
                      {Array.isArray(profile?.credits) && profile.credits.length > 0 && (
                        <div className="edit-table">
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Year</th>
                                <th scope="col">Company</th>
                                <th scope="col">Show</th>
                                <th scope="col">Role</th>
                              </tr>
                            </thead>
                            <tbody>
                              {profile.credits.map((c, i) => (
                                <tr key={i}>
                                  <td>{c.year}</td>
                                  <td>{c.company}</td>
                                  <td>{c.show}</td>
                                  <td>{c.role}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {profile?.experience && (
                        <p>
                          <strong>Experience:</strong> {profile.experience}
                        </p>
                      )}
                      {profile?.skills && (
                        <p>
                          <strong>Skills:</strong> {profile.skills}
                        </p>
                      )}
                      {!profile && <p className="hint">No community profile yet.</p>}
                      <p className="hint">
                        Signed up {pbDate(a.created).toLocaleDateString()} ·{' '}
                        {a.expand?.user?.email}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {production.auditionOpen && signups.length === 0 && (
        <p className="hint">No signups yet — they'll collect here as people fill out the form.</p>
      )}
    </section>
  )
}

// Documents & links for the show (cast/crew) and for auditions (public while
// auditions are open).
function ResourcesSection() {
  const { production } = useProduction()
  const [resources, setResources] = useState<ResourceRecord[]>([])
  const [area, setArea] = useState<'show' | 'audition'>('show')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const list = await pb.collection('resources').getFullList<ResourceRecord>({
      filter: pb.filter('production = {:p}', { p: production.id }),
      sort: 'area,order,created',
    })
    setResources(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || (!url.trim() && !file)) return
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.set('production', production.id)
      form.set('area', area)
      form.set('title', title.trim())
      if (file) form.set('file', file)
      else form.set('url', url.trim())
      await pb.collection('resources').create(form)
      setTitle('')
      setUrl('')
      setFile(null)
      setMessage('Added. ✓')
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(r: ResourceRecord) {
    if (!window.confirm(`Remove "${r.title}"?`)) return
    await pb.collection('resources').delete(r.id)
    await load()
  }

  const byArea = (a: 'show' | 'audition') => resources.filter((r) => r.area === a)

  return (
    <section id="resources">
      <h2>Documents &amp; links</h2>
      <p className="hint">
        Scripts info, rehearsal tracks, forms, sides — anything the cast (or auditioners) should
        be able to open. Show resources appear at the bottom of the Schedule tab; audition
        resources appear on the audition signup form.
      </p>

      {(['show', 'audition'] as const).map(
        (a) =>
          byArea(a).length > 0 && (
            <div key={a}>
              <h3 className="dept-heading">{a === 'show' ? 'For the show' : 'For auditions'}</h3>
              <ul className="plain-list">
                {byArea(a).map((r) => (
                  <li key={r.id} className="row">
                    <a
                      className="link"
                      href={r.file ? pb.files.getURL(r, r.file) : r.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.file ? '📄' : '🔗'} {r.title}
                    </a>
                    <button
                      className="link"
                      aria-label={`Remove ${r.title}`}
                      onClick={() => remove(r)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}

      <form onSubmit={add} className="stack">
        <div className="row">
          <select aria-label="Resource area" value={area} onChange={(e) => setArea(e.target.value as typeof area)}>
            <option value="show">For the show</option>
            <option value="audition">For auditions</option>
          </select>
          <input
            aria-label="Resource title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title — for example: Act 1 rehearsal track"
          />
        </div>
        <div className="row">
          <input
            aria-label="Link URL"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a link…"
            disabled={!!file}
          />
          <label className="photo-btn" aria-label="Attach a document instead">
            📄
            <input
              type="file"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {file && (
          <div className="row hint">
            📄 {file.name}
            <button type="button" className="link" onClick={() => setFile(null)}>
              remove
            </button>
          </div>
        )}
        <button type="submit" disabled={busy || !title.trim() || (!url.trim() && !file)}>
          Add {area === 'show' ? 'show' : 'audition'} resource
        </button>
        {message && <p className="acked" role="status">{message}</p>}
      </form>
    </section>
  )
}

// Per-member attendance across the production, from roll call and self-
// reports. Manager-only on purpose — this is an SM's tool, not a leaderboard.
function AttendanceHistorySection() {
  const { production, members } = useProduction()
  const [rows, setRows] = useState<AttendanceRecord[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    pb.collection('attendance')
      .getFullList<AttendanceRecord>({
        filter: pb.filter('event.production = {:p}', { p: production.id }),
      })
      .then(setRows)
      .catch(() => {})
  }, [production.id])

  if (rows.length === 0) return null

  const byMember = new Map<string, { present: number; late: number; absent: number }>()
  for (const r of rows) {
    const t = byMember.get(r.member) ?? { present: 0, late: 0, absent: 0 }
    t[r.status]++
    byMember.set(r.member, t)
  }
  const tallied = members
    .filter((m) => byMember.has(m.id))
    .map((m) => ({ m, t: byMember.get(m.id)! }))
    .sort((a, b) => memberName(a.m).localeCompare(memberName(b.m)))

  return (
    <section id="attendance">
      <h2>Attendance history</h2>
      <p className="hint">
        Totals from roll call and self-reports across the whole production. Visible only to
        the production team.
      </p>
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide the table' : `Show the table (${tallied.length} people)`}
      </button>
      {open && (
        <div className="edit-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Present</th>
                <th scope="col">Late</th>
                <th scope="col">Absent</th>
              </tr>
            </thead>
            <tbody>
              {tallied.map(({ m, t }) => (
                <tr key={m.id}>
                  <td>{memberName(m)}</td>
                  <td>{t.present}</td>
                  <td>{t.late}</td>
                  <td className={t.absent > 2 ? 'error' : ''}>{t.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// For cast and crew who can't or won't use Glow Tape: staff record a name
// and contact info on the role itself. Emails to the production include the
// address; texts never do (they didn't opt in).
function OfflineContact({
  member,
  onSaved,
}: {
  member: MemberRecord
  onSaved: () => Promise<void>
}) {
  const [open, setOpen] = useState(!!member.contactEmail || !!member.contactPhone)

  async function save(field: 'displayName' | 'contactEmail' | 'contactPhone', value: string) {
    if (value === (member[field] ?? '')) return
    await pb.collection('members').update(member.id, { [field]: value })
    await onSaved()
  }

  return (
    <div style={{ width: '100%' }}>
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        📇 {open ? 'Hide' : 'Not on Glow Tape? Add their contact info'}
      </button>
      {open && (
        <div className="row">
          <input
            aria-label="Their name"
            defaultValue={member.displayName}
            placeholder="Their name"
            maxLength={80}
            onBlur={(e) => save('displayName', e.target.value.trim())}
          />
          <input
            aria-label="Their email"
            type="email"
            defaultValue={member.contactEmail}
            placeholder="Email (gets production emails)"
            maxLength={200}
            onBlur={(e) => save('contactEmail', e.target.value.trim())}
          />
          <input
            aria-label="Their phone"
            defaultValue={member.contactPhone}
            placeholder="Phone (contact sheet only)"
            maxLength={40}
            onBlur={(e) => save('contactPhone', e.target.value.trim())}
          />
        </div>
      )}
    </div>
  )
}
