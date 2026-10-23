import { useAuth } from '../lib/auth.tsx'
import { useTitle } from '../lib/useTitle.ts'
import PushSettings from '../components/PushSettings.tsx'
import ReminderSettings from '../components/ReminderSettings.tsx'
import PhoneSettings from '../components/PhoneSettings.tsx'
import EmailSettings from '../components/EmailSettings.tsx'
import PasskeySettings from '../components/PasskeySettings.tsx'
import SiteMenu from '../components/SiteMenu.tsx'

// Everything about how Glow Tape reaches you and how you sign in, in one
// place. These used to sit at the bottom of Home, which buried your shows
// under a stack of settings.
export default function Settings() {
  useTitle('My settings')
  const { user } = useAuth()
  if (!user) return null

  return (
    <main className="page">
      <header className="topbar">
        <SiteMenu />
        <span className="brand-small">Glow Tape</span>
      </header>

      <h1>My settings</h1>
      <p className="hint">
        How should we reach you? Every notification also comes by email, so all of this is
        optional.
      </p>

      <PushSettings />
      <ReminderSettings user={user} />
      <PhoneSettings user={user} />
      <EmailSettings user={user} />
      <PasskeySettings />
    </main>
  )
}
