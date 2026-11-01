import type { TrackerItemRecord } from './types.ts'

// Column layout per tracker. Keys map to tracker_items fields; a blank label
// hides the column for that tracker. `physical` trackers are things you have
// to find and recognize (photos, "where it is", cards by default); cue sheets
// are paperwork and default to the grid.
export const TRACKERS = {
  props: {
    physical: true,
    label: 'Props',
    cols: { name: 'Item', a: 'Scene', b: 'Character', c: 'Source', where: 'Where it is', status: 'Status', notes: 'Notes' },
  },
  costumes: {
    physical: true,
    label: 'Costumes',
    cols: { name: 'Piece', a: 'Character', b: 'Scene', c: 'Source', where: 'Where it is', status: 'Status', notes: 'Notes' },
  },
  set: {
    physical: true,
    label: 'Set',
    cols: { name: 'Piece', a: 'Scene', b: '', c: 'Source', where: 'Where it is', status: 'Status', notes: 'Notes' },
  },
  light_cues: {
    physical: false,
    label: 'Light cues',
    cols: { name: 'Cue #', a: 'Page', b: 'Trigger / line', c: 'Action', where: '', status: '', notes: 'Notes' },
  },
  sound_cues: {
    physical: false,
    label: 'Sound cues',
    cols: { name: 'Cue #', a: 'Page', b: 'Trigger / line', c: 'Action', where: '', status: '', notes: 'Notes' },
  },
} as const

export type TrackerKey = keyof typeof TRACKERS
export type TrackerCol = 'name' | 'a' | 'b' | 'c' | 'where' | 'status' | 'notes'

export function visibleCols(tracker: TrackerKey): TrackerCol[] {
  return (Object.entries(TRACKERS[tracker].cols) as [TrackerCol, string][])
    .filter(([, label]) => label)
    .map(([key]) => key)
}

// --- CSV ------------------------------------------------------------------------

export function csvField(s: string): string {
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
  const hasWhere = wanted.some((w) => w.key === 'where')
  return header.map((h) => {
    const n = norm(h)
    if (hasWhere && /^(where|location|storage|stored|storedat|kept|keptin|bin|shelf)$/.test(n)) return 'where'
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

// --- Attachments -------------------------------------------------------------

export const MAX_ATTACHMENTS = 12

export function isImageFile(filename: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(filename)
}

// PocketBase stores "costume_plot_a1b2c3d4e5.pdf"; show "costume_plot.pdf".
export function displayFileName(filename: string): string {
  return filename.replace(/_[a-z0-9]{10}(\.[a-z0-9]+)$/i, '$1')
}

// Case-insensitive search across every visible column — "Emily" finds her
// costumes, "act 2" finds the act 2 props, "bin 4" finds what lives there.
export function matchesSearch(item: TrackerItemRecord, cols: TrackerCol[], q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = cols.map((c) => String(item[c] ?? '')).join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}
