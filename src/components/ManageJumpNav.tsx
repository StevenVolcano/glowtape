import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { openSection } from './Section.tsx'

// A long page of sections with a chip row to jump down it (scrolling beats
// hunting through accordions for this audience) — also makes cross-page
// links like /admin#auditions land on the right spot.
export function JumpNav({
  jumps,
  ariaLabel,
}: {
  jumps: Jumps
  ariaLabel: string
}) {
  const location = useLocation()

  useEffect(() => {
    if (location.hash) {
      // Let the sections render first.
      setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 50)
    }
  }, [location.hash])

  return (
    <nav aria-label={ariaLabel} className="chips" style={{ marginTop: '0.75rem' }}>
      {jumps.map(([hash, label]) => (
        <a key={hash} className="chip jump-chip" href={hash} onClick={() => openSection(hash)}>
          {label}
        </a>
      ))}
    </nav>
  )
}

// Section lists shared by the jump chips and the ☰ menu's nested links.
export type Jumps = readonly (readonly [string, string])[]

export const MANAGE_JUMPS = [
  ['#invite', 'Invite'],
  ['#add-events', 'Schedule'],
  ['#auditions', 'Auditions'],
  ['#tickets', 'Tickets'],
  ['#announce', 'Announce'],
  ['#cast-text', 'Text the cast'],
  ['#groups', 'Groups'],
  ['#people', 'People & roles'],
  ['#bios', 'Bios'],
  ['#resources', 'Docs & links'],
  ['#presets', 'Places'],
  ['#quotes', 'Quotes'],
] as const

export function scheduleJumps(isManager: boolean): Jumps {
  return [
    ['#events', 'Events'],
    ['#signups', 'Sign-ups'],
    ['#conflicts', 'Conflicts'],
    ...(isManager ? ([['#findtime', 'Find a time']] as const) : []),
    ['#calendar', 'Calendar feed'],
  ]
}

export const OPERATOR_JUMPS = [
  ['#requests', 'Requests'],
  ['#onboard', 'Set up a show'],
  ['#feedback', 'Feedback'],
  ['#codes', 'Access codes'],
  ['#orgs', 'Organizations'],
  ['#companies', 'Companies'],
  ['#claude', 'Claude connector'],
] as const

export default function ManageJumpNav() {
  return <JumpNav jumps={MANAGE_JUMPS} ariaLabel="Manage sections" />
}
