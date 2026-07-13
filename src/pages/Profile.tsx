import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useTitle } from '../lib/useTitle.ts'
import type { ProfileRecord } from '../lib/types.ts'

// The community acting profile: headshot + experience, shown to directors
// alongside audition signups. Teens skip the headshot (youth-safety model).
export default function Profile() {
  useTitle('My profile')
  const { user } = useAuth()
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [pronouns, setPronouns] = useState('')
  const [experience, setExperience] = useState('')
  const [skills, setSkills] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
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
      } catch {
        /* no profile yet */
      }
      setLoaded(true)
    }
    load()
  }, [user?.id])

  async function save() {
    setBusy(true)
    setSaved('')
    try {
      const form = new FormData()
      form.set('user', user?.id ?? '')
      form.set('pronouns', pronouns.trim())
      form.set('experience', experience.trim())
      form.set('skills', skills.trim())
      const file = fileRef.current?.files?.[0]
      if (file && !isTeen) form.set('headshot', file)
      const rec = profile
        ? await pb.collection('profiles').update<ProfileRecord>(profile.id, form)
        : await pb.collection('profiles').create<ProfileRecord>(form)
      setProfile(rec)
      if (fileRef.current) fileRef.current.value = ''
      setSaved('Saved. ✓')
    } finally {
      setBusy(false)
    }
  }

  async function removeHeadshot() {
    if (!profile) return
    const rec = await pb
      .collection('profiles')
      .update<ProfileRecord>(profile.id, { headshot: null })
    setProfile(rec)
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
              placeholder="e.g. she/her"
            />
          </label>

          <label>
            Experience
            <textarea
              rows={6}
              maxLength={2000}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              placeholder={
                'Past roles and productions, training, backstage experience…\ne.g. Motel in Fiddler on the Roof (Driftwood, 2024); stage crew for Clue'
              }
            />
          </label>

          <label>
            Skills
            <input
              maxLength={400}
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="e.g. tenor, tap, stage combat, sewing, follow spot"
            />
          </label>

          <div className="row">
            <button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            {saved && <span className="acked" role="status">{saved}</span>}
          </div>
        </section>
      )}
    </main>
  )
}
