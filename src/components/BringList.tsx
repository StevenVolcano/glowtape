import { useEffect, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import { pbErrorMessage } from '../lib/files.ts'
import { firstLastInitial } from '../lib/types.ts'
import type { BringItemRecord, EventRecord } from '../lib/types.ts'

// The potluck sign-up on an event card: "I'll bring cookies" under Desserts.
// Everyone sees who's bringing what (that's the point — no five bags of
// chips); you can remove your own item, managers can tidy anything.
export default function BringList({ event }: { event: EventRecord }) {
  const { production, isManager } = useProduction()
  const { user } = useAuth()
  const categories = event.bringCategories ?? []
  const [items, setItems] = useState<BringItemRecord[]>([])
  const [item, setItem] = useState('')
  const [category, setCategory] = useState(categories[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const list = await pb.collection('bring_items').getFullList<BringItemRecord>({
      filter: pb.filter('event = {:e}', { e: event.id }),
      expand: 'user',
      sort: 'created',
    })
    setItems(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id])

  async function add() {
    if (!item.trim()) return
    setBusy(true)
    setErr('')
    try {
      await pb.collection('bring_items').create({
        production: production.id,
        event: event.id,
        user: user!.id,
        item: item.trim(),
        category: category || categories[0] || '',
      })
      setItem('')
      await load()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't add that — try again."))
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: BringItemRecord) {
    try {
      await pb.collection('bring_items').delete(row.id)
      await load()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't remove that — try again."))
    }
  }

  const who = (row: BringItemRecord) =>
    row.expand?.user?.name ? firstLastInitial(row.expand.user.name) : 'someone'

  const grouped = categories.map((c) => ({
    name: c,
    rows: items.filter((i) => i.category === c),
  }))
  const uncategorized = items.filter((i) => !categories.includes(i.category))

  return (
    <div className="stack" style={{ marginTop: '0.4rem' }}>
      <strong>🍪 Who's bringing what</strong>
      {items.length === 0 && (
        <p className="hint" style={{ margin: 0 }}>
          Nothing signed up yet — be the first!
        </p>
      )}
      {grouped
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <div key={g.name}>
            <span className="hint">{g.name}:</span>{' '}
            {g.rows.map((row, i) => (
              <span key={row.id}>
                {i > 0 && ', '}
                {row.item} <span className="hint">({who(row)})</span>
                {(row.user === user?.id || isManager) && (
                  <button
                    type="button"
                    className="link"
                    aria-label={`Remove ${row.item}`}
                    onClick={() => remove(row)}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        ))}
      {uncategorized.length > 0 && (
        <div>
          <span className="hint">Other:</span>{' '}
          {uncategorized.map((row, i) => (
            <span key={row.id}>
              {i > 0 && ', '}
              {row.item} <span className="hint">({who(row)})</span>
              {(row.user === user?.id || isManager) && (
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove ${row.item}`}
                  onClick={() => remove(row)}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <input
          aria-label="What you'll bring"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Example: cookies"
          style={{ flex: 1, minWidth: '8rem' }}
        />
        {categories.length > 0 && (
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <button type="button" disabled={busy || !item.trim()} onClick={add}>
          I'll bring it
        </button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  )
}
