import { useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import type { EventRecord, ShowReportRecord } from '../lib/types.ts'

// The stage manager's performance report as a two-minute phone form. One
// report per performance; the first save emails the whole production team
// (the traditional distribution), later edits just update the record.
// Production-team-only — cast never see it.
export default function ShowReport({ event }: { event: EventRecord }) {
  const { production } = useProduction()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [existing, setExisting] = useState<ShowReportRecord | null>(null)
  const [audience, setAudience] = useState('')
  const [houseOpen, setHouseOpen] = useState('')
  const [curtainUp, setCurtainUp] = useState('')
  const [curtainDown, setCurtainDown] = useState('')
  const [technical, setTechnical] = useState('')
  const [incidents, setIncidents] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')

  async function openForm() {
    setBusy(true)
    try {
      const rows = await pb.collection('show_reports').getFullList<ShowReportRecord>({
        filter: pb.filter('event = {:e}', { e: event.id }),
      })
      const r = rows[0] ?? null
      setExisting(r)
      setAudience(r?.audience ? String(r.audience) : '')
      setHouseOpen(r?.houseOpen ?? '')
      setCurtainUp(r?.curtainUp ?? '')
      setCurtainDown(r?.curtainDown ?? '')
      setTechnical(r?.technical ?? '')
      setIncidents(r?.incidents ?? '')
      setNotes(r?.notes ?? '')
      setSaved('')
      setOpen(true)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setSaved('')
    try {
      const data = {
        production: production.id,
        event: event.id,
        author: user!.id,
        audience: audience ? Number(audience) : 0,
        houseOpen,
        curtainUp,
        curtainDown,
        technical: technical.trim(),
        incidents: incidents.trim(),
        notes: notes.trim(),
      }
      if (existing) {
        await pb.collection('show_reports').update(existing.id, data)
        setSaved('Updated.')
      } else {
        const r = await pb.collection('show_reports').create<ShowReportRecord>(data)
        setExisting(r)
        setSaved('Saved — the production team was emailed a copy.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button className="link" disabled={busy} onClick={openForm}>
        📋 Show report
      </button>
    )
  }

  return (
    <div className="card stack">
      <strong>📋 Show report — {event.title}</strong>
      <p className="hint" style={{ margin: 0 }}>
        Two minutes after curtain call. Only the production team sees this; saving it emails
        everyone on the team.
      </p>
      <div className="row">
        <label>
          Audience
          <input
            type="number"
            min={0}
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Example: 142"
            style={{ width: '6rem' }}
          />
        </label>
        <label>
          House open
          <input type="time" value={houseOpen} onChange={(e) => setHouseOpen(e.target.value)} />
        </label>
        <label>
          Curtain up
          <input type="time" value={curtainUp} onChange={(e) => setCurtainUp(e.target.value)} />
        </label>
        <label>
          Curtain down
          <input
            type="time"
            value={curtainDown}
            onChange={(e) => setCurtainDown(e.target.value)}
          />
        </label>
      </div>
      <label>
        Anything technical go sideways?
        <textarea
          rows={2}
          maxLength={2000}
          value={technical}
          onChange={(e) => setTechnical(e.target.value)}
          placeholder="Example: mic 4 dropped out in the storm scene — swapped at intermission"
        />
      </label>
      <label>
        Injuries or incidents?
        <textarea
          rows={2}
          maxLength={2000}
          value={incidents}
          onChange={(e) => setIncidents(e.target.value)}
          placeholder="Example: none"
        />
      </label>
      <label>
        How did it go?
        <textarea
          rows={2}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Example: strong house, best pacing yet — act ran 100 minutes"
        />
      </label>
      <div className="row">
        <button type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save & email the team'}
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Close
        </button>
        {saved && <span className="acked" role="status">{saved}</span>}
      </div>
    </div>
  )
}
