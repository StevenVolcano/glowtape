import { useState } from 'react'
import { useProduction } from './Production.tsx'
import { MANAGER_ROLES, memberName } from '../lib/types.ts'

// The compiled program document: every bio in one printable, copy-able page.
export default function BiosView() {
  const { production, members } = useProduction()
  const [copied, setCopied] = useState(false)

  const people = members
    .filter((m) => m.role !== 'guardian' && !(m.multi && !m.user) && (m.user || m.minor))
    .sort((a, b) => {
      const rank = (m: (typeof members)[number]) =>
        m.role === 'performer' ? 0 : MANAGER_ROLES.includes(m.role) ? 1 : 2
      return rank(a) - rank(b) || memberName(a).localeCompare(memberName(b))
    })

  const line = (m: (typeof members)[number]) =>
    `${memberName(m)}${m.position ? ` (${m.position})` : ''}`

  async function copyAll() {
    const text = people
      .filter((m) => (m.bio ?? '').trim())
      .map((m) => `${line(m)}\n${m.bio.trim()}`)
      .join('\n\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const missing = people.filter((m) => !(m.bio ?? '').trim())

  return (
    <section>
      <div className="row space-between no-print">
        <h2>Program bios — {production.title}</h2>
        <div className="row">
          <button onClick={copyAll}>{copied ? 'Copied ✓' : '📋 Copy all'}</button>
          <button onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>
      {missing.length > 0 && (
        <p className="hint no-print">
          Still missing: {missing.map((m) => memberName(m)).join(', ')}
        </p>
      )}
      <div className="bios-doc">
        {people
          .filter((m) => (m.bio ?? '').trim())
          .map((m) => (
            <div key={m.id} className="bio-entry">
              <strong>{line(m)}</strong>
              <p>{m.bio.trim()}</p>
            </div>
          ))}
        {people.every((m) => !(m.bio ?? '').trim()) && (
          <p className="hint">No bios yet — request them from the Manage tab.</p>
        )}
      </div>
    </section>
  )
}
