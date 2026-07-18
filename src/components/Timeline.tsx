import { useEffect, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useProduction } from '../pages/Production.tsx'
import { pbDate } from '../lib/types.ts'
import type { EventRecord, TimelineItem, TimelineTemplateRecord } from '../lib/types.ts'

// Run-of-show planner. Segments carry durations, never clock times — the
// clock column is computed forward from the event start, so changing one
// duration shifts everything after it. Three starter templates ship here;
// any plan can be saved as a named per-production template.

export const STARTER_TEMPLATES: { name: string; items: TimelineItem[] }[] = [
  {
    name: 'Rehearsal',
    items: [
      { title: 'Cast meeting', minutes: 5 },
      { title: 'Warmups', minutes: 10 },
      { title: 'Work a scene', minutes: 30 },
      { title: 'Run it', minutes: 20 },
      { title: 'Break', minutes: 10 },
      { title: 'Work the next scene', minutes: 30 },
      { title: 'Notes', minutes: 15 },
    ],
  },
  {
    name: 'Performance night',
    items: [
      { title: 'Call — sign in at the door', minutes: 15 },
      { title: 'Warmups', minutes: 15 },
      { title: 'Sound check', minutes: 15 },
      { title: 'Fight / dance call', minutes: 10 },
      { title: 'Get dressed, mics on', minutes: 20 },
      { title: 'House opens', minutes: 25 },
      { title: 'Places', minutes: 5 },
      { title: 'Curtain up', minutes: 0 },
    ],
  },
  {
    name: 'Tech',
    items: [
      { title: 'Cast meeting', minutes: 10 },
      { title: 'Walk the space, safety notes', minutes: 15 },
      { title: 'Cue-to-cue', minutes: 90 },
      { title: 'Break', minutes: 10 },
      { title: 'Run the act', minutes: 60 },
      { title: 'Notes', minutes: 20 },
    ],
  },
]

