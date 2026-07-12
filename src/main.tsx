import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth.tsx'
import App from './App.tsx'
import './styles.css'

// Invite links: glowtape.net/?code=XYZ — stash the code, clean the URL.
// SignIn prefills from it; Home consumes it to auto-join after sign-in.
const inviteCode = new URLSearchParams(window.location.search).get('code')
if (inviteCode) {
  localStorage.setItem('gt-pending-code', inviteCode.toUpperCase())
  window.history.replaceState({}, '', window.location.pathname)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is a nice-to-have; the app works without it */
    })
  })
}
