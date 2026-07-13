import { useEffect, useRef, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import { csvField, parseCsv } from '../lib/trackers.ts'
import {
  BREAKDOWN_STYLES,
  GROUP_LABELS,
  mapUnitHeaders,
  matchMember,
  peopleLine,
  splitPeople,
  unitInvolves,
  unitMemberIds,
  type BreakdownStyle,
  type UnitGroup,
} from '../lib/breakdown.ts'
import { memberName, pbDate } from '../lib/types.ts'
import type { EventRecord, MemberRecord, UnitRecord } from '../lib/types.ts'

// The show breakdown: songs, scenes, or page hunks, each knowing who's
// involved. This is what "who's called" hangs off when scheduling.
export default function BreakdownView() {
  const { production, members, myMember, isManager, reload } = useProduction()
  const { user } = useAuth()
  const [units, setUnits] = useState<UnitRecord[]>([])
  const [openId, setOpenId] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const style = (production.breakdownStyle || '') as BreakdownStyle | ''
  const config = style ? BREAKDOWN_STYLES[style] : null

  // People the breakdown can reference: real roles, not guardians or the
  // claimed copies of shared roles.
  const pool = members.filter((m) => m.role !== 'guardian' && !m.claimedFrom)
  const myChildIds = members.filter((m) => m.guardians?.includes(user?.id ?? '')).map((m) => m.id)

  async function load() {
    const list = await pb.collection('units').getFullList<UnitRecord>({
      filter: pb.filter('production = {:p}', { p: production.id }),
      sort: 'order,created',
    })
    setUnits(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  async function setStyle(next: string) {
    await pb.collection('productions').update(production.id, { breakdownStyle: next })
    await reload()
  }

  async function addUnit() {
    const rec = await pb.collection('units').create<UnitRecord>({
      production: production.id,
      name: `${config?.unit ?? 'Unit'} ${units.length + 1}`,
      order: units.length ? Math.max(...units.map((u) => u.order || 0)) + 1 : 1,
    })
    await load()
    setOpenId(rec.id)
  }

  async function saveUnit(unit: UnitRecord, patch: Partial<UnitRecord>) {
    await pb.collection('units').update(unit.id, patch)
    await load()
  }

  async function removeUnit(unit: UnitRecord) {
    if (!window.confirm(`Delete "${unit.name}"?`)) return
    await pb.collection('units').delete(unit.id)
    await load()
  }

  // The breakdown changed after events were scheduled? Recompute who's called
  // on every upcoming event that references units. Called-only changes go
  // through the update route silently (no emails, no ack resets).
  async function resyncSchedule() {
    const events = await pb.collection('events').getFullList<EventRecord>({
      filter: pb.filter("production = {:p} && status != 'cancelled'", { p: production.id }),
      sort: 'start',
    })
    const now = Date.now()
    const withUnits = events.filter(
      (e) => (e.units?.length ?? 0) > 0 && pbDate(e.start).getTime() >= now,
    )
    if (withUnits.length === 0) {
      setStatus('No upcoming events use breakdown units yet.')
      return
    }
    const items: { id: string; called: string[] }[] = []
    for (const e of withUnits) {
      const ids = new Set<string>()
      for (const u of units) {
        if (e.units.includes(u.id)) for (const m of unitMemberIds(u)) ids.add(m)
      }
      const next = [...ids].sort()
      const current = [...(e.called ?? [])].sort()
      if (JSON.stringify(next) !== JSON.stringify(current)) items.push({ id: e.id, called: next })
    }
    if (items.length === 0) {
      setStatus(`All ${withUnits.length} upcoming events already match the breakdown. ✓`)
      return
    }
    if (
      !window.confirm(
        `Recompute who's called on ${items.length} upcoming event${
          items.length === 1 ? '' : 's'
        } from the breakdown? Manual adjustments to those call lists will be replaced. Nobody is emailed.`,
      )
    )
      return
    await pb.send('/api/glowtape/events/update', { method: 'POST', body: { events: items } })
    setStatus(`Updated who's called on ${items.length} event${items.length === 1 ? '' : 's'}. ✓`)
  }

  function exportCsv() {
    if (!config) return
    const groups = config.groups as readonly UnitGroup[]
    const header = [config.unit, 'Act', 'Pages', ...groups.map((g) => GROUP_LABELS[g]), 'Notes']
    const rows = units.map((u) =>
      [
        u.name,
        u.act,
        u.pages,
        ...groups.map((g) => peopleLine(u[g] ?? [], members)),
        u.notes,
      ].map((c) => csvField(String(c ?? ''))),
    )
    const csv = [header.map(csvField).join(','), ...rows.map((r) => r.join(','))].join('\r\n')
    const blob = new Blob([csv + '\r\n'], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${production.title} — Breakdown.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importCsv(file: File) {
    if (!config) return
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      setStatus('That file needs a header row plus at least one unit.')
      return
    }
    const mapping = mapUnitHeaders(rows[0])
    if (!mapping.includes('name')) {
      setStatus(
        `Couldn't find a "${config.unit}" (or Name/Title) column in the headers: ${rows[0].join(', ')}`,
      )
      return
    }
    setStatus(`Importing ${rows.length - 1} units…`)
    const unmatched = new Set<string>()
    let base = units.length ? Math.max(...units.map((u) => u.order || 0)) + 1 : 1
    let imported = 0
    for (const row of rows.slice(1)) {
      const data: Record<string, unknown> = { production: production.id, order: base++ }
      row.forEach((cell, i) => {
        const col = mapping[i]
        if (!col) return
        if (col === 'onstage' || col === 'singing' || col === 'dancing') {
          const ids: string[] = []
          for (const token of splitPeople(cell)) {
            const m = matchMember(token, pool)
            if (m) ids.push(m.id)
            else unmatched.add(token)
          }
          data[col] = ids
        } else {
          data[col] = cell.trim()
        }
      })
      if (!data.name) continue
      await pb.collection('units').create(data)
      imported++
    }
    await load()
    setStatus(
      `Imported ${imported} units. ✓` +
        (unmatched.size
          ? ` Didn't recognize: ${[...unmatched].slice(0, 12).join(', ')}${
              unmatched.size > 12 ? '…' : ''
            } — add those as roles in Manage → People & roles, then re-import or fix by hand.`
          : ''),
    )
  }

  if (!style) {
    return (
      <section>
        <h3 className="dept-heading">Show breakdown</h3>
        {isManager ? (
          <>
            <p className="hint">
              Break the show into pieces so scheduling can call exactly the right people. Pick
              the shape that fits this show:
            </p>
            <div className="chips">
              {(Object.keys(BREAKDOWN_STYLES) as BreakdownStyle[]).map((s) => (
                <button key={s} className="chip" onClick={() => setStyle(s)}>
                  {BREAKDOWN_STYLES[s].label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="hint">The production team hasn't set up the breakdown yet.</p>
        )}
      </section>
    )
  }

  const visible = onlyMine
    ? units.filter(
        (u) =>
          (myMember && unitInvolves(u, myMember)) ||
          myChildIds.some((id) => unitMatchesId(u, id, members)),
      )
    : units

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h3 className="dept-heading">Show breakdown — {BREAKDOWN_STYLES[style].label}</h3>
        {isManager && (
          <select
            aria-label="Breakdown style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            style={{ width: 'auto' }}
          >
            {(Object.keys(BREAKDOWN_STYLES) as BreakdownStyle[]).map((s) => (
              <option key={s} value={s}>
                {BREAKDOWN_STYLES[s].label}
              </option>
            ))}
          </select>
        )}
      </div>

      {units.length > 0 && (myMember || myChildIds.length > 0) && (
        <button
          className={`chip ${onlyMine ? 'chip-active' : ''}`}
          aria-pressed={onlyMine}
          onClick={() => setOnlyMine(!onlyMine)}
        >
          {onlyMine ? 'Showing yours — tap for all' : 'Just mine'}
        </button>
      )}

      {units.length === 0 && (
        <p className="hint">
          {isManager
            ? 'Add units below, or import a CSV — a spreadsheet with columns like Song, Act, On stage, Singing, Dancing. People are matched by role/character name from People & roles.'
            : 'Nothing here yet.'}
        </p>
      )}
      {onlyMine && visible.length === 0 && units.length > 0 && (
        <p className="hint">You're not in any units yet — lucky you, or check with the SM.</p>
      )}

      <ul className="plain-list">
        {visible.map((u) => (
          <li key={u.id} style={{ marginBottom: '0.5rem' }}>
            <button
              className="link"
              aria-expanded={openId === u.id}
              onClick={() => setOpenId(openId === u.id ? '' : u.id)}
            >
              {openId === u.id ? '▾' : '▸'} <strong>{u.name}</strong>
            </button>{' '}
            <span className="hint">
              {[u.act, u.pages && `pp. ${u.pages}`].filter(Boolean).join(' · ')}
            </span>
            <div className="hint" style={{ marginLeft: '1.2rem' }}>
              {peopleLine(u.onstage ?? [], members) || 'Nobody yet'}
            </div>
            {openId === u.id && (
              <UnitEditor
                unit={u}
                pool={pool}
                members={members}
                groups={BREAKDOWN_STYLES[style].groups as readonly UnitGroup[]}
                canEdit={isManager}
                onSave={(patch) => saveUnit(u, patch)}
                onDelete={() => removeUnit(u)}
              />
            )}
          </li>
        ))}
      </ul>

      {isManager && (
        <div className="row no-print" style={{ flexWrap: 'wrap' }}>
          <button onClick={addUnit}>+ Add {BREAKDOWN_STYLES[style].unit.toLowerCase()}</button>
          <button onClick={() => fileRef.current?.click()}>⬆ Import CSV</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) importCsv(f).catch(() => setStatus('Import failed — sorry.'))
            }}
          />
          {units.length > 0 && <button onClick={exportCsv}>⬇ Export CSV</button>}
          {units.length > 0 && (
            <button onClick={() => resyncSchedule().catch(() => setStatus('Sync failed — sorry.'))}>
              ↻ Re-sync the schedule
            </button>
          )}
        </div>
      )}
      {status && <p className="hint" role="status">{status}</p>}
      {isManager && units.length > 0 && (
        <p className="hint">
          When adding to the schedule, pick units on the event form and the right people get
          called automatically.
        </p>
      )}
    </section>
  )
}

function unitMatchesId(u: UnitRecord, memberId: string, members: MemberRecord[]): boolean {
  const m = members.find((x) => x.id === memberId)
  return !!m && unitInvolves(u, m)
}

function UnitEditor({
  unit,
  pool,
  members,
  groups,
  canEdit,
  onSave,
  onDelete,
}: {
  unit: UnitRecord
  pool: MemberRecord[]
  members: MemberRecord[]
  groups: readonly UnitGroup[]
  canEdit: boolean
  onSave: (patch: Partial<UnitRecord>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(unit.name)
  const [act, setAct] = useState(unit.act)
  const [pages, setPages] = useState(unit.pages)
  const [notes, setNotes] = useState(unit.notes)
  const [picks, setPicks] = useState<Record<UnitGroup, string[]>>({
    onstage: unit.onstage ?? [],
    singing: unit.singing ?? [],
    dancing: unit.dancing ?? [],
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')

  function toggle(group: UnitGroup, id: string) {
    setPicks((prev) => ({
      ...prev,
      [group]: prev[group].includes(id)
        ? prev[group].filter((x) => x !== id)
        : [...prev[group], id],
    }))
  }

  async function save() {
    setBusy(true)
    setSaved('')
    try {
      await onSave({ name: name.trim() || unit.name, act, pages, notes, ...picks })
      setSaved('Saved. ✓')
      setTimeout(() => setSaved(''), 3000)
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) {
    return (
      <div className="stack" style={{ margin: '0.3rem 0 0.8rem 1.2rem' }}>
        {groups.map(
          (g) =>
            (unit[g]?.length ?? 0) > 0 && (
              <p key={g} className="hint" style={{ margin: 0 }}>
                <strong>{GROUP_LABELS[g]}:</strong> {peopleLine(unit[g], members)}
              </p>
            ),
        )}
        {unit.notes && <p className="hint" style={{ margin: 0 }}>{unit.notes}</p>}
      </div>
    )
  }

  return (
    <div className="stack" style={{ margin: '0.3rem 0 0.8rem 1.2rem' }}>
      <div className="row">
        <input
          aria-label="Unit name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="Act"
          value={act}
          maxLength={60}
          onChange={(e) => setAct(e.target.value)}
          placeholder="Act"
        />
        <input
          aria-label="Pages"
          value={pages}
          maxLength={60}
          onChange={(e) => setPages(e.target.value)}
          placeholder="Pages — for example: 12–18"
        />
      </div>
      {groups.map((g) => (
        <div key={g}>
          <strong>{GROUP_LABELS[g]}</strong>
          <div className="chips">
            {pool.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`chip ${picks[g].includes(m.id) ? 'chip-active' : ''}`}
                aria-pressed={picks[g].includes(m.id)}
                onClick={() => toggle(g, m.id)}
              >
                {m.position || memberName(m)}
              </button>
            ))}
          </div>
        </div>
      ))}
      <input
        aria-label="Notes"
        value={notes}
        maxLength={400}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes — entrances, exits, quick changes…"
      />
      <div className="row">
        <button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="link" aria-label={`Delete ${unit.name}`} onClick={onDelete}>
          ✕
        </button>
        {saved && <span className="acked" role="status">{saved}</span>}
      </div>
    </div>
  )
}
