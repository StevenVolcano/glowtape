// @mentions in show chat. The message text carries a readable "@Anna K." or
// "@Cast"; messages.mentionMembers / mentionGroups carry who that means, and
// the server pings exactly those people (and a child's guardians), even when
// they muted the channel. DMs and the community board have no mentions.
import { ROLE_LABELS, firstLastInitial, memberName } from './types.ts'
import type { ChannelRecord, GroupRecord, MemberRecord } from './types.ts'

export interface MentionTarget {
  kind: 'member' | 'group'
  id: string
  label: string // what goes after the @ in the text
  hint: string // shown beside it in the picker, e.g. "Golde" or "12 people"
}

// Who can be tagged in this channel: only people who can read it (a tag on
// anyone else would ping nobody). One row per person — the non-guardian row
// wins for a parent who is also in the cast. Children (no login) are taggable
// because their guardians get the ping; unclaimed roles are not.
export function mentionTargets(
  channel: ChannelRecord,
  members: MemberRecord[],
  groups: GroupRecord[],
  me: string,
): MentionTarget[] {
  if (!channel.production || (channel.dmUsers ?? []).length) return []
  const owner = channel.member ? members.find((m) => m.id === channel.member) : undefined
  const canRead = (m: MemberRecord) => {
    if (m.manager) return true
    if (channel.audience === 'team') return false
    if (channel.member) {
      if (!owner) return false
      return m.id === owner.id || (!!m.user && (m.user === owner.user || owner.guardians.includes(m.user)))
    }
    if (channel.group) return (m.groups ?? []).includes(channel.group)
    return true
  }

  const people: MentionTarget[] = []
  const seenUser = new Set<string>()
  const sorted = [...members].sort((a, b) => (a.role === 'guardian' ? 1 : 0) - (b.role === 'guardian' ? 1 : 0))
  for (const m of sorted) {
    if (!m.user && !(m.guardians ?? []).length) continue
    if (m.user === me) continue
    if (m.user && seenUser.has(m.user)) continue
    if (!canRead(m)) continue
    if (m.user) seenUser.add(m.user)
    people.push({
      kind: 'member',
      id: m.id,
      label: firstLastInitial(memberName(m)),
      hint: m.position || ROLE_LABELS[m.role] || '',
    })
  }
  people.sort((a, b) => a.label.localeCompare(b.label))

  const shown = channel.audience === 'team' || channel.member
    ? []
    : groups.filter((g) => !channel.group || g.id === channel.group)
  // An empty group would ping nobody, so it isn't offered.
  const groupTargets = shown.flatMap((g) => {
    const n = members.filter((m) => (m.groups ?? []).includes(g.id)).length
    if (n === 0) return []
    return {
      kind: 'group' as const,
      id: g.id,
      label: g.name.replace(/^🔒\s*/, ''),
      hint: g.auto === 'cast' ? 'everyone in the cast' : `${n} ${n === 1 ? 'person' : 'people'}`,
    }
  })
  // Groups first: "@Cast" is the one most people reach for.
  return [...groupTargets, ...people]
}

// The "@query" being typed right before the caret, if any. Names have a
// space in them ("Anna K."), so the query may too — up to 25 characters.
export function activeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null // an email address
  const query = before.slice(at + 1)
  if (query.length > 25 || /\n|@/.test(query)) return null
  return { start: at, query }
}

export function matchTargets(targets: MentionTarget[], query: string, limit = 6): MentionTarget[] {
  const q = query.trim().toLowerCase()
  if (!q) return targets.slice(0, limit)
  return targets
    .filter((t) => {
      const words = `${t.label} ${t.hint}`.toLowerCase()
      return words.startsWith(q) || words.split(/\s+/).some((w) => w.startsWith(q))
    })
    .slice(0, limit)
}

// Only keep tags whose "@label" is still in the text when it's sent (people
// delete words while typing).
export function keptMentions(text: string, picked: MentionTarget[]) {
  const kept = picked.filter((t) => text.includes(`@${t.label}`))
  const ids = (kind: MentionTarget['kind']) => [...new Set(kept.filter((t) => t.kind === kind).map((t) => t.id))]
  return { mentionMembers: ids('member'), mentionGroups: ids('group') }
}

// Split message text into plain parts and "@label" parts for the tags it
// actually carries. Longest labels first so "@Anna K." beats "@Anna".
export function splitMentions(text: string, labels: string[]): { text: string; mention: boolean }[] {
  const uniq = [...new Set(labels.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!uniq.length) return [{ text, mention: false }]
  const escaped = uniq.map((l) => `@${l}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'g')
  return text
    .split(re)
    .filter((p) => p !== '')
    .map((p) => ({ text: p, mention: uniq.some((l) => p === `@${l}`) }))
}
