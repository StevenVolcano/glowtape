import { useEffect, useId, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

// A page section whose heading folds it open and shut. Long pages (Manage
// especially) were a wall of forms; folding lets people keep just what they
// use open. The choice is remembered per section per device, and anything
// that points at a section (#hash links, jump chips, the ☰ menu) opens it.
// Everything starts shut (Steven's call) — the page reads as a table of contents.

const OPEN_EVENT = 'gt-open-section'

function readOpen(id: string): boolean | null {
  try {
    const v = localStorage.getItem(`gt-sec-${id}`)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    localStorage.setItem(`gt-sec-${id}`, open ? '1' : '0')
  } catch {
    // private window / blocked storage — it just won't be remembered
  }
}

// Open a section by its #hash and bring it into view. Used by jump chips and
// the menu, which can point at the page you're already on (same hash = no
// router change, so the section wouldn't hear about it otherwise).
export function openSection(hash: string) {
  const id = hash.replace(/^#/, '')
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
  // Let it render open before scrolling.
  setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50)
}

export default function Section({
  id,
  title,
  className,
  children,
}: {
  id: string
  title: ReactNode
  className?: string
  children: ReactNode
}) {
  const { hash } = useLocation()
  const [open, setOpen] = useState(() => hash === `#${id}` || (readOpen(id) ?? false))

  useEffect(() => {
    if (hash === `#${id}`) setOpen(true)
  }, [hash, id])

  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [id])

  function toggle() {
    const next = !open
    setOpen(next)
    writeOpen(id, next)
  }

  const bodyId = `${id}-body`
  return (
    <section id={id} className={['fold', open ? 'open' : '', className].filter(Boolean).join(' ')}>
      <h2>
        <button
          type="button"
          className="fold-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span className="fold-title">{title}</span>
          <span className="fold-caret" aria-hidden="true">
            ▸
          </span>
        </button>
      </h2>
      <div id={bodyId} className="fold-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

// A fold for a group INSIDE a section — a week of the schedule, a department
// of tasks, an act of the breakdown. Starts shut so a long list reads as a
// short table of contents; the summary says what's inside without opening it.
// Not remembered: the groups come and go with the data.
export function FoldGroup({
  title,
  summary,
  as: Heading = 'h3',
  children,
}: {
  title: ReactNode
  summary?: ReactNode
  as?: 'h3' | 'h4'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <div className={`fold-group${open ? ' open' : ''}`}>
      <Heading className="dept-heading">
        <button
          type="button"
          className="fold-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span className="fold-title">
            {title}
            {summary && <span className="fold-summary"> {summary}</span>}
          </span>
          <span className="fold-caret" aria-hidden="true">
            ▸
          </span>
        </button>
      </Heading>
      <div id={bodyId} className="fold-body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
