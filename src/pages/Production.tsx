import { createContext, useContext, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import type { MemberRecord, ProductionRecord } from '../lib/types.ts'
import ScheduleTab from './ScheduleTab.tsx'
import MessagesTab from './MessagesTab.tsx'
import PeopleTab from './PeopleTab.tsx'
import TasksTab from './TasksTab.tsx'
import BiosView from './BiosView.tsx'
import AdminTab from './AdminTab.tsx'

export interface ProductionContextValue {
  production: ProductionRecord
  members: MemberRecord[]
  myMember: MemberRecord | null
  isManager: boolean
  reload: () => Promise<void>
}

const ProductionContext = createContext<ProductionContextValue | null>(null)

export function useProduction(): ProductionContextValue {
  const ctx = useContext(ProductionContext)
  if (!ctx) throw new Error('useProduction outside provider')
  return ctx
}

export default function Production() {
  const { id } = useParams()
  const { user } = useAuth()
  const [production, setProduction] = useState<ProductionRecord | null>(null)
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [failed, setFailed] = useState(false)

  async function reload() {
    if (!id) return
    const [p, m] = await Promise.all([
      pb.collection('productions').getOne<ProductionRecord>(id, { expand: 'org' }),
      pb.collection('members').getFullList<MemberRecord>({
        filter: pb.filter('production = {:id}', { id }),
        expand: 'user,guardians',
        sort: 'created',
      }),
    ])
    setProduction(p)
    setMembers(m)
  }

  useEffect(() => {
    reload().catch(() => setFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (failed) {
    return (
      <main className="page">
        <p className="error">Couldn't open this production.</p>
        <Link to="/">Back to your productions</Link>
      </main>
    )
  }
  if (!production) {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    )
  }

  const myMember = members.find((m) => m.user === user?.id) ?? null
  const isManager = !!user && production.managers.includes(user.id)
  // Absolute tab paths: relative links inside a splat route resolve against
  // the full current URL in react-router v7 and stack segments endlessly.
  const base = `/production/${production.id}`

  return (
    <ProductionContext.Provider value={{ production, members, myMember, isManager, reload }}>
      <main className="page production">
        <header className="topbar">
          <Link to="/" className="link">
            ← All productions
          </Link>
          <span className="brand-small">Glow Tape</span>
        </header>
        <h1>{production.title}</h1>

        <nav className="tabs" aria-label="Production sections">
          <NavLink to={`${base}/schedule`}>Schedule</NavLink>
          <NavLink to={`${base}/messages`}>Messages</NavLink>
          <NavLink to={`${base}/todo`}>To-Do</NavLink>
          <NavLink to={`${base}/people`}>People</NavLink>
          {isManager && <NavLink to={`${base}/admin`}>Manage</NavLink>}
        </nav>

        <Routes>
          <Route path="schedule" element={<ScheduleTab />} />
          <Route path="messages" element={<MessagesTab />} />
          <Route path="todo" element={<TasksTab />} />
          <Route path="people" element={<PeopleTab />} />
          {isManager && <Route path="admin" element={<AdminTab />} />}
          {isManager && <Route path="bios" element={<BiosView />} />}
          <Route path="*" element={<Navigate to={`${base}/schedule`} replace />} />
        </Routes>
      </main>
    </ProductionContext.Provider>
  )
}
