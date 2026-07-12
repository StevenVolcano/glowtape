import { useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import type { MemberRecord } from '../lib/types.ts'
import { MANAGER_ROLES, ROLE_LABELS } from '../lib/types.ts'
import { memberName } from '../lib/types.ts'

export default function PeopleTab() {
  const { members } = useProduction()
  const { user } = useAuth()

  const myEditable = members.filter(
    (m) => m.user === user?.id || (m.minor && m.guardians?.includes(user?.id ?? '')),
  )

  const people = members.filter((m) => !(m.multi && !m.user))
  const sorted = [...people].sort((a, b) => {
    const aTeam = MANAGER_ROLES.includes(a.role) ? 0 : 1
    const bTeam = MANAGER_ROLES.includes(b.role) ? 0 : 1
    if (aTeam !== bTeam) return aTeam - bTeam
    return (a.expand?.user?.name || '').localeCompare(b.expand?.user?.name || '')
  })

  return (
    <section>
      {myEditable.map((m) => (
        <BioEditor key={m.id} member={m} />
      ))}
      <div className="row space-between">
        <h2>Contact sheet</h2>
        <button className="no-print" onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>
      <table className="contact-sheet">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Position / Character</th>
            <th>Email</th>
            <th>Phone</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.id}>
              <td>
                {m.minor ? (
                  <>
                    {memberName(m)} <em>(child)</em>
                  </>
                ) : m.user ? (
                  m.expand?.user?.name
                ) : (
                  <em>not cast yet</em>
                )}
              </td>
              <td>{ROLE_LABELS[m.role]}</td>
              <td>{m.position}</td>
              <td>
                {m.minor
                  ? (m.expand?.guardians ?? []).map((g) => `${g.name} (${g.email})`).join(', ') ||
                    '— via guardian —'
                  : m.expand?.user?.email}
              </td>
              <td>{m.minor ? '' : m.expand?.user?.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// Write/edit a program bio; saving also checks off the matching bio task.
function BioEditor({ member }: { member: MemberRecord }) {
  const { reload } = useProduction()
  const [bio, setBio] = useState(member.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')

  const whose = member.minor ? `${member.displayName}'s` : 'Your'

  async function save() {
    setBusy(true)
    setSaved('')
    try {
      await pb.collection('members').update(member.id, { bio: bio.trim() })
      if (bio.trim()) {
        try {
          const open = await pb.collection('tasks').getFullList({
            filter: pb.filter("assignee = {:m} && kind = 'bio' && done = false", { m: member.id }),
          })
          for (const t of open) await pb.collection('tasks').update(t.id, { done: true })
        } catch {
          /* no task to complete */
        }
      }
      setSaved('Saved — thank you! 🎭')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack bio-editor">
      <h2>{whose} program bio</h2>
      <p className="hint">
        Two to four sentences for the printed program — favorite past roles, who you'd like to
        thank, that sort of thing.
      </p>
      <textarea
        rows={4}
        maxLength={1200}
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder={
          member.minor
            ? `${member.displayName} is thrilled to make their Driftwood debut…`
            : 'Steven is delighted to return to the stage after…'
        }
      />
      <div className="row">
        <button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save bio'}
        </button>
        {saved && <span className="acked">{saved}</span>}
      </div>
    </div>
  )
}
