import { useState } from 'react'

// "Put Glow Tape on your home screen" steps, shown on the sign-in page so
// people can install before they have an account (help.html#install says the
// same thing). Hidden once Glow Tape is already running from the home screen.
export default function InstallHelp() {
  const [open, setOpen] = useState(false)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  if (standalone) return null

  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; touch support gives it away
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  const isAndroid = /android/i.test(ua)

  const iphone = (
    <ol>
      <li>
        Open <strong>glowtape.net</strong> in <strong>Safari</strong> (not inside the Google or
        Facebook app). This page is fine — you don't need to sign in first.
      </li>
      <li>
        Tap the <strong>Share</strong> button (a square with an arrow pointing up). On newer
        iPhones it's tucked behind the <strong>•••</strong> button at the bottom right — tap that,
        then <em>Share</em>.
      </li>
      <li>
        Scroll down the list that pops up and tap <em>Add to Home Screen</em>. Don't see it? Tap{' '}
        <em>View More</em> or <em>Edit Actions…</em> at the bottom of the list to find it.
      </li>
      <li>
        Tap <em>Add</em>. Glow Tape now has its own icon — open it from there.
      </li>
    </ol>
  )
  const android = (
    <ol>
      <li>
        Open <strong>glowtape.net</strong> in <strong>Chrome</strong>.
      </li>
      <li>
        Tap the <strong>⋮</strong> menu at the top right, then <em>Add to Home screen</em> (or{' '}
        <em>Install app</em>).
      </li>
    </ol>
  )

  return (
    <div className="install-help">
      <button
        type="button"
        className="link"
        aria-expanded={open}
        aria-controls="install-steps"
        onClick={() => setOpen(!open)}
      >
        📲 Put Glow Tape on your home screen
      </button>
      <div id="install-steps" hidden={!open}>
        {isIos ? (
          iphone
        ) : isAndroid ? (
          android
        ) : (
          <>
            <p className="hint">
              <strong>iPhone or iPad:</strong>
            </p>
            {iphone}
            <p className="hint">
              <strong>Android:</strong>
            </p>
            {android}
          </>
        )}
        <p className="hint">It's optional — Glow Tape works fine in a regular browser tab too.</p>
      </div>
    </div>
  )
}
