import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import { memberName, pbDate } from '../lib/types.ts'
import type { AttendanceRecord, EventRecord, MemberRecord } from '../lib/types.ts'

// 🕒 Running late / 😷 Can't make it, from 24 hours before a call until six
// hours after it starts — for you and any called children you guard. Shared
// by the schedule card and the Dashboard's Next up card; the caller owns the
// attendance rows and reloads them after a report.
export default function SelfReport({
  event,
  attendance,
  onReported,
}: {
  event: EventRecord
  attendance: AttendanceRecord[]
  onReported: () => void | Promise<void>
}) {
  const { members, myMember } = useProduction()
  const { user } = useAuth()

  const hoursUntil = (pbDate(event.start).getTime() - Date.now()) / 3600e3
  if (event.status === 'cancelled' || hoursUntil > 24 || hoursUntil < -6) return null
  const calledIds = new Set(event.called)
  const isCalled = (m: MemberRecord) =>
    event.called.length === 0 ||
    calledIds.has(m.id) ||
    (!!m.claimedFrom && calledIds.has(m.claimedFrom))
  const reportable: MemberRecord[] = []
  if (myMember && isCalled(myMember)) reportable.push(myMember)
  for (const m of members) {
    if (m.id !== myMember?.id && m.guardians?.includes(user?.id ?? '') && isCalled(m)) reportable.push(m)
  }
  if (reportable.length === 0) return null

  async function report(status: 'late' | 'absent', member: MemberRecord) {
    const note = window.prompt(
      status === 'late'
        ? 'Anything to add? (e.g. "there by 7:20") — optional'
        : 'Anything to add? (e.g. "sick") — optional',
    )
    if (note === null) return
    await pb.send('/api/glowtape/attendance/report', {
      method: 'POST',
      body: { event: event.id, status, note, member: member.id },
    })
    await onReported()
  }

  return (
    <>
      {reportable.map((m) => {
        const isMe = m.id === myMember?.id
        const name = isMe ? 'You' : m.displayName || memberName(m)
        const att = attendance.find((a) => a.event === event.id && a.member === m.id)
        if (att && att.status !== 'present')
          return (
            <div key={m.id} className="hint">
              {name} reported: {att.status === 'late' ? 'running late' : "can't make it"}
              {att.note ? ` — ${att.note}` : ''} (your team was alerted)
            </div>
          )
        return (
          <div key={m.id} className="row">
            {!isMe && <span className="hint">{name}:</span>}
            <button className="link" onClick={() => report('late', m)}>
              🕒 Running late
            </button>
            <button className="link" onClick={() => report('absent', m)}>
              😷 Can't make it
            </button>
          </div>
        )
      })}
    </>
  )
}
