import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const JUMPS = [
  ['#invite', 'Invite'],
  ['#add-events', 'Schedule'],
  ['#auditions', 'Auditions'],
  ['#announce', 'Announce'],
  ['#people', 'People & roles'],
  ['#bios', 'Bios'],
  ['#resources', 'Docs & links'],
  ['#presets', 'Places'],
] as const

// Manage is one long page on purpose (scrolling beats hunting through
// accordions for this audience) — this row just gets you down it faster,
// and makes cross-tab links like /admin#auditions land on the right spot.
export default function ManageJumpNav() {
  const location = useLocation()

  useEffect(() => {
    if (location.hash) {
      // Let the sections render first.
      setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 50)
    }
  }, [location.hash])

  return (
    <nav aria-label="Manage sections" className="chips" style={{ marginTop: '0.75rem' }}>
      {JUMPS.map(([hash, label]) => (
        <a key={hash} className="chip jump-chip" href={hash}>
          {label}
        </a>
      ))}
    </nav>
  )
}
