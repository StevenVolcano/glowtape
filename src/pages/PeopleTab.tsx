import { useProduction } from './Production.tsx'
import { MANAGER_ROLES, ROLE_LABELS } from '../lib/types.ts'
import { memberName } from '../lib/types.ts'

// The contact sheet. Names and roles for everyone; email/phone columns are
// production-team only — cast reach each other through Messages.
export default function PeopleTab() {
  const { members, isManager } = useProduction()

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
        <h2>{isManager ? 'Contact sheet' : 'People'}</h2>
        <button className="no-print" onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>
      {!isManager && (
        <p className="hint">
          Who's who in the show. Contact details stay with the production team — the Messages
          tab (or your 🔒 team channel) is the way to reach people here.
        </p>
      )}
      <table className="contact-sheet">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Position / Character</th>
            {isManager && <th scope="col">Email</th>}
            {isManager && <th scope="col">Phone</th>}
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
                ) : m.displayName ? (
                  <>
                    {m.displayName} <em>(not on Glow Tape)</em>
                  </>
                ) : (
                  <em>not cast yet</em>
                )}
              </td>
              <td>{ROLE_LABELS[m.role]}</td>
              <td>{m.position}</td>
              {isManager && (
                <td>
                  {m.minor
                    ? (m.expand?.guardians ?? []).map((g) => `${g.name} (${g.email})`).join(', ') ||
                      '— via guardian —'
                    : m.expand?.user?.email || m.contactEmail}
                </td>
              )}
              {isManager && <td>{m.minor ? '' : m.expand?.user?.phone || m.contactPhone}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
