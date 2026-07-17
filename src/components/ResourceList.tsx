import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { openResourceFile } from '../lib/files.ts'
import type { ResourceRecord } from '../lib/types.ts'

// Read-only list of a production's documents and links for one area
// ('show' on the Schedule tab, 'audition' on the audition form).
export default function ResourceList({
  productionId,
  area,
}: {
  productionId: string
  area: 'show' | 'audition'
}) {
  const [resources, setResources] = useState<ResourceRecord[]>([])

  useEffect(() => {
    pb.collection('resources')
      .getFullList<ResourceRecord>({
        filter: pb.filter('production = {:p} && area = {:a}', { p: productionId, a: area }),
        sort: 'order,created',
      })
      .then(setResources)
      .catch(() => {})
  }, [productionId, area])

  if (resources.length === 0) return null

  return (
    <section>
      <h2>{area === 'audition' ? 'Audition materials' : 'Resources'}</h2>
      <ul className="plain-list">
        {resources.map((r) => (
          <li key={r.id}>
            {r.file ? (
              <button className="link" onClick={() => openResourceFile(r)}>
                📄 {r.title}
              </button>
            ) : (
              <a className="link" href={r.url} target="_blank" rel="noreferrer">
                🔗 {r.title}
              </a>
            )}
            {r.audience === 'team' && <span className="pill">🔒 team</span>}
            {area === 'show' && r.file?.toLowerCase().endsWith('.pdf') && (
              <>
                {' '}
                <Link className="link" to={`/production/${productionId}/script/${r.id}`}>
                  📖 Open with notes
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
