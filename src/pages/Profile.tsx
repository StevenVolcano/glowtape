import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { scrubImage } from '../lib/images.ts'
import { pbErrorMessage } from '../lib/files.ts'
import { useTitle } from '../lib/useTitle.ts'
import type { CompanyRecord, CreditRow, ProfileRecord } from '../lib/types.ts'

// The community acting profile: headshot + experience, shown to directors
// alongside audition signups. Teens skip the headshot (youth-safety model).
export default function Profile() {
  useTitle('My profile')
  const { user } = useAuth()
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [pronouns, setPronouns] = useState('')
  const [experience, setExperience] = useState('')
  const [skills, setSkills] = useState('')
  const [credits, setCredits] = useState<CreditRow[]>([])
  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const isTeen = user?.ageBand === 'teen'

  useEffect(() => {
    async function load() {
      try {
        const p = await pb
          .collection('profiles')
          .getFirstListItem<ProfileRecord>(pb.filter('user = {:u}', { u: user?.id }))
        setProfile(p)
        setPronouns(p.pronouns)
        setExperience(p.experience)
        setSkills(p.skills)
        setCredits(Array.isArray(p.credits) ? p.credits : [])
      } catch {
        /* no profile yet */
      }
      setLoaded(true)
    }
    load()
    pb.collection('companies')
      .getFullList<CompanyRecord>({ sort: 'name' })
      .then(setCompanies)
      .catch(() => {})
  }, [user?.id])

  async function save() {
    setBusy(true)
    setSaved('')
    setError('')
    try {
      const form = new FormData()
      form.set('user', user?.id ?? '')
      form.set('pronouns', pronouns.trim())
      form.set('experience', experience.trim())
      form.set('skills', skills.trim())
      form.set(
        'credits',
        JSON.stringify(credits.filter((c) => c.year || c.company || c.show || c.role)),
      )
      const file = fileRef.current?.files?.[0]
      if (file && !isTeen) form.set('headshot', await scrubImage(file))
      const rec = profile
        ? await pb.collection('profiles').update<ProfileRecord>(profile.id, form)
        : await pb.collection('profiles').create<ProfileRecord>(form)
      setProfile(rec)
      if (fileRef.current) fileRef.current.value = ''
      setSaved('Saved. ✓')
    } catch (err) {
      setError(pbErrorMessage(err, "Couldn't save — check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  async function removeHeadshot() {
    if (!profile) return
    try {
      const rec = await pb
        .collection('profiles')
        .update<ProfileRecord>(profile.id, { headshot: null })
      setProfile(rec)
    } catch (err) {
      setError(pbErrorMessage(err, "Couldn't remove the photo — try again."))
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <Link to="/" className="link">
          ← Home
        </Link>
        <span className="brand-small">Glow Tape</span>
      </header>

      <h1>My profile</h1>
      <p className="hint">
        Directors see this alongside your audition signups — past roles, skills, a headshot.
        Anyone signed in to Glow Tape can view it. All of it is optional.
      </p>

      {!loaded ? (
        <p>Loading…</p>
      ) : (
        <section className="stack">
          {!isTeen && (
            <>
              <h2>Headshot</h2>
              {profile?.headshot && (
                <div className="row">
                  <img
                    src={pb.files.getURL(profile, profile.headshot, { thumb: '400x0' })}
                    alt="Your headshot"
                    style={{ maxWidth: '160px', borderRadius: '10px' }}
                  />
                  <button className="link" onClick={removeHeadshot}>
                    ✕ Remove
                  </button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                aria-label="Upload a headshot"
                accept="image/jpeg,image/png,image/webp"
              />
            </>
          )}
          {isTeen && (
            <p className="hint">
              Headshots aren't uploaded for members under 18 — directors will take photos at
              auditions if they need them.
            </p>
          )}

          <label>
            Pronouns (optional)
            <input
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="Example: she/her"
            />
          </label>

          <div>
            <strong>Your stage history</strong>
            <p className="hint" style={{ margin: 0 }}>
              One row per show — directors see this with your audition signups.
            </p>
            {credits.length > 0 && (
              <div className="edit-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Year</th>
                      <th scope="col">Company</th>
                      <th scope="col">Show</th>
                      <th scope="col">Role</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {credits.map((c, i) => {
                      const setField = (field: keyof CreditRow, value: string) =>
                        setCredits((prev) =>
                          prev.map((row, j) => (j === i ? { ...row, [field]: value } : row)),
                        )
                      const knownCompany =
                        !c.company || companies.some((co) => co.name === c.company)
                      return (
                      <tr key={i}>
                        {(['year', 'company', 'show', 'role'] as const).map((field) => (
                          <td key={field}>
                            {field === 'company' && companies.length > 0 && knownCompany ? (
                              // Local companies come from a shared list; picking
                              // "Somewhere else…" turns the cell into plain text
                              // (and it turns back if cleared).
                              <select
                                aria-label="company"
                                value={c.company}
                                onChange={(e) => {
                                  if (e.target.value === '__other') {
                                    const name = window.prompt('The company or theater name:')
                                    if (name?.trim()) setField('company', name.trim())
                                  } else {
                                    setField('company', e.target.value)
                                  }
                                }}
                              >
                                <option value="">— company —</option>
                                {companies.map((co) => (
                                  <option key={co.id} value={co.name}>
                                    {co.name}
                                  </option>
                                ))}
                                <option value="__other">✏️ Somewhere else…</option>
                              </select>
                            ) : (
                              <input
                                aria-label={field}
                                value={c[field]}
                                maxLength={field === 'year' ? 9 : 120}
                                style={field === 'year' ? { minWidth: '4.5rem' } : undefined}
                                onChange={(e) => setField(field, e.target.value)}
                              />
                            )}
                          </td>
                        ))}
                        <td>
                          <button
                            className="link"
                            aria-label={`Remove row ${i + 1}`}
                            onClick={() => setCredits((prev) => prev.filter((_, j) => j !== i))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <button
              type="button"
              className="link"
              onClick={() =>
                setCredits((prev) => [...prev, { year: '', company: '', show: '', role: '' }])
              }
            >
              + Add a show
            </button>
          </div>

          <label>
            Anything else?
            <textarea
              rows={6}
              maxLength={2000}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              placeholder="Training, backstage skills, anything the table can’t hold…"
            />
          </label>

          <label>
            Skills
            <input
              maxLength={400}
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Example: tenor, tap, stage combat, sewing, follow spot"
            />
          </label>

          <div className="row">
            <button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            {saved && <span className="acked" role="status">{saved}</span>}
            {error && <span className="error" role="alert">{error}</span>}
          </div>
        </section>
      )}
    </main>
  )
}
