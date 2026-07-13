import { useProduction } from './Production.tsx'
import { MANAGER_ROLES, ROLE_LABELS } from '../lib/types.ts'
import { memberName } from '../lib/types.ts'

export default function PeopleTab() {
  const { members } = useProduction()

  const people = members.filter((m) => !(m.multi && !m.user))
  const sorted = [...people].sort((a, b) => {
    const aTeam = MANAGER_ROLES.includes(a.role) ? 0 : 1
    const bTeam = MANAGER_ROLES.includes(b.role) ? 0 : 1
    if (aTeam !== bTeam) return aTeam - bTeam
    return (a.expand?.user?.name || '').localeCompare(b.expand?.user?.name || '')
  })

  return (
    <section>
      <div className="row space-between">
        <h2>Contact sheet</h2>
        <button className="no-print" onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>
      <table className="contact-sheet">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Position / Character</th>
            <th scope="col">Email</th>
            <th scope="col">Phone</th>
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
