import ProfileEditor from '../components/ProfileEditor.tsx'
import { useTitle } from '../lib/useTitle.ts'
import SiteMenu from '../components/SiteMenu.tsx'

// The community acting profile: headshot + experience, shown to directors
// alongside audition signups. The editor itself lives in
// components/ProfileEditor.tsx (also embedded in the audition form).
export default function Profile() {
  useTitle('My profile')

  return (
    <main className="page">
      <header className="topbar">
        <SiteMenu />
        <span className="brand-small">Glow Tape</span>
      </header>

      <h1>My profile</h1>
      <p className="hint">
        Directors see this alongside your audition signups — past roles, skills, a headshot.
        Anyone signed in to Glow Tape can view it. All of it is optional.
      </p>

      <section>
        <ProfileEditor />
      </section>
    </main>
  )
}
