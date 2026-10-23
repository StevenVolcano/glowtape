import { Suspense, createContext, lazy, useContext, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import SiteMenu from '../components/SiteMenu.tsx'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { TAGLINE } from '../lib/types.ts'
import type { MemberRecord, ProductionRecord } from '../lib/types.ts'
import ScheduleTab from './ScheduleTab.tsx'
import TonightTab from './TonightTab.tsx'
import MessagesTab from './MessagesTab.tsx'
import PeopleTab from './PeopleTab.tsx'
import TasksTab from './TasksTab.tsx'
import TrackersTab from './TrackersTab.tsx'
import NotesTab from './NotesTab.tsx'
import DocsTab from './DocsTab.tsx'
import SchedulePrint from './SchedulePrint.tsx'
import CheckIn, { CheckInPoster } from './CheckIn.tsx'
import ProgramPacket from './ProgramPacket.tsx'
import CastingTab from './CastingTab.tsx'
import BiosView from './BiosView.tsx'
import { useTitle } from '../lib/useTitle.ts'
import AdminTab from './AdminTab.tsx'

// pdf.js is heavy — the script room loads only when someone opens a document.
const ScriptRoom = lazy(() => import('./ScriptRoom.tsx'))

export interface ProductionContextValue {
  production: ProductionRecord
  members: MemberRecord[]
  myMember: MemberRecord | null
  isManager: boolean
  // True when the show is archived: it's a read-only record. Components hide
  // their edit affordances on this, and the backend blocks writes regardless.
  archived: boolean
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
  useTitle(production?.title ?? '')

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

  // Someone can be both a performer and a guardian (parent in the cast whose
  // kid is too) — prefer their non-guardian row so their OWN calls, acks, and
  // print-my-schedule work; child coverage rides on myChildIds patterns.
  const myRows = members.filter((m) => m.user === user?.id)
  const myMember = myRows.find((m) => m.role !== 'guardian') ?? myRows[0] ?? null
  // The operator (the "Glow Tape Stagehand") can manage any production for
  // setup and troubleshooting. In shows where they hold a real role, the
  // member row wins and nothing looks different — the Stagehand banner only
  // shows where they have no row of their own.
  const isManager = !!user && (production.managers.includes(user.id) || user.operator)
  const asStagehand = !!user?.operator && !myMember && !production.managers.includes(user.id)
  const archived = !!production.archived
  // Absolute paths: relative links inside a splat route resolve against the
  // full current URL in react-router v7 and stack segments endlessly.
  const base = `/production/${production.id}`

  return (
    <ProductionContext.Provider value={{ production, members, myMember, isManager, archived, reload }}>
      <main className="page production">
        <header className="topbar">
          <SiteMenu current={{ production, isManager }} />
          <span className="brand-small">Glow Tape</span>
        </header>
        <h1>{production.title}</h1>
        {asStagehand && (
          <p className="stagehand-banner" role="note">
            🔧 You're here as the <strong>Glow Tape Stagehand</strong> — full
            access for setup and troubleshooting.
          </p>
        )}
        {archived && (
          <p className="archived-banner" role="status">
            📦 This show is archived — it's a read-only record.{' '}
            {isManager
              ? 'Unarchive it in Manage to make changes.'
              : 'Ask a manager to unarchive it to make changes.'}
          </p>
        )}

        <Routes>
          <Route path="dashboard" element={<TonightTab />} />
          <Route path="schedule" element={<ScheduleTab />} />
          <Route path="schedule/print" element={<SchedulePrint />} />
          <Route path="schedule/print/:memberId" element={<SchedulePrint />} />
          <Route path="signin/:eventId" element={<CheckIn />} />
          <Route path="signin/:eventId/poster" element={<CheckInPoster />} />
          <Route path="messages" element={<MessagesTab />} />
          <Route path="todo" element={<TasksTab />} />
          <Route path="sheets" element={<TrackersTab />} />
          <Route path="docs" element={<DocsTab />} />
          <Route path="notes" element={<NotesTab />} />
          <Route path="notes/:noteId" element={<NotesTab />} />
          <Route
            path="script/:resourceId"
            element={
              <Suspense fallback={<p>Opening the document…</p>}>
                <ScriptRoom />
              </Suspense>
            }
          />
          <Route path="people" element={<PeopleTab />} />
          {isManager && !archived && <Route path="casting" element={<CastingTab />} />}
          {isManager && <Route path="admin" element={<AdminTab />} />}
          {isManager && <Route path="bios" element={<BiosView />} />}
          {isManager && <Route path="packet" element={<ProgramPacket />} />}
          <Route path="*" element={<Navigate to={`${base}/dashboard`} replace />} />
        </Routes>
        <p className="hint legal-links">
          <em>{TAGLINE}</em>
        </p>
      </main>
    </ProductionContext.Provider>
  )
}
