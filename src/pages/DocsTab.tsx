import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { openResourceFile } from '../lib/files.ts'
import { useProduction } from './Production.tsx'
import type { ResourceRecord } from '../lib/types.ts'

// The show's library: scripts, scores, rehearsal tracks, forms, links.
// PDFs open in the script room (read + notes + highlighter); everything is
// visible to the whole show except 🔒 team documents (server-enforced —
// non-managers never even receive them).
export default function DocsTab() {
  const { production, isManager } = useProduction()
  const [resources, setResources] = useState<ResourceRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const base = `/production/${production.id}`

  useEffect(() => {
    pb.collection('resources')
      .getFullList<ResourceRecord>({
        filter: pb.filter("production = {:p} && area = 'show'", { p: production.id }),
        sort: 'order,created',
      })
      .then(setResources)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [production.id])

  const isPdf = (r: ResourceRecord) => !!r.file && r.file.toLowerCase().endsWith('.pdf')

  return (
    <section>
      <h2>Documents &amp; links</h2>
      <p className="hint">
        The show's library — scripts, scores, rehearsal tracks, forms. Tap 📖 on any PDF to
        read it with notes and a highlighter (your marks are private to you).
      </p>
      {!loaded && <p>Loading…</p>}
      {loaded && resources.length === 0 && (
        <p className="hint">
          Nothing here yet.
          {isManager ? (
            <>
              {' '}
              Add documents in <Link to={`${base}/admin#resources`}>Manage → Documents &amp; links</Link>.
            </>
          ) : (
            ' The production team can post scripts, tracks, and forms here.'
          )}
        </p>
      )}
      <ul className="cards">
        {resources.map((r) => (
          <li key={r.id} className="card">
            <div className="event-head">
              <strong>
                {r.file ? '📄' : '🔗'} {r.title}
              </strong>
              {r.audience === 'team' && <span className="pill">🔒 team</span>}
            </div>
            <div className="row" style={{ marginTop: '0.4rem' }}>
              {isPdf(r) && (
                <Link className="link" to={`${base}/script/${r.id}`}>
                  📖 Read with notes
                </Link>
              )}
              {r.file ? (
                <button className="link" onClick={() => openResourceFile(r)}>
                  ⬇ Open the file
                </button>
              ) : (
                <a className="link" href={r.url} target="_blank" rel="noreferrer">
                  Open the link
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      {isManager && resources.length > 0 && (
        <p className="hint">
          Add, restrict, or remove documents in{' '}
          <Link to={`${base}/admin#resources`}>Manage → Documents &amp; links</Link>.
        </p>
      )}
    </section>
  )
}