const clock = (d: Date) => {
  let h = d.getHours()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${ampm}`
}

// Computed clock time for each row, rolling forward from the event start.
function rowTimes(start: Date, items: TimelineItem[]): string[] {
  const out: string[] = []
  let t = start.getTime()
  for (const item of items) {
    out.push(clock(new Date(t)))
    t += (Number(item.minutes) || 0) * 60000
  }
  return out
}

// Cast-facing view: a collapsed line that opens into the full run of show.
export function TimelineView({ event }: { event: EventRecord }) {
  const [open, setOpen] = useState(false)
  const items = event.timeline ?? []
  if (items.length === 0) return null
  const times = rowTimes(pbDate(event.start), items)
  return (
    <div>
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⏱ {open ? 'Hide the timeline' : `Timeline (${items.length} parts)`}
      </button>
      {open && (
        <ul className="plain-list">
          {items.map((item, i) => (
            <li key={i}>
              <strong>{times[i]}</strong> — {item.title}
              {item.minutes > 0 && <span className="hint"> ({item.minutes} min)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// One printable line: "⏱ 7:00pm Call · 7:15pm Warmups · …"
export function timelineLine(event: EventRecord): string {
  const items = event.timeline ?? []
  if (items.length === 0) return ''
  const times = rowTimes(pbDate(event.start), items)
  return items.map((item, i) => `${times[i]} ${item.title}`).join(' · ')
}

// Manager editor.
export default function TimelinePlanner({
  event,
  onSaved,
}: {
  event: EventRecord
  onSaved: () => Promise<void>
}) {
  const { production } = useProduction()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<TimelineItem[]>(event.timeline ?? [])
  const [templates, setTemplates] = useState<TimelineTemplateRecord[]>([])
  const [templateName, setTemplateName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [saveErr, setSaveErr] = useState('')

  useEffect(() => {
    if (!open) return
    pb.collection('timeline_templates')
      .getFullList<TimelineTemplateRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'name',
      })
      .then(setTemplates)
      .catch(() => {})
  }, [open, production.id])

  const start = pbDate(event.start)
  const times = rowTimes(start, items)
  const totalMin = items.reduce((sum, i) => sum + (Number(i.minutes) || 0), 0)
  const finish = new Date(start.getTime() + totalMin * 60000)
  const overruns = !!event.end && finish.getTime() > pbDate(event.end).getTime()

  const patch = (i: number, p: Partial<TimelineItem>) =>
    setItems((prev) => prev.map((item, j) => (j === i ? { ...item, ...p } : item)))
  const move = (i: number, dir: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  async function save() {
    setBusy(true)
    setSaved('')
    setSaveErr('')
    try {
      const clean = items
        .filter((i) => i.title.trim())
        .map((i) => ({ title: i.title.trim(), minutes: Math.max(0, Number(i.minutes) || 0) }))
      await pb.collection('events').update(event.id, { timeline: clean })
      setItems(clean)
      setSaved('Saved — everyone sees it on the event.')
      await onSaved()
    } catch {
      setSaveErr("Couldn't save the timeline — try again.")
    } finally {
      setBusy(false)
    }
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) return
    setBusy(true)
    setSaveErr('')
    try {
      await pb.collection('timeline_templates').create({
        production: production.id,
        name: templateName.trim(),
        items: items.filter((i) => i.title.trim()),
      })
      setTemplateName('')
      const list = await pb.collection('timeline_templates').getFullList<TimelineTemplateRecord>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        sort: 'name',
      })
      setTemplates(list)
      setSaved('Template saved for this production.')
    } catch {
      setSaveErr("Couldn't save the template — try again.")
    } finally {
      setBusy(false)
    }
  }

  function applyTemplate(value: string) {
    if (!value) return
    const starter = STARTER_TEMPLATES.find((t) => `starter:${t.name}` === value)
    if (starter) {
      setItems(starter.items.map((i) => ({ ...i })))
      return
    }
    const t = templates.find((t) => t.id === value)
    if (t) setItems((t.items ?? []).map((i) => ({ ...i })))
  }

  if (!open) {
    return (
      <button className="link" onClick={() => setOpen(true)}>
        ⏱ {(event.timeline ?? []).length > 0 ? 'Edit the timeline' : 'Plan the timeline'}
      </button>
    )
  }

  return (
    <div className="card stack">
      <strong>⏱ Timeline — {event.title}</strong>
      <p className="hint" style={{ margin: 0 }}>
        Enter what happens and for how long — the clock times work themselves out from the
        event's start, so changing one duration shifts everything after it.
      </p>
      <label>
        Start from a template
        <select aria-label="Start from a template" value="" onChange={(e) => applyTemplate(e.target.value)}>
          <option value="">— pick one (replaces the rows below) —</option>
          {STARTER_TEMPLATES.map((t) => (
            <option key={t.name} value={`starter:${t.name}`}>
              {t.name} (built in)
            </option>
          ))}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <ul className="plain-list">
        {items.map((item, i) => (
          <li key={i} className="row" style={{ alignItems: 'center' }}>
            <span className="hint" style={{ minWidth: '4.6rem' }}>
              {times[i]}
            </span>
            <input
              aria-label={`Part ${i + 1}`}
              value={item.title}
              onChange={(e) => patch(i, { title: e.target.value })}
              placeholder="What happens"
              style={{ flex: 1, minWidth: '10rem' }}
            />
            <input
              aria-label={`Minutes for part ${i + 1}`}
              type="number"
              min={0}
              value={item.minutes}
              onChange={(e) => patch(i, { minutes: Number(e.target.value) })}
              style={{ width: '4.2rem' }}
            />
            <span className="hint">min</span>
            <button type="button" className="link" aria-label="Move up" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="link" aria-label="Move down" onClick={() => move(i, 1)}>
              ↓
            </button>
            <button
              type="button"
              className="link"
              aria-label={`Remove ${item.title || 'row'}`}
              onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          type="button"
          className="link"
          onClick={() => setItems((prev) => [...prev, { title: '', minutes: 10 }])}
        >
          + Add a part
        </button>
      </div>
      {items.length > 0 && (
        <p className={overruns ? 'error' : 'hint'} style={{ margin: 0 }}>
          {totalMin} minutes total — finishes about {clock(finish)}
          {overruns ? " — that's past the event's end time." : '.'}
        </p>
      )}
      <div className="row">
        <button type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save the timeline'}
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Close
        </button>
        {saved && <span className="acked" role="status">{saved}</span>}
        {saveErr && <span className="error" role="alert">{saveErr}</span>}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <input
          aria-label="Template name"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Save these rows as a template — name it"
          style={{ flex: 1, minWidth: '12rem' }}
        />
        <button type="button" className="link" disabled={busy || !templateName.trim()} onClick={saveAsTemplate}>
          Save as a template
        </button>
      </div>
    </div>
  )
}
