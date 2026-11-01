import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useFileToken } from '../lib/files.ts'
import { useProduction } from './Production.tsx'
import {
  TRACKERS,
  isImageFile,
  mapHeaders,
  matchesSearch,
  orderFor,
  parseCsv,
  toCsv,
  visibleCols,
  type TrackerCol,
  type TrackerKey,
} from '../lib/trackers.ts'
import type { TrackerItemRecord } from '../lib/types.ts'
import BreakdownView from '../components/BreakdownView.tsx'
import ColumnResizer, { useColumnWidths } from '../components/ColumnResizer.tsx'
import { SheetList, SheetItemSheet, fileUrl, statusTone } from '../components/SheetCards.tsx'

// The multi-tab Google Sheet, replaced: props, costumes, set, and cue
// paperwork live here. Two views of the same rows: the LIST (phone in the
// field — slim color-coded rows, tap one for the full card) and the TABLE
// (computer, spreadsheet people). Managers edit in either; everyone else reads.
type SheetKey = 'breakdown' | TrackerKey
type SheetView = 'list' | 'table'

// No stored choice → the list on a phone-sized screen, the table on a computer.
// Cue sheets are paperwork, so they start as a table everywhere.
function readSort(tracker: TrackerKey): TrackerCol | '' {
  try {
    const v = localStorage.getItem(`gt-sheet-sort-${tracker}`) ?? ''
    return (visibleCols(tracker) as string[]).includes(v) ? (v as TrackerCol) : ''
  } catch {
    return ''
  }
}

function readView(tracker: TrackerKey): SheetView {
  try {
    const v = localStorage.getItem(`gt-sheet-view-${tracker}`)
    if (v === 'list' || v === 'table') return v
  } catch {
    /* private mode */
  }
  if (!TRACKERS[tracker].physical) return 'table'
  return window.matchMedia?.('(min-width: 900px)').matches ? 'table' : 'list'
}

