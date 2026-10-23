import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

// A page section whose heading folds it open and shut. Long pages (Manage
// especially) were a wall of forms; folding lets people keep just what they
// use open. The choice is remembered per section per device, and anything
// that points at a section (#hash links, jump chips, the ☰ menu) opens it.

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
  defaultOpen = false,
  className,
  children,
}: {
  id: string
  title: ReactNode
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}) {
  const { hash } = useLocation()
  const [open, setOpen] = useState(() => hash === `#${id}` || (readOpen(id) ?? defaultOpen))

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
