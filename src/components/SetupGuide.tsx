import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import { productionPlaces } from '../lib/types.ts'

interface Step {
  key: string
  title: string
  detail: string
  done: boolean
  to?: string // router link (other tabs)
  href?: string // same-page anchor into Manage
  action: string
}

// The director's walkthrough: each step is derived from real data, so it
// checks itself off as the show gets set up. Collapses once everything's done.
export default function SetupGuide() {
  const { production, members } = useProduction()
  const { user } = useAuth()
  const [unitCount, setUnitCount] = useState<number | null>(null)
  const [eventKinds, setEventKinds] = useState<string[] | null>(null)
  const [expanded, setExpanded] = useState<boolean | null>(null)

  const base = `/production/${production.id}`

  useEffect(() => {
    pb.collection('units')
      .getList(1, 1, { filter: pb.filter('production = {:p}', { p: production.id }) })
      .then((r) => setUnitCount(r.totalItems))
      .catch(() => setUnitCount(0))
    pb.collection('events')
      .getFullList<{ kind: string; status: string }>({
        filter: pb.filter('production = {:p}', { p: production.id }),
        fields: 'kind,status',
      })
      .then((list) => setEventKinds(list.filter((e) => e.status !== 'cancelled').map((e) => e.kind)))
      .catch(() => setEventKinds([]))
  }, [production.id])

  if (unitCount === null || eventKinds === null) return null

  const isAudition = (k: string) => k.toLowerCase().includes('audition')
  const rolesBeyondMe = members.filter((m) => m.user !== user?.id && m.role !== 'guardian')
  const castJoined = rolesBeyondMe.filter((m) => m.user || m.minor)

  const steps: Step[] = [
    {
      key: 'presets',
      title: 'Set your places (and event types)',
      detail:
        'Save your usual rehearsal spots with street addresses — locations then autofill, map-link, and ride into calendars. Tweak the event-type list if the standard one doesn’t fit.',
      done: productionPlaces(production).length > 0,
      href: '#presets',
      action: 'Set places',
    },
    {
      key: 'breakdown',
      title: 'Break down the show',
      detail:
        'Split the show into songs, scenes, or page hunks and mark who’s in each — then scheduling can call exactly the right people. Import a CSV or build it by hand.',
      done: !!production.breakdownStyle && unitCount > 0,
      to: `${base}/sheets`,
      action: 'Open the breakdown',
    },
    {
      key: 'roles',
      title: 'Add the roles',
      detail:
        'Characters and crew positions, before anyone is cast. Each role gets a claim code — on cast night you hand codes out and everyone’s schedule is waiting for them. Check "This is a child" for young performers.',
      done: rolesBeyondMe.length > 0,
      href: '#people',
      action: 'Add roles',
    },
    {
      key: 'auditions',
      title: 'Open auditions',
      detail:
        'Add the details and your own questions, then share the audition link — signups collect right here, each with the person’s profile and conflicts. Print blank forms for the paper crowd.',
      done: production.auditionOpen || castJoined.length > 0,
      href: '#auditions',
      action: 'Set up auditions',
    },
    {
      key: 'audition-events',
      title: 'Put audition nights on the schedule',
      detail:
        'Add them as events with the type "Auditions" so times, place, and map link are one tap away for everyone.',
      done: eventKinds.some(isAudition),
      href: '#add-events',
      action: 'Add audition nights',
    },
    {
      key: 'schedule',
      title: 'Build the rehearsal schedule',
      detail:
        '"Repeats weekly" creates a whole run in one pass with one summary email; the Fix-up table adjusts many nights at once. Pick breakdown units on each event and the right people are called automatically.',
      done: eventKinds.some((k) => !isAudition(k)),
      href: '#add-events',
      action: 'Add to the schedule',
    },
    {
      key: 'invite',
      title: 'Invite the cast & crew',
      detail:
        'Share the join code (or invite link) at the read-through — role codes for cast, the plain code for everyone else. Parents claim child roles with their own accounts. Then nudge everyone to enter conflicts right away.',
      done: castJoined.length > 0,
      href: '#invite',
      action: 'Invite people',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length
  const open = expanded ?? !allDone

  return (
    <section>
      <h2>Setting up {production.title}</h2>
      <p className="hint">
        {allDone
          ? '🎬 All set up. This checklist stays here if you need it.'
          : `${doneCount} of ${steps.length} steps done — work top to bottom, in any order you like.`}{' '}
        <a href="/director-guide.html" target="_blank" rel="noreferrer">
          Printable director&rsquo;s guide
        </a>
      </p>
      <button className="link" aria-expanded={open} onClick={() => setExpanded(!open)}>
        {open ? 'Hide the checklist' : 'Show the checklist'}
      </button>
      {open && (
        <ol className="plain-list setup-steps">
          {steps.map((s) => (
            <li key={s.key} className={s.done ? 'setup-done' : ''}>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <span aria-hidden="true">{s.done ? '✅' : '⬜'}</span>
                <div>
                  <strong>{s.title}</strong>
                  {s.done && <span className="sr-only"> — done</span>}
                  <p className="hint" style={{ margin: 0 }}>
                    {s.detail}
                  </p>
                  {!s.done &&
                    (s.to ? (
                      <Link className="link" to={s.to}>
                        → {s.action}
                      </Link>
                    ) : (
                      <a className="link" href={s.href}>
                        → {s.action}
                      </a>
                    ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