export default function TrackersTab() {
  const { production, isManager } = useProduction()
  const [sheet, setSheet] = useState<SheetKey>('breakdown')
  const tracker = sheet === 'breakdown' ? 'props' : sheet
  const [items, setItems] = useState<TrackerItemRecord[]>([])
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const colWidths = useColumnWidths(`gt-colwidths-${production.id}-${tracker}`)
  const [view, setViewState] = useState<SheetView>(() => readView(tracker))
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [only, setOnly] = useState('') // "<col>\u0000<value>" or ''
  const [sortBy, setSortByState] = useState<TrackerCol | ''>(() => readSort(tracker))
  const [openId, setOpenId] = useState('')
  const [newId, setNewId] = useState('')
  const { token, refresh: refreshToken } = useFileToken()

  function setSortBy(v: TrackerCol | '') {
    setSortByState(v)
    try {
      localStorage.setItem(`gt-sheet-sort-${tracker}`, v)
    } catch {
      /* private mode */
    }
  }

  function setView(v: SheetView) {
    setViewState(v)
    try {
      localStorage.setItem(`gt-sheet-view-${tracker}`, v)
    } catch {
      /* private mode */
    }
  }

  async function load(t: TrackerKey = tracker) {
    const list = await pb.collection('tracker_items').getFullList<TrackerItemRecord>({
      filter: pb.filter('production = {:p} && tracker = {:t}', { p: production.id, t }),
      sort: 'order,created',
    })
    setItems(list)
    if (list.some((it) => it.attachments?.length)) refreshToken()
  }

  useEffect(() => {
    setStatus('')
    setQuery('')
    setStatusFilter('')
    setOnly('')
    setOpenId('')
    if (sheet !== 'breakdown') {
      setViewState(readView(sheet))
      setSortByState(readSort(sheet))
    }
    if (sheet !== 'breakdown') load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id, sheet])

  const cols = visibleCols(tracker)
  const labels = TRACKERS[tracker].cols
  const hasStatus = cols.includes('status')
  // Distinct statuses in use (case-insensitive), for the filter chips.
  const statuses = hasStatus
    ? [...new Map(items.filter((it) => it.status).map((it) => [it.status.toLowerCase(), it.status])).values()].sort()
    : []
  // "Show only" choices: every distinct value in the describing columns
  // (Character, Scene, Where it is…), grouped by column.
  const onlyCols = cols.filter((c) => c === 'a' || c === 'b' || c === 'c' || c === 'where')
  const onlyOptions = onlyCols
    .map((c) => ({
      col: c,
      values: [
        ...new Map(
          items.filter((it) => (it[c] ?? '').trim()).map((it) => [it[c].trim().toLowerCase(), it[c].trim()]),
        ).values(),
      ].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })),
    }))
    .filter((g) => g.values.length > 1 && g.values.length <= 80)
  const [onlyCol, onlyVal] = (only ? only.split('\u0000') : ['', '']) as [TrackerCol | '', string]
  const shown = items
    .filter(
      (it) =>
        matchesSearch(it, cols, query) &&
        (!statusFilter || (it.status ?? '').toLowerCase() === statusFilter.toLowerCase()) &&
        (!onlyCol || (it[onlyCol] ?? '').trim().toLowerCase() === onlyVal.toLowerCase()),
    )
    .sort((x, y) => {
      if (!sortBy) return 0 // already in sheet order from the server
      const ax = (x[sortBy] ?? '').trim()
      const ay = (y[sortBy] ?? '').trim()
      if (!ax !== !ay) return ax ? -1 : 1 // blanks last
      return ax.localeCompare(ay, undefined, { numeric: true, sensitivity: 'base' })
    })
  const filtering = !!(query || statusFilter || only)
  const openItem = items.find((it) => it.id === openId)
  // Once any column has been sized, every column gets a fixed width so the
  // table stops auto-fitting; the files and ✕ columns keep fixed slots.
  const ACTIONS_W = 56
  const FILES_W = 72
  const sizedWidth = colWidths.sized
    ? cols.reduce((sum, c) => sum + (colWidths.widths[c] ?? 120), 0) +
      FILES_W +
      (isManager ? ACTIONS_W : 0)
    : undefined

  function replaceItem(updated: TrackerItemRecord) {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
    if (updated.attachments?.length) refreshToken()
  }

  async function saveCell(item: TrackerItemRecord, col: TrackerCol, value: string) {
    // Read the freshest copy — the full-screen editor saves field by field.
    const current = items.find((it) => it.id === item.id) ?? item
    if (value === (current[col] ?? '')) return
    const patch: Record<string, string | number> = { [col]: value }
    // Cue numbers keep cue sheets in cue order; a word name ("Ladder") keeps
    // the row where it was (it used to drop to the top as 0).
    if (col === 'name' && Number.isFinite(parseFloat(value))) patch.order = orderFor(value)
    const updated = await pb.collection('tracker_items').update<TrackerItemRecord>(item.id, patch)
    replaceItem(updated)
  }

  async function addRow() {
    try {
      const created = await pb.collection('tracker_items').create<TrackerItemRecord>({
        production: production.id,
        tracker,
        order: items.length ? Math.max(...items.map((it) => it.order || 0)) + 1 : 1,
      })
      setQuery('')
      setStatusFilter('')
      setOnly('')
      setItems((prev) => [...prev, created])
      // A new row opens as a full card so you can name it and snap its
      // photo right away (on the table you can still just type in the row).
      setNewId(created.id)
      setOpenId(created.id)
    } catch {
      setStatus('Couldn’t add a row — try again?')
    }
  }

  // Managers arrange the sheet order by hand from the full card. Neighbors
  // swap places; tied orders (old imports) get renumbered once.
  async function move(item: TrackerItemRecord, dir: -1 | 1) {
    const i = items.findIndex((it) => it.id === item.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    const tied = new Set(items.map((it) => it.order || 0)).size < items.length
    const updates: [TrackerItemRecord, number][] = tied
      ? next.map((it, k) => [it, k + 1] as [TrackerItemRecord, number]).filter(([it, o]) => it.order !== o)
      : [
          [items[i], items[j].order],
          [items[j], items[i].order],
        ]
    const ord = new Map(updates.map(([it, o]) => [it.id, o]))
    setItems(next.map((it) => (ord.has(it.id) ? { ...it, order: ord.get(it.id)! } : it)))
    try {
      for (const [it, o] of updates) await pb.collection('tracker_items').update(it.id, { order: o })
    } catch {
      setStatus('Couldn’t save the new order — try again?')
      await load()
    }
  }

  async function remove(item: TrackerItemRecord): Promise<boolean> {
    if (!window.confirm(`Delete "${item.name || 'this row'}"${item.attachments?.length ? ' and its photos and files' : ''}?`))
      return false
    try {
      await pb.collection('tracker_items').delete(item.id)
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      return true
    } catch {
      setStatus('Couldn’t delete that row — try again?')
      return false
    }
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
          <button
            className={`chip ${sheet === 'breakdown' ? 'chip-active' : ''}`}
            aria-pressed={sheet === 'breakdown'}
            onClick={() => setSheet('breakdown')}
          >
            Breakdown
          </button>
          {(Object.keys(TRACKERS) as TrackerKey[]).map((t) => (
            <button
              key={t}
              className={`chip ${sheet === t ? 'chip-active' : ''}`}
              aria-pressed={sheet === t}
              onClick={() => setSheet(t)}
            >
              {TRACKERS[t].label}
            </button>
          ))}
        </div>

        {sheet === 'breakdown' && <BreakdownView />}
        {sheet !== 'breakdown' && (
        <>
        <h3 className="dept-heading">
          {TRACKERS[tracker].label} — {production.title}
        </h3>

        <div className="chips no-print" role="group" aria-label="Show as">
          <button
            className={`chip ${view === 'list' ? 'chip-active' : ''}`}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            ☰ List
          </button>
          <button
            className={`chip ${view === 'table' ? 'chip-active' : ''}`}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            ▦ Table
          </button>
          {isManager && (
            <button className="sheet-add" onClick={addRow}>
              + Add one
            </button>
          )}
        </div>

        {items.length > 0 && (
          <div className="sheet-find no-print">
            <label className="sr-only" htmlFor={`sheet-search-${tracker}`}>
              Search {TRACKERS[tracker].label.toLowerCase()}
            </label>
            <input
              id={`sheet-search-${tracker}`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                TRACKERS[tracker].physical
                  ? 'Search — for example: a name, a scene, or "bin 4"'
                  : 'Search — for example: a cue number or a line'
              }
            />
            {statuses.length > 1 && (
              <div className="chips" role="group" aria-label="Filter by status">
                <button
                  className={`chip ${statusFilter === '' ? 'chip-active' : ''}`}
                  aria-pressed={statusFilter === ''}
                  onClick={() => setStatusFilter('')}
                >
                  All
                </button>
                {statuses.map((st) => (
                  <button
                    key={st}
                    className={`chip ${statusFilter.toLowerCase() === st.toLowerCase() ? 'chip-active' : ''}`}
                    aria-pressed={statusFilter.toLowerCase() === st.toLowerCase()}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st}
                  </button>
                ))}
              </div>
            )}
            <div className="row sheet-arrange">
              <label>
                Sort by
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as TrackerCol | '')}>
                  <option value="">Sheet order</option>
                  {cols.map((c) => (
                    <option key={c} value={c}>
                      {labels[c]}
                    </option>
                  ))}
                </select>
              </label>
              {onlyOptions.length > 0 && (
                <label>
                  Show only
                  <select value={only} onChange={(e) => setOnly(e.target.value)}>
                    <option value="">Everything</option>
                    {onlyOptions.map((g) => (
                      <optgroup key={g.col} label={labels[g.col]}>
                        {g.values.map((v) => (
                          <option key={v} value={`${g.col}\u0000${v}`}>
                            {v}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {filtering && (
              <p className="hint" role="status">
                Showing {shown.length} of {items.length}.{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setQuery('')
                    setStatusFilter('')
                    setOnly('')
                  }}
                >
                  Show everything
                </button>
              </p>
            )}
          </div>
        )}

        {items.length === 0 && (
          <p className="hint">
            Nothing here yet.
            {isManager
              ? ' Tap “+ Add” above, or import the matching tab of your old Google Sheet as a CSV below.'
              : ' The managers haven’t filled this in yet.'}
          </p>
        )}

        {view === 'list' && shown.length > 0 && (
          <SheetList
            tracker={tracker}
            items={shown}
            token={token}
            refreshToken={refreshToken}
            onOpen={(it) => {
              setNewId('')
              setOpenId(it.id)
            }}
          />
        )}

        {view === 'table' && shown.length > 0 && (
          <div className="edit-table">
            <table
              ref={tableRef}
              className={colWidths.sized ? 'cols-sized' : undefined}
              style={sizedWidth ? { width: sizedWidth } : undefined}
            >
              {colWidths.sized && (
                <colgroup>
                  <col style={{ width: FILES_W }} />
                  {cols.map((c) => (
                    <col key={c} style={{ width: colWidths.widths[c] ?? 120 }} />
                  ))}
                  {isManager && <col style={{ width: ACTIONS_W }} />}
                </colgroup>
              )}
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Photos and files</span>
                    <span aria-hidden="true">📎</span>
                  </th>
                  {cols.map((c) => (
                    <th key={c} scope="col" data-col={c} className="resizable-th">
                      {labels[c]}
                      <ColumnResizer
                        col={c}
                        label={labels[c]}
                        cols={cols}
                        tableRef={tableRef}
                        widths={colWidths.widths}
                        onChange={colWidths.save}
                      />
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
                {shown.map((item) => {
                  const files = item.attachments ?? []
                  const cover = files.find(isImageFile)
                  const what = item.name || 'this row'
                  return (
                    <tr key={`${tracker}-${item.id}`}>
                      <td className="sheet-files-cell">
                        {(files.length > 0 || isManager) && (
                          <button
                            type="button"
                            className="sheet-thumb"
                            onClick={() => {
                              setNewId('')
                              setOpenId(item.id)
                            }}
                            aria-label={
                              files.length
                                ? `${files.length} ${files.length === 1 ? 'file' : 'files'} on ${what} — open`
                                : `Add a photo or file to ${what}`
                            }
                          >
                            {cover && token ? (
                              <img
                                src={fileUrl(item, cover, token, '240x240')}
                                alt=""
                                loading="lazy"
                                onError={refreshToken}
                              />
                            ) : files.length ? (
                              `📎${files.length}`
                            ) : (
                              <span className="no-print">＋</span>
                            )}
                          </button>
                        )}
                      </td>
                      {cols.map((c) => (
                        <td
                          key={c}
                          className={
                            c === 'status' && statusTone(item.status ?? '')
                              ? `tone-cell tone-${statusTone(item.status ?? '')}`
                              : undefined
                          }
                        >
                          {isManager ? (
                            <input
                              aria-label={labels[c]}
                              defaultValue={item[c] ?? ''}
                              onBlur={(e) =>
                                saveCell(item, c, e.target.value.trim()).catch(() =>
                                  setStatus('That change didn’t save — try again?'),
                                )
                              }
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
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {openItem && (
          <SheetItemSheet
            key={openItem.id}
            tracker={tracker}
            item={openItem}
            token={token}
            refreshToken={refreshToken}
            isManager={isManager}
            isNew={openItem.id === newId}
            onSaveField={saveCell}
            onSaved={replaceItem}
            onDelete={remove}
            onMove={
              isManager && !sortBy
                ? (dir) => move(openItem, dir)
                : undefined
            }
            position={items.findIndex((it) => it.id === openItem.id)}
            count={items.length}
            onClose={() => setOpenId('')}
          />
        )}

        <div className="row no-print" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
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
              {colWidths.sized && (
                <button onClick={colWidths.reset}>↔ Reset column widths</button>
              )}
            </>
          )}
        </div>
        {status && <p className="hint" role="status">{status}</p>}

        {isManager && (
          <p className="hint no-print">
            The list is made for your phone: tap a row for its full card to see and edit everything,
            add photos straight from the camera, or attach a PDF. The table is the spreadsheet view of the same rows —
            drag the edge of a column heading to resize it (it remembers on this device), and tap a
            cell to edit. Changes save on their own. Coming from Google Sheets? In your
            sheet: File → Download → Comma Separated Values, one tab at a time, then import it
            here. Starting from nothing? An AI chat can draft every sheet from your script —{' '}
            <a href="/breakdown-ai.html" target="_blank" rel="noreferrer">
              here's how, prompt included
            </a>
            .
          </p>
        )}
        </>
        )}
      </section>
    </div>
  )
}
