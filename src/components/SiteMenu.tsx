import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import type { ProductionRecord } from '../lib/types.ts'
import { MANAGE_JUMPS, OPERATOR_JUMPS, scheduleJumps, type Jumps } from './ManageJumpNav.tsx'
import { openSection } from './Section.tsx'

// The one ☰ menu, on every page: Grays Harbor, each of your shows (with its
// tabs, and the long pages' sections nested under them), the operator console,
// and your own stuff. Replaces the sideways-scrolling tab strip, which hid
// half the tabs on a phone, and gets you from anywhere to anywhere.

type MenuShow = Pick<ProductionRecord, 'id' | 'title' | 'archived' | 'managers' | 'auditionOpen'>

// Shared across pages so reopening the menu shows the last list instantly
// while a fresh one loads.
let cached: { shows: MenuShow[]; auditions: MenuShow[] } | null = null

const FIELDS = 'id,title,archived,managers,auditionOpen'

async function loadShows(userId: string) {
  const [list, mems] = await Promise.all([
    pb.collection('productions').getFullList<MenuShow>({ sort: '-created', fields: FIELDS }),
    pb.collection('members').getFullList<{ production: string }>({
      filter: pb.filter('user = {:u} || guardians ?= {:u}', { u: userId }),
      fields: 'production',
    }),
  ])
  const memberOf = new Set(mems.map((m) => m.production))
  const shows = list.filter((p) => p.managers.includes(userId) || memberOf.has(p.id))
  const auditions = list.filter((p) => p.auditionOpen && !shows.includes(p))
  return { shows, auditions }
}

export interface CurrentShow {
  production: MenuShow
  isManager: boolean
}

export default function SiteMenu({ current }: { current?: CurrentShow }) {
  const { user, signOut } = useAuth()
  const { pathname, hash } = useLocation()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(cached)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open || !user) return
    loadShows(user.id)
      .then((d) => {
        cached = d
        setData(d)
      })
      .catch(() => {})
  }, [open, user])

  // Any navigation closes it.
  useEffect(() => setOpen(false), [pathname, hash])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  // The show you're in always appears, even before the list loads (and for
  // the Stagehand, who isn't a member of it).
  let shows = data?.shows ?? []
  if (current && !shows.some((s) => s.id === current.production.id)) {
    shows = [current.production, ...shows]
  }
  const active = shows.filter((s) => !s.archived)
  const past = shows.filter((s) => s.archived)
  const auditions = data?.auditions ?? []
  const here = current ? tabLabel(pathname, current.production.id) : ''

  return (
    <div className="site-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls="site-menu-panel"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">☰</span> {here || 'Menu'}
        {here && <span className="sr-only"> — open the menu</span>}
      </button>
      {open && (
        <nav id="site-menu-panel" className="menu-panel" aria-label="Glow Tape menu">
          <ul className="menu-list">
            <li>
              <MenuLink to="/" here={pathname === '/'}>
                🏠 Home
              </MenuLink>
            </li>
          </ul>

          {active.map((s) => (
            <ShowGroup
              key={s.id}
              show={s}
              isManager={
                current?.production.id === s.id
                  ? current.isManager
                  : s.managers.includes(user.id) || !!user.operator
              }
              startOpen={current ? current.production.id === s.id : active.length === 1}
              pathname={pathname}
            />
          ))}

          <MenuGroup title="🎪 Around Grays Harbor" startOpen={!current}>
            <li>
              <MenuLink to="/community" here={pathname === '/community'}>
                Community board &amp; calendar
              </MenuLink>
            </li>
            {auditions.map((a) => (
              <li key={a.id}>
                <MenuLink to={`/audition/${a.id}`} here={pathname === `/audition/${a.id}`}>
                  Audition: {a.title}
                </MenuLink>
              </li>
            ))}
            <li>
              <MenuLink to="/request-production" here={pathname === '/request-production'}>
                Request a production
              </MenuLink>
            </li>
          </MenuGroup>

          {past.length > 0 && (
            <MenuGroup title="📦 Past shows" startOpen={false}>
              {past.map((s) => (
                <li key={s.id}>
                  <MenuLink to={`/production/${s.id}/dashboard`} here={false}>
                    {s.title}
                  </MenuLink>
                </li>
              ))}
            </MenuGroup>
          )}

          {user.operator && (
            <MenuGroup title="🔧 Operator" startOpen={pathname === '/operator'}>
              <li>
                <MenuLink to="/operator" here={pathname === '/operator'}>
                  Operator console
                </MenuLink>
                <SubLinks base="/operator" jumps={OPERATOR_JUMPS} label="Operator console" />
              </li>
            </MenuGroup>
          )}

          <MenuGroup title="🙋 You" startOpen={!current}>
            <li>
              <MenuLink to="/settings" here={pathname === '/settings'}>
                ⚙ My settings
              </MenuLink>
            </li>
            <li>
              <MenuLink to="/profile" here={pathname === '/profile'}>
                🎭 My profile
              </MenuLink>
            </li>
            <li>
              <a className="menu-link" href="/help.html">
                ❓ Help
              </a>
            </li>
            <li>
              <button type="button" className="menu-link" onClick={signOut}>
                Sign out
              </button>
            </li>
          </MenuGroup>
        </nav>
      )}
    </div>
  )
}

