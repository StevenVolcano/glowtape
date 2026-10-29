import type { EventRecord, MemberRecord } from './types.ts'

// RSVP is on by default for parties and potlucks only (Steven 2026-10-29):
// rehearsals and performances are calls, not invitations. Managers can tick
// it on for anything else. Mirrors lib.rsvpDefault in pb_hooks/glowtape_lib.js.
export const rsvpDefault = (kind: string) => /party|potluck/i.test(kind)

export const RSVP_ANSWERS = [
  { value: 'yes', label: '🎉 Going' },
  { value: 'maybe', label: '🤔 Maybe' },
  { value: 'no', label: "😢 Can't go" },
] as const

// Who's on the guest list: the people called (empty = everyone), minus parent
// rows (parents come as their child's guests) and unclaimed shared-role
// placeholders (whoever claimed it answers on their own row).
export function invitees(e: EventRecord, members: MemberRecord[]): MemberRecord[] {
  const called = new Set(e.called)
  return members.filter(
    (m) =>
      m.role !== 'guardian' &&
      !(m.multi && !m.user) &&
      (called.size === 0 || called.has(m.id) || (!!m.claimedFrom && called.has(m.claimedFrom))),
  )
}

// The invitees this account answers for: their own row and their children's.
export function myInvitees(e: EventRecord, members: MemberRecord[], userId: string): MemberRecord[] {
  return invitees(e, members).filter((m) => m.user === userId || m.guardians?.includes(userId))
}
