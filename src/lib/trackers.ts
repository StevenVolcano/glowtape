import type { TrackerItemRecord } from './types.ts'

// Column layout per tracker. Keys map to tracker_items fields; a blank label
// hides the column for that tracker.
export const TRACKERS = {
  props: {
    label: 'Props',
    cols: { name: 'Item', a: 'Scene', b: 'Character', c: 'Source', status: 'Status', notes: 'Notes' },
  },
  costumes: {
    label: 'Costumes',
    cols: { name: 'Piece', a: 'Character', b: 'Scene', c: 'Source', status: 'Status', notes: 'Notes' },
  },
  set: {
    label: 'Set',
    cols: { name: 'Piece', a: 'Scene', b: '', c: 'Source', status: 'Status', notes: 'Notes' },
  },
  light_cues: {
    label: 'Light cues',
    cols: { name: 'Cue #', a: 'Page', b: 'Trigger / line', c: 'Action', status: '', notes: 'Notes' },
  },
  sound_cues: {
    label: 'Sound cues',
    cols: { name: 'Cue #', a: 'Page', b: 'Trigger / line', c: 'Action', status: '', notes: 'Notes' },
  },
} as const

export type TrackerKey = keyof typeof TRACKERS
export type TrackerCol = 'name' | 'a' | 'b' | 'c' | 'status' | 'notes'

export function visibleCols(tracker: TrackerKey): TrackerCol[] {
  return (Object.entries(TRACKERS[tracker].cols) as [TrackerCol, string][])
    .filter(([, label]) => label)
    .map(([key]) => key)
}

// --- CSV ------------------------------------------------------------------------

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(tracker: TrackerKey, items: TrackerItemRecord[]): string {
  const cols = visibleCols(tracker)
  const header = cols.map((c) => TRACKERS[tracker].cols[c]).join(',')
  const rows = items.map((it) => cols.map((c) => csvField(String(it[c] ?? ''))).join(','))
  return [header, ...rows].join('\r\n') + '\r\n'
}

// Small, forgiving CSV parser: quoted fields, embedded commas/newlines/quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

// Map an imported header row onto our columns by loose label matching.
export function mapHeaders(tracker: TrackerKey, header: string[]): (TrackerCol | null)[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]/g, '')
  const wanted = visibleCols(tracker).map((key) => ({
    key,
    label: norm(TRACKERS[tracker].cols[key]),
  }))
  return header.map((h) => {
    const n = norm(h)
    const hit =
      wanted.find((w) => w.label === n) ||
      wanted.find((w) => n.includes(w.label) || w.label.includes(n))
    return hit ? hit.key : null
  })
}

export function orderFor(name: string): number {
  const n = parseFloat(name)
  return Number.isFinite(n) ? n : 0
}
