import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useProduction } from './Production.tsx'
import {
  TRACKERS,
  mapHeaders,
  orderFor,
  parseCsv,
  toCsv,
  visibleCols,
  type TrackerCol,
  type TrackerKey,
} from '../lib/trackers.ts'
import type { TrackerItemRecord } from '../lib/types.ts'

// The multi-tab Google Sheet, replaced: props, costumes, set, and cue
// paperwork live here. Managers edit right in the table; everyone else reads.
export default function TrackersTab() {
  const { production, isManager } = useProduction()
  const [tracker, setTracker] = useState<TrackerKey>('props')
  const [items, setItems] = useState<TrackerItemRecord[]>([])
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function load(t: TrackerKey = tracker) {
    const list = await pb.collection('tracker_items').getFullList<TrackerItemRecord>({
      filter: pb.filter('production = {:p} && tracker = {:t}', { p: production.id, t }),
      sort: 'order,created',
    })
    setItems(list)
  }

  useEffect(() => {
    setStatus('')
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id, tracker])

  const cols = visibleCols(tracker)
  const labels = TRACKERS[tracker].cols

  async function saveCell(item: TrackerItemRecord, col: TrackerCol, value: string) {
    if (value === (item[col] ?? '')) return
    const patch: Record<string, string | number> = { [col]: value }
    if (col === 'name') patch.order = orderFor(value)
    const updated = await pb.collection('tracker_items').update<TrackerItemRecord>(item.id, patch)
    setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)))
  }

  async function addRow() {
    await pb.collection('tracker_items').create({
      production: production.id,
      tracker,
      order: items.length ? Math.max(...items.map((it) => it.order || 0)) + 1 : 1,
    })
    await load()
  }

  async function remove(item: TrackerItemRecord) {
    if (!window.confirm(`Delete "${item.name || 'this row'}"?`)) return
    await pb.collection('tracker_items').delete(item.id)
    setItems((prev) => prev.filter((it) => it.id !== item.id))
  }

  function exportCsv() {
    const csv = toCsv(tracker, items)
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${production.title} — ${TRACKERS[tracker].label}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      setStatus('That file looks empty — it needs a header row plus at least one row.')
      return
    }
    const mapping = mapHeaders(tracker, rows[0])
    if (!mapping.some(Boolean)) {
      setStatus(
        `Couldn't match any columns. Expected headers like: ${cols
          .map((c) => labels[c])
          .join(', ')}.`,
      )
      return
    }
    setStatus(`Importing ${rows.length - 1} rows…`)
    let base = items.length ? Math.max(...items.map((it) => it.order || 0)) + 1 : 1
    let imported = 0
    for (const row of rows.slice(1)) {
      const data: Record<string, string | number> = { production: production.id, tracker }
      row.forEach((cell, i) => {
        const col = mapping[i]
        if (col) data[col] = cell.trim()
      })
      if (!cols.some((c) => data[c])) continue
      data.order = data.name ? orderFor(String(data.name)) || base : base
      base++
      await pb.collection('tracker_items').create(data)
      imported++
    }
    setStatus(`Imported ${imported} rows. ✓`)
    await load()
  }

  return (
    <div>
      <section>
        <h2>Sheets</h2>
        <div className="chips no-print">
          {(Object.keys(TRACKERS) as TrackerKey[]).map((t) => (
            <button
              key={t}
              className={`chip ${tracker === t ? 'chip-active' : ''}`}
              aria-pressed={tracker === t}
              onClick={() => setTracker(t)}
            >
              {TRACKERS[t].label}
            </button>
          ))}
        </div>

        <h3 className="dept-heading">
          {TRACKERS[tracker].label} — {production.title}
        </h3>

        {items.length === 0 && (
          <p className="hint">
            Nothing here yet.
            {isManager
              ? ' Add rows below, or import the matching tab of your old Google Sheet as a CSV.'
              : ' The production team hasn’t filled this in yet.'}
          </p>
        )}

        {items.length > 0 && (
          <div className="edit-table">
            <table>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c} scope="col">
                      {labels[c]}
                    </th>
                  ))}
                  {isManager && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${tracker}-${item.id}`}>
                    {cols.map((c) => (
                      <td key={c}>
                        {isManager ? (
                          <input
                            aria-label={labels[c]}
                            defaultValue={item[c] ?? ''}
                            onBlur={(e) => saveCell(item, c, e.target.value.trim())}
                          />
                        ) : (
                          item[c]
                        )}
                      </td>
                    ))}
                    {isManager && (
                      <td>
                        <button
                          className="link no-print"
                          aria-label={`Delete ${item.name || 'row'}`}
                          onClick={() => remove(item)}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row no-print" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
          {isManager && <button onClick={addRow}>+ Add row</button>}
          {isManager && (
            <>
              <button onClick={() => fileRef.current?.click()}>
                ⬆ Import CSV
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => importCsv(e).catch(() => setStatus('Import failed — sorry.'))}
              />
            </>
          )}
          {items.length > 0 && (
            <>
              <button onClick={exportCsv}>
                ⬇ Export CSV
              </button>
              <button onClick={() => window.print()}>
                🖨 Print
              </button>
            </>
          )}
        </div>
        {status && <p className="hint" role="status">{status}</p>}

        {isManager && (
          <p className="hint no-print">
            Tap a cell to edit — changes save on their own. Coming from Google Sheets? In your
            sheet: File → Download → Comma Separated Values, one tab at a time, then import it
            here.
          </p>
        )}
      </section>
    </div>
  )
}
