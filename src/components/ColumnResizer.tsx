import { useEffect, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { readPref, writePref } from './ScheduleViews.tsx'

// Spreadsheet-style column widths: drag the edge of a header (mouse or
// finger), or focus it and use the arrow keys. Widths live in this browser
// only (localStorage), so each person sizes the sheet for their own screen.
export const MIN_COL = 48
const MAX_COL = 900
const STEP = 16

export type ColWidths = Record<string, number>

function load(key: string): ColWidths {
  try {
    const raw = readPref(key)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    const out: ColWidths = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && v >= MIN_COL) out[k] = Math.min(v, MAX_COL)
    }
    return out
  } catch {
    return {}
  }
}

export function useColumnWidths(storageKey: string) {
  const [widths, setWidths] = useState<ColWidths>(() => load(storageKey))
  useEffect(() => setWidths(load(storageKey)), [storageKey])

  function save(next: ColWidths) {
    setWidths(next)
    writePref(storageKey, JSON.stringify(next))
  }

  function reset() {
    setWidths({})
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // storage blocked — the in-memory reset still applies
    }
  }

  return { widths, save, reset, sized: Object.keys(widths).length > 0 }
}

const clamp = (w: number) => Math.round(Math.min(MAX_COL, Math.max(MIN_COL, w)))

// Before the first resize the table is auto-sized; freeze every column at
// its current rendered width so dragging one doesn't reflow the others.
function measured(table: HTMLTableElement | null, cols: string[], widths: ColWidths): ColWidths {
  const out: ColWidths = { ...widths }
  const ths = table?.querySelectorAll<HTMLTableCellElement>('thead th[data-col]') ?? []
  ths.forEach((th) => {
    const c = th.dataset.col
    if (c && cols.includes(c) && !out[c]) out[c] = clamp(th.getBoundingClientRect().width)
  })
  return out
}

export default function ColumnResizer({
  col,
  label,
  cols,
  tableRef,
  widths,
  onChange,
}: {
  col: string
  label: string
  cols: string[]
  tableRef: RefObject<HTMLTableElement | null>
  widths: ColWidths
  onChange: (next: ColWidths) => void
}) {
  const [dragging, setDragging] = useState(false)
  const current = widths[col]

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const base = measured(tableRef.current, cols, widths)
    const startX = e.clientX
    const startW = base[col] ?? MIN_COL
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    setDragging(true)
    onChange(base)

    function move(ev: globalThis.PointerEvent) {
      onChange({ ...base, [col]: clamp(startW + ev.clientX - startX) })
    }
    function up() {
      setDragging(false)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === 'ArrowRight' ? STEP : e.key === 'ArrowLeft' ? -STEP : 0
    if (!delta) return
    e.preventDefault()
    const base = measured(tableRef.current, cols, widths)
    onChange({ ...base, [col]: clamp((base[col] ?? MIN_COL) + delta) })
  }

  return (
    <div
      className={`col-resizer no-print${dragging ? ' col-resizer-active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label} column`}
      aria-valuenow={current ? Math.round(current) : undefined}
      aria-valuemin={MIN_COL}
      aria-valuemax={MAX_COL}
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
