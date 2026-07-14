import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useTitle } from '../lib/useTitle.ts'
import { formatDay, formatStamp, shareInvite } from '../lib/types.ts'
import type {
  AccessCodeRecord,
  CompanyRecord,
  FeedbackRecord,
  OrgRecord,
  ProductionRequestRecord,
} from '../lib/types.ts'

// Emails are no longer readable via user expands (contact privacy) — the
// console fetches them through the operator-gated route.
async function fetchEmails(userIds: (string | undefined)[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return {}
  try {
    const res = await pb.send('/api/glowtape/operator/emails', {
      method: 'POST',
      body: { users: ids },
    })
    return res.users ?? {}
  } catch {
    return {}
  }
}

// The operator console: triage feedback and rotate community access codes
// without touching the PocketBase dashboard. Visible only to accounts with
// the operator flag (set once, in the dashboard).
export default function Operator() {
  useTitle('Operator console')
  const { user } = useAuth()
  // Bumped when orgs change so the companies section re-reads its org dropdown.
  const [orgRev, setOrgRev] = useState(0)

  if (!user?.operator) return <Navigate to="/" replace />

  return (
    <main className="page">
      <header className="topbar">
        <Link to="/" className="link">
          ← Home
        </Link>
        <span className="brand-small">Glow Tape</span>
      </header>
      <h1>Operator console</h1>
      <RequestsSection />
      <FeedbackInbox />
      <AccessCodesSection />
      <OrgsSection onChanged={() => setOrgRev((r) => r + 1)} />
      <CompaniesSection key={orgRev} />
    </main>
  )
}

// Organizations are the umbrella productions live under. Approving a
// production request creates one automatically; this section covers the rest
// (add ahead of time, fix a name) without opening the PocketBase dashboard.
function OrgsSection({ onChanged }: { onChanged: () => void }) {
  const [orgs, setOrgs] = useState<OrgRecord[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const [list, prods] = await Promise.all([
      pb.collection('orgs').getFullList<OrgRecord>({ sort: 'name' }),
      pb.collection('productions').getFullList<{ org: string }>({ fields: 'org' }),
    ])
    setOrgs(list)
    const c = new Map<string, number>()
    for (const p of prods) c.set(p.org, (c.get(p.org) ?? 0) + 1)
    setCounts(c)
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setMessage('')
    try {
      await pb.collection('orgs').create({ name: name.trim() })
      setName('')
      await load()
      onChanged()
    } catch {
      setMessage("Couldn't add that organization.")
    } finally {
      setBusy(false)
    }
  }

  async function rename(o: OrgRecord, value: string) {
    const next = value.trim()
    if (!next || next === o.name) return
    try {
      await pb.collection('orgs').update(o.id, { name: next })
      await load()
      onChanged()
      setMessage(`Renamed to ${next}. ✓`)
    } catch {
      setMessage("Couldn't rename it — try again.")
    }
  }

  return (
    <section>
      <h2>Organizations</h2>
      <p className="hint">
        The umbrella a production lives under — approving a request creates one automatically.
        Edit a name right in its box; add one ahead of time below. (Deleting still takes the
        PocketBase dashboard, since an organization can have productions attached.)
      </p>
      <ul className="plain-list">
        {orgs.map((o) => (
          <li key={o.id} className="row">
            <input
              aria-label={`Name of ${o.name}`}
              defaultValue={o.name}
              maxLength={120}
              onBlur={(e) => rename(o, e.target.value)}
            />
            <span className="hint">
              {counts.get(o.id) ?? 0} production{(counts.get(o.id) ?? 0) === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="row">
        <input
          aria-label="New organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Example: Grays Harbor College"
        />
        <button type="submit" disabled={busy || !name.trim()}>
          Add organization
        </button>
      </form>
      {message && <p className="acked" role="status">{message}</p>}
    </section>
  )
}

// The shared list of local theater companies offered in profile stage-history
// dropdowns. Renaming or deleting here doesn't touch what anyone already
// saved — profiles store the company as plain text.
function CompaniesSection() {
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [orgs, setOrgs] = useState<OrgRecord[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const [list, orgList] = await Promise.all([
      pb.collection('companies').getFullList<CompanyRecord>({ sort: 'name' }),
      pb.collection('orgs').getFullList<OrgRecord>({ sort: 'name' }),
    ])
    setCompanies(list)
    setOrgs(orgList)
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setMessage('')
    try {
      await pb.collection('companies').create({ name: name.trim() })
      setName('')
      await load()
    } catch {
      setMessage("Couldn't add it — is it already on the list?")
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: CompanyRecord) {
    if (!window.confirm(`Remove ${c.name} from the dropdown list? Profiles that already mention it keep it.`))
      return
    await pb.collection('companies').delete(c.id)
    await load()
  }

  async function saveField(c: CompanyRecord, field: 'ticketUrl' | 'org', value: string) {
    if (value === ((c[field] as string | undefined) ?? '')) return
    await pb.collection('companies').update(c.id, { [field]: value })
    await load()
  }

  return (
    <section>
      <h2>Theater companies</h2>
      <p className="hint">
        The dropdown people see in their profile's stage-history table (they can always type
        somewhere else by hand). Link a company to the organization that runs its shows here, then
        its ticket link is added to that org's performances on the community calendar as a{' '}
        <em>🎟 Buy tickets</em> button. Leave the link blank if there's no online box office —
        no link, no button.
      </p>
      <ul className="plain-list">
        {companies.map((c) => (
          <li key={c.id} className="stack" style={{ marginBottom: '0.75rem' }}>
            <div className="row">
              <strong>{c.name}</strong>
              <button className="link" aria-label={`Remove ${c.name}`} onClick={() => remove(c)}>
                ✕
              </button>
            </div>
            <div className="row">
              <label>
                Runs shows as
                <select
                  aria-label={`Organization for ${c.name}`}
                  value={c.org ?? ''}
                  onChange={(e) => saveField(c, 'org', e.target.value)}
                >
                  <option value="">— not in Glow Tape —</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <input
                type="url"
                aria-label={`Ticket link for ${c.name}`}
                defaultValue={c.ticketUrl ?? ''}
                onBlur={(e) => saveField(c, 'ticketUrl', e.target.value.trim())}
                placeholder="Ticket link — for example: driftwoodplayers.com/tickets"
              />
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="row">
        <input
          aria-label="New company"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Example: Aberdeen High School"
        />
        <button type="submit" disabled={busy || !name.trim()}>
          Add company
        </button>
      </form>
      {message && <p className="error" role="status">{message}</p>}
    </section>
  )
}

function FeedbackInbox() {
  const [items, setItems] = useState<FeedbackRecord[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [showClosed, setShowClosed] = useState(false)

  async function load() {
    const list = await pb.collection('feedback').getFullList<FeedbackRecord>({
      sort: '-created',
      expand: 'user',
    })
    setItems(list)
    setEmails(await fetchEmails(list.map((f) => f.user)))
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function setStatus(f: FeedbackRecord, status: string) {
    await pb.collection('feedback').update(f.id, { status })
    await load()
  }

  async function setReply(f: FeedbackRecord, reply: string) {
    if (reply === (f.reply ?? '')) return
    await pb.collection('feedback').update(f.id, { reply })
    await load()
  }

  async function remove(f: FeedbackRecord) {
    if (!window.confirm('Delete this feedback?')) return
    await pb.collection('feedback').delete(f.id)
    await load()
  }

  const isOpen = (f: FeedbackRecord) => !f.status || f.status === 'new' || f.status === 'planned'
  const visible = items.filter((f) => showClosed || isOpen(f))
  const openCount = items.filter(isOpen).length

  return (
    <section>
      <h2>Feedback ({openCount} open)</h2>
      {visible.length === 0 && <p className="hint">Inbox zero. 🎉</p>}
      <ul className="plain-list">
        {visible.map((f) => (
          <li key={f.id} className="stack" style={{ marginBottom: '1rem' }}>
            <div>
              <strong>
                {f.kind === 'idea' ? '💡' : f.kind === 'problem' ? '🐞' : f.kind === 'question' ? '❓' : '🎉'}{' '}
                {f.expand?.user?.name || 'Unknown'}
              </strong>{' '}
              <span className="hint">
                {emails[f.user]} · {formatStamp(f.created)}
                {f.page && f.page !== '/' ? ` · from ${f.page}` : ''}
              </span>
            </div>
            <p style={{ margin: 0 }}>{f.message}</p>
            <div className="row">
              <select
                aria-label="Status"
                value={f.status || 'new'}
                onChange={(e) => setStatus(f, e.target.value)}
              >
                <option value="new">New</option>
                <option value="planned">Planned</option>
                <option value="done">Done</option>
                <option value="declined">Not planned</option>
              </select>
              <input
                aria-label="Reply shown to the sender"
                defaultValue={f.reply ?? ''}
                onBlur={(e) => setReply(f, e.target.value.trim())}
                placeholder="Short reply they'll see (optional)"
              />
              <button className="link" aria-label="Delete feedback" onClick={() => remove(f)}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button className="link" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
        {showClosed ? 'Hide done & declined' : 'Show done & declined'}
      </button>
    </section>
  )
}

function AccessCodesSection() {
  const [codes, setCodes] = useState<AccessCodeRecord[]>([])
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const list = await pb.collection('access_codes').getFullList<AccessCodeRecord>({
      sort: '-created',
    })
    setCodes(list)
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await pb.collection('access_codes').create({
        code: code.trim().toUpperCase(),
        note: note.trim(),
        expires: expires ? `${expires} 23:59:59` : '',
        active: true,
      })
      setCode('')
      setNote('')
      setExpires('')
      setMessage('Code created. ✓')
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong (duplicate code?).')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(c: AccessCodeRecord) {
    await pb.collection('access_codes').update(c.id, { active: !c.active })
    await load()
  }

  async function remove(c: AccessCodeRecord) {
    if (!window.confirm(`Delete code ${c.code}?`)) return
    await pb.collection('access_codes').delete(c.id)
    await load()
  }

  async function share(c: AccessCodeRecord) {
    const result = await shareInvite(c.code, 'Glow Tape')
    setMessage(result === 'copied' ? 'Invite link copied.' : 'Shared!')
    setTimeout(() => setMessage(''), 3000)
  }

  const expired = (c: AccessCodeRecord) => !!c.expires && new Date(c.expires) < new Date()

  return (
    <section>
      <h2>Community access codes</h2>
      <p className="hint">
        Signup codes for people who aren't joining through a production — rotate them monthly
        or quarterly by adding a new one and deactivating the old.
      </p>
      <ul className="plain-list">
        {codes.map((c) => (
          <li key={c.id} className="row">
            <strong>{c.code}</strong>
            {c.note && <span className="hint">{c.note}</span>}
            <span className="hint">
              {!c.active ? 'inactive' : expired(c) ? 'expired' : 'active'}
              {c.expires ? ` · until ${formatDay(c.expires)}` : ''}
            </span>
            <button className="link" onClick={() => toggle(c)}>
              {c.active ? 'Deactivate' : 'Reactivate'}
            </button>
            <button
              className="link"
              aria-label={`Share invite link for ${c.code}`}
              onClick={() => share(c)}
            >
              📤
            </button>
            <button className="link" aria-label={`Delete code ${c.code}`} onClick={() => remove(c)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="row">
        <input
          aria-label="New code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Code — for example: HARBOR26"
        />
        <input
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note — for example: summer quarter"
        />
        <label>
          Expires
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || code.trim().length < 4}>
          Add code
        </button>
      </form>
      {message && <p className="acked" role="status">{message}</p>}
    </section>
  )
}

// Production requests: edit the details in place, then approve (creates the
// org, production, and their manager membership) or decline with a note.
function RequestsSection() {
  const [requests, setRequests] = useState<ProductionRequestRecord[]>([])
  const [orgNames, setOrgNames] = useState<string[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')

  async function load() {
    const [list, orgs] = await Promise.all([
      pb.collection('production_requests').getFullList<ProductionRequestRecord>({
        sort: '-created',
        expand: 'user',
      }),
      pb.collection('orgs').getFullList<OrgRecord>({ sort: 'name', fields: 'id,name' }),
    ])
    setRequests(list)
    setOrgNames(orgs.map((o) => o.name))
    setEmails(await fetchEmails(list.map((r) => r.user)))
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function saveField(r: ProductionRequestRecord, field: 'org' | 'title' | 'reply', value: string) {
    if (value === (r[field] ?? '')) return
    await pb.collection('production_requests').update(r.id, { [field]: value })
    await load()
  }

  async function approve(r: ProductionRequestRecord) {
    if (!window.confirm(`Create "${r.title}" at ${r.org} with ${r.expand?.user?.name} as manager?`))
      return
    setBusyId(r.id)
    setMessage('')
    try {
      const res = await pb.send('/api/glowtape/requests/approve', {
        method: 'POST',
        body: { request: r.id },
      })
      setMessage(`Created — join code ${res.joinCode}. The requester was emailed.`)
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusyId('')
    }
  }

  async function decline(r: ProductionRequestRecord) {
    await pb.collection('production_requests').update(r.id, { status: 'declined' })
    await load()
  }

  const open = requests.filter((r) => !r.status || r.status === 'new')
  if (requests.length === 0) return null

  return (
    <section>
      <h2>Production requests ({open.length} open)</h2>
      <p className="hint">
        Approving matches the organization <em>by exact name</em> — pick an existing one from
        the suggestions to add this show under it, or type a new name to create a new
        organization.
      </p>
      <datalist id="operator-org-names">
        {orgNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <ul className="plain-list">
        {requests.map((r) => (
          <li key={r.id} className="stack" style={{ marginBottom: '1rem' }}>
            <div>
              <strong>{r.expand?.user?.name}</strong>{' '}
              <span className="hint">
                {emails[r.user]} · {r.role} · {formatStamp(r.created)} ·{' '}
                {r.status || 'new'}
              </span>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              {r.timeline && <>Timeline: {r.timeline} · </>}
              {r.castSize && <>Cast: {r.castSize} · </>}
              {r.minors ? 'Includes minors 🛡️' : 'No minors expected'}
              {r.notes && (
                <>
                  <br />
                  {r.notes}
                </>
              )}
            </p>
            {(!r.status || r.status === 'new') && (
              <>
                <div className="row">
                  <input
                    aria-label="Organization"
                    list="operator-org-names"
                    defaultValue={r.org}
                    onBlur={(e) => saveField(r, 'org', e.target.value.trim())}
                  />
                  <input
                    aria-label="Show title"
                    defaultValue={r.title}
                    onBlur={(e) => saveField(r, 'title', e.target.value.trim())}
                  />
                </div>
                <div className="row">
                  <button onClick={() => approve(r)} disabled={busyId === r.id}>
                    {busyId === r.id ? 'Creating…' : '✓ Approve & create'}
                  </button>
                  <button className="link" onClick={() => decline(r)}>
                    Decline
                  </button>
                  <input
                    aria-label="Reply shown to the requester"
                    defaultValue={r.reply ?? ''}
                    onBlur={(e) => saveField(r, 'reply', e.target.value.trim())}
                    placeholder="Short note they'll see (optional)"
                  />
                </div>
              </>
            )}
            {r.status && r.status !== 'new' && (
              <span className="hint">
                {r.title} ({r.org}){r.reply ? ` · ${r.reply}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
      {message && <p className="acked" role="status">{message}</p>}
    </section>
  )
}
