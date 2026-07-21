import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// A long page of sections with a chip row to jump down it (scrolling beats
// hunting through accordions for this audience) — also makes cross-page
// links like /admin#auditions land on the right spot.
export function JumpNav({
  jumps,
  ariaLabel,
}: {
  jumps: readonly (readonly [string, string])[]
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
        <a key={hash} className="chip jump-chip" href={hash}>
          {label}
        </a>
      ))}
    </nav>
  )
}

const MANAGE_JUMPS = [
  ['#invite', 'Invite'],
  ['#add-events', 'Schedule'],
  ['#auditions', 'Auditions'],
  ['#tickets', 'Tickets'],
  ['#announce', 'Announce'],
  ['#groups', 'Groups'],
  ['#people', 'People & roles'],
  ['#bios', 'Bios'],
  ['#resources', 'Docs & links'],
  ['#presets', 'Places'],
  ['#quotes', 'Quotes'],
] as const

export default function ManageJumpNav() {
  return <JumpNav jumps={MANAGE_JUMPS} ariaLabel="Manage sections" />
}