const TABS: { path: string; label: string; manager?: boolean; live?: boolean }[] = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'schedule', label: 'Schedule' },
  { path: 'messages', label: 'Messages' },
  { path: 'todo', label: 'To-Do' },
  { path: 'sheets', label: 'Sheets' },
  { path: 'docs', label: 'Docs' },
  { path: 'notes', label: 'Notes' },
  { path: 'people', label: 'People' },
  { path: 'casting', label: 'Casting', manager: true, live: true },
  { path: 'admin', label: 'Manage', manager: true },
]

// Name of the tab you're on, for the menu button — "where am I?" stays
// answered now that the tabs themselves are tucked away.
function tabLabel(pathname: string, productionId: string): string {
  const rest = pathname.slice(`/production/${productionId}/`.length).split('/')[0]
  if (rest === 'script') return 'Docs'
  if (rest === 'bios' || rest === 'packet') return 'Manage'
  if (rest === 'signin') return 'Schedule'
  return TABS.find((t) => t.path === rest)?.label ?? ''
}

function ShowGroup({
  show,
  isManager,
  startOpen,
  pathname,
}: {
  show: MenuShow
  isManager: boolean
  startOpen: boolean
  pathname: string
}) {
  const base = `/production/${show.id}`
  const tabs = TABS.filter((t) => (!t.manager || isManager) && !(t.live && show.archived))
  return (
    <MenuGroup title={`🎭 ${show.title}`} startOpen={startOpen}>
      {tabs.map((t) => {
        const to = `${base}/${t.path}`
        const jumps =
          t.path === 'schedule'
            ? scheduleJumps(isManager)
            : t.path === 'admin' && !show.archived
              ? MANAGE_JUMPS
              : null
        return (
          <li key={t.path}>
            <MenuLink to={to} here={pathname === to}>
              {t.label}
            </MenuLink>
            {jumps && <SubLinks base={to} jumps={jumps} label={t.label} />}
          </li>
        )
      })}
    </MenuGroup>
  )
}

function MenuGroup({
  title,
  startOpen,
  children,
}: {
  title: string
  startOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="menu-group">
      <button
        type="button"
        className="menu-heading"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span className="fold-caret" aria-hidden="true">
          ▸
        </span>
      </button>
      {open && <ul className="menu-list">{children}</ul>}
    </div>
  )
}

// A page's sections, folded under it: "Schedule ▸" → Events, Conflicts…
function SubLinks({ base, jumps, label }: { base: string; jumps: Jumps; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="menu-sub-toggle"
        aria-expanded={open}
        aria-label={`${label} sections`}
        onClick={() => setOpen(!open)}
      >
        <span className="fold-caret" aria-hidden="true">
          ▸
        </span>
      </button>
      {open && (
        <ul className="menu-list menu-sub">
          {jumps.map(([hash, text]) => (
            <li key={hash}>
              <Link className="menu-link" to={`${base}${hash}`} onClick={() => openSection(hash)}>
                {text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function MenuLink({
  to,
  here,
  children,
}: {
  to: string
  here: boolean
  children: ReactNode
}) {
  return (
    <Link className="menu-link" to={to} aria-current={here ? 'page' : undefined}>
      {children}
    </Link>
  )
}
