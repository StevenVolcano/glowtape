import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useProduction } from './Production.tsx'
import { ROLE_LABELS, memberName } from '../lib/types.ts'
import type { AuditionRecord, CastDraftRecord } from '../lib/types.ts'

// The director's casting worksheet. Entirely private to the production team
// (the draft lives in a manager-only collection) until "Finalize cast" runs —
// which is the moment people are actually attached to their roles.
export default function CastingTab() {
  const { production, members, isManager, reload } = useProduction()
  const [auditions, setAuditions] = useState<AuditionRecord[]>([])
  const [draft, setDraft] = useState<CastDraftRecord | null>(null)
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [errStatus, setErrStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const base = `/production/${production.id}`

  useEffect(() => {
    async function load() {
      const [aud, drafts] = await Promise.all([
        pb.collection('auditions').getFullList<AuditionRecord>({
          filter: pb.filter('production = {:p}', { p: production.id }),
          expand: 'user',
          sort: 'created',
        }),
        pb.collection('cast_drafts').getFullList<CastDraftRecord>({
          filter: pb.filter('production = {:p}', { p: production.id }),
        }),
      ])
      setAuditions(aud)
      const d = drafts[0] ?? null
      setDraft(d)
      setAssignments(d?.assignments ?? {})
      setLoaded(true)
    }
    load().catch(() => setLoaded(true))
  }, [production.id])

  if (!isManager) return <p className="hint">The casting table is for the production team.</p>

  // Roles you can draft into: real placeholder rows. Already-cast and child
  // roles show for context but aren't assignable here.
  const roles = members.filter((m) => m.role !== 'guardian' && !m.claimedFrom)

  async function saveDraft(next: Record<string, string>) {
    setAssignments(next)
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v))
    if (draft) {
      const rec = await pb
        .collection('cast_drafts')
        .update<CastDraftRecord>(draft.id, { assignments: clean, status: 'draft' })
      setDraft(rec)
    } else {
      const rec = await pb
        .collection('cast_drafts')
        .create<CastDraftRecord>({ production: production.id, assignments: clean, status: 'draft' })
      setDraft(rec)
    }
  }

  function assign(memberId: string, userId: string) {
    saveDraft({ ...assignments, [memberId]: userId }).catch(() =>
      setErrStatus('Could not save the draft — check your connection and try again.'),
    )
  }

  const userCounts = new Map<string, number>()
  for (const uid of Object.values(assignments)) {
    if (uid) userCounts.set(uid, (userCounts.get(uid) ?? 0) + 1)
  }

  // People already holding a role in the show — draftable into another role
  // (playing two parts, crew picking up a cameo). Deduped against auditioners.
  const auditionUserIds = new Set(auditions.map((a) => a.user))
  const existingPeople = [
    ...new Map(
      members
        .filter((m) => m.user && m.role !== 'guardian' && !auditionUserIds.has(m.user))
        .map((m) => [m.user, m] as const),
    ).values(),
  ]

  const candidateName = (value: string) => {
    if (value.startsWith('name:')) return value.slice(5)
    return (
      auditions.find((a) => a.user === value)?.expand?.user?.name ??
      existingPeople.find((m) => m.user === value)?.expand?.user?.name ??
      'someone'
    )
  }

  // Paper audition forms: no account, just a name. Finalize records it on the
  // role as an offline member; they join for real whenever they claim the code.
  function assignFreeForm(memberId: string) {
    const name = window.prompt('Their name, from the paper form:')
    if (name === null) return
    assign(memberId, name.trim() ? `name:${name.trim()}` : '')
  }

  // Lock in one role ahead of the rest — the Jesus-and-Judas-first pattern.
  async function castOne(memberId: string) {
    const value = assignments[memberId] ?? ''
    if (!value) return
    const role = roles.find((m) => m.id === memberId)
    const who = candidateName(value)
    if (
      !window.confirm(
        `Cast ${who} as ${role?.position || 'this role'} now, ahead of the rest? ${
          value.startsWith('name:')
            ? 'Their name goes on the role as a not-on-Glow-Tape member.'
            : 'They immediately see the production — schedule, messages, materials.'
        } The rest of your draft stays private.`,
      )
    )
      return
    setBusy(true)
    setStatus('')
    setErrStatus('')
    try {
      const res = await pb.send('/api/glowtape/casting/finalize', {
        method: 'POST',
        body: { production: production.id, members: [memberId] },
      })
      if (res.assigned > 0) {
        setStatus(`${who} is cast as ${role?.position || 'the role'}. 🎉 The rest of the draft is untouched.`)
      } else {
        setErrStatus(`Couldn't cast that role${res.skipped?.length ? `: ${res.skipped.join('; ')}` : ''}.`)
      }
      await reload()
    } catch (err) {
      setErrStatus(err instanceof Error ? err.message : 'Casting failed.')
    } finally {
      setBusy(false)
    }
  }

  async function finalize() {
    const count = Object.values(assignments).filter(Boolean).length
    if (count === 0) {
      setErrStatus('Nothing to finalize yet — pick people from the dropdowns first.')
      return
    }
    if (
      !window.confirm(
        `Finalize this cast? ${count} ${count === 1 ? 'person' : 'people'} will be attached to their roles — anyone with a Glow Tape account immediately sees the production (schedule, messages, materials), and paper-form names are recorded on their roles as not-on-Glow-Tape members. Announce your cast however you normally do; Glow Tape won't email anyone about this. This is the real cast list: undoing it means editing roles by hand.`,
      )
    )
      return
    setBusy(true)
    setStatus('')
    setErrStatus('')
    try {
      const res = await pb.send('/api/glowtape/casting/finalize', {
        method: 'POST',
        body: { production: production.id },
      })
      let message = `Cast finalized — ${res.assigned} ${res.assigned === 1 ? 'role' : 'roles'} filled. 🎉`
      if (res.skipped?.length) message += ` Skipped: ${res.skipped.join('; ')}.`
      setStatus(message)
      setDraft((d) => (d ? { ...d, status: 'final' } : d))
      await reload()
    } catch (err) {
      setErrStatus(err instanceof Error ? err.message : 'Finalize failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <section>
        <h2>Casting</h2>
        <p className="hint">
          Your private worksheet — nobody outside the production team can see it. Draft the
          cast from audition signups, sleep on it, then finalize. Need to re-read someone's
          answers? <Link to={`${base}/admin#auditions`}>Review the audition forms</Link>.
        </p>
        {!loaded && <p>Loading…</p>}
        {loaded && roles.length === 0 && (
          <p className="hint">
            No roles yet — add characters and positions in{' '}
            <Link to={`${base}/admin#people`}>People &amp; roles</Link> first.
          </p>
        )}
        {loaded && roles.length > 0 && auditions.length === 0 && (
          <p className="hint">
            No audition signups yet — the dropdowns fill in as people sign up. (You can also
            skip casting-by-app entirely and hand out role codes.)
          </p>
        )}

        <ul className="plain-list">
          {roles.map((m) => {
            const picked = assignments[m.id] ?? ''
            const doubled = picked && (userCounts.get(picked) ?? 0) > 1
            const audition = picked ? auditions.find((a) => a.user === picked) : null
            return (
              <li key={m.id} className="member-row">
                <strong>{m.position || ROLE_LABELS[m.role]}</strong>
                {m.user ? (
                  <span className="hint">✅ {memberName(m)} (already cast)</span>
                ) : m.minor ? (
                  <span className="hint">🛡️ child role — a parent claims code {production.joinCode}-{m.roleCode}</span>
                ) : (
                  <>
                    <select
                      aria-label={`Cast ${m.position || 'this role'}`}
                      value={picked}
                      onChange={(e) =>
                        e.target.value === '__paper'
                          ? assignFreeForm(m.id)
                          : assign(m.id, e.target.value)
                      }
                    >
                      <option value="">— undecided —</option>
                      {auditions.length > 0 && (
                        <optgroup label="Audition signups">
                          {auditions.map((a) => (
                            <option key={a.id} value={a.user}>
                              {a.expand?.user?.name}
                              {a.roles ? ` (asked for: ${a.roles.slice(0, 40)})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {existingPeople.length > 0 && (
                        <optgroup label="Already in the show">
                          {existingPeople.map((em) => (
                            <option key={em.id} value={em.user}>
                              🎭 {em.expand?.user?.name}
                              {em.position ? ` (${em.position})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {picked.startsWith('name:') && (
                        <option value={picked}>✍ {picked.slice(5)} (paper form)</option>
                      )}
                      <option value="__paper">✍ Someone from a paper form…</option>
                    </select>
                    {doubled && (
                      <span className="error">⚠ {candidateName(picked)} is drafted for another role too</span>
                    )}
                    {picked && !doubled && (
                      <button
                        className="link"
                        disabled={busy}
                        onClick={() => castOne(m.id)}
                      >
                        ✓ Cast now
                      </button>
                    )}
                  </>
                )}
                {audition?.conflicts && (
                  <span className="hint" style={{ width: '100%' }}>
                    Their conflicts: {audition.conflicts.slice(0, 140)}
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        {loaded && roles.some((m) => !m.user && !m.minor) && (
          <div className="row">
            <button onClick={finalize} disabled={busy}>
              {busy ? 'Finalizing…' : '✅ Finalize the cast'}
            </button>
            {draft?.status === 'final' && <span className="hint">Last draft was finalized.</span>}
          </div>
        )}
        {status && <p className="acked" role="status">{status}</p>}
        {errStatus && <p className="error" role="alert">{errStatus}</p>}
        <p className="hint">
          Double-cast warnings (⚠) are fine to leave while you think — they're flags, not
          errors. Casting your leads early? <em>✓ Cast now</em> next to a pick locks in just
          that role while the rest of the draft stays private — the usual move when Jesus and
          Judas are set before the ensemble. Finalizing skips child roles and anything already
          cast.
        </p>
      </section>
    </div>
  )
}
