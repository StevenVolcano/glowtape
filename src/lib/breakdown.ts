import { memberName } from './types.ts'
import type { MemberRecord, UnitRecord } from './types.ts'

// Breakdown styles: what a "unit" of the show is called and which people
// groups it tracks. Musicals get singing/dancing on top of on-stage.
export const BREAKDOWN_STYLES = {
  songs: {
    label: 'By song (musical)',
    unit: 'Song',
    groups: ['onstage', 'singing', 'dancing'] as const,
  },
  scenes: {
    label: 'By scene',
    unit: 'Scene',
    groups: ['onstage'] as const,
  },
  pages: {
    label: 'By pages / hunks',
    unit: 'Pages',
    groups: ['onstage'] as const,
  },
}

export type BreakdownStyle = keyof typeof BREAKDOWN_STYLES
export type UnitGroup = 'onstage' | 'singing' | 'dancing'

export const GROUP_LABELS: Record<UnitGroup, string> = {
  onstage: 'On stage',
  singing: 'Singing',
  dancing: 'Dancing',
}

// Everyone a unit involves, across all its groups.
export function unitMemberIds(unit: UnitRecord): string[] {
  return [...new Set([...(unit.onstage ?? []), ...(unit.singing ?? []), ...(unit.dancing ?? [])])]
}

// Members whose role belongs to any of the given role-groups.
export function groupMemberIds(groupIds: string[], members: MemberRecord[]): string[] {
  if (groupIds.length === 0) return []
  return members.filter((m) => (m.groups ?? []).some((g) => groupIds.includes(g))).map((m) => m.id)
}

// unitMemberIds plus everyone pulled in by the unit's role-groups.
export function resolveUnitMemberIds(unit: UnitRecord, members: MemberRecord[]): string[] {
  return [...new Set([...unitMemberIds(unit), ...groupMemberIds(unit.groups ?? [], members)])]
}

// Does this unit involve the given member (directly or via a claimed shared
// role)?
export function unitInvolves(unit: UnitRecord, m: MemberRecord): boolean {
  const ids = unitMemberIds(unit)
  return (
    ids.includes(m.id) ||
    (!!m.claimedFrom && ids.includes(m.claimedFrom)) ||
    (unit.groups ?? []).some((g) => (m.groups ?? []).includes(g))
  )
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Match one person-cell token ("Tevye", "Golde", "ensemble") to a member row
// by character/position, child display name, or account name.
export function matchMember(token: string, members: MemberRecord[]): MemberRecord | null {
  const n = norm(token)
  if (!n) return null
  const candidates = members.filter((m) => !m.claimedFrom) // placeholders own the identity
  return (
    candidates.find((m) => norm(m.position) === n) ??
    candidates.find((m) => norm(m.displayName) === n) ??
    candidates.find((m) => norm(m.expand?.user?.name ?? '') === n) ??
    candidates.find((m) => !!m.position && (norm(m.position).includes(n) || n.includes(norm(m.position)))) ??
    null
  )
}

// Split a people cell: "Tevye, Golde; Ensemble" -> tokens.
export function splitPeople(cell: string): string[] {
  return cell
    .split(/[,;/]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

// Map an imported header row onto unit fields by loose label matching.
// Returns null for columns we don't understand (they're ignored).
export type UnitCol = 'name' | 'act' | 'pages' | 'onstage' | 'singing' | 'dancing' | 'notes'

const HEADER_ALIASES: Record<UnitCol, string[]> = {
  name: ['name', 'song', 'scene', 'unit', 'number', 'title', 'hunk'],
  act: ['act'],
  pages: ['pages', 'page', 'pp'],
  onstage: ['onstage', 'stage', 'cast', 'who', 'characters', 'inscene', 'insong', 'people'],
  singing: ['singing', 'sing', 'singers', 'vocals', 'vocal'],
  dancing: ['dancing', 'dance', 'dancers', 'movement', 'choreo', 'choreography'],
  notes: ['notes', 'note', 'comments', 'entrancesexits', 'entrances', 'dialogue'],
}

export function mapUnitHeaders(header: string[]): (UnitCol | null)[] {
  return header.map((h) => {
    const n = norm(h)
    if (!n) return null
    for (const [col, aliases] of Object.entries(HEADER_ALIASES) as [UnitCol, string[]][]) {
      if (aliases.some((a) => n === a || n.includes(a))) return col
    }
    return null
  })
}

export function peopleLine(ids: string[], members: MemberRecord[]): string {
  return ids
    .map((id) => {
      const m = members.find((x) => x.id === id)
      return m ? m.position || memberName(m) : ''
    })
    .filter(Boolean)
    .join(', ')
}
