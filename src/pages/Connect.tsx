import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useTitle } from '../lib/useTitle.ts'

// The consent step of the Claude connector's sign-in (OAuth, see
// backend/pb_hooks/oauth.pb.js). Claude sends the person here with the
// request in the query string; Allow trades it for a one-time code and
// sends them back to Claude. Signed-out visitors see SignIn first and land
// back here, query intact.
export default function Connect() {
  useTitle('Connect Claude')
  const params = new URLSearchParams(window.location.search)
  const request = {
    client_id: params.get('client_id') ?? '',
    redirect_uri: params.get('redirect_uri') ?? '',
    response_type: params.get('response_type') ?? '',
    code_challenge: params.get('code_challenge') ?? '',
    code_challenge_method: params.get('code_challenge_method') ?? '',
    state: params.get('state') ?? '',
  }
  const [name, setName] = useState('')
  const [operatorOnly, setOperatorOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = new URLSearchParams({ client_id: request.client_id, redirect_uri: request.redirect_uri })
    pb.send<{ name: string; operatorOnly: boolean }>(`/api/glowtape/oauth/client?${q}`, {})
      .then((r) => {
        setName(r.name)
        setOperatorOnly(r.operatorOnly)
      })
      .catch((err) => setError(err instanceof Error ? err.message : "This request isn't valid."))
    // The query string never changes on this page.
  }, [])

  async function answer(deny: boolean) {
    setBusy(true)
    setError('')
    try {
      const r = await pb.send<{ redirect: string }>('/api/glowtape/oauth/approve', {
        method: 'POST',
        body: { ...request, deny },
      })
      window.location.assign(r.redirect)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect.")
      setBusy(false)
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

      <h1>Connect Claude</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!error && name && operatorOnly && (
        <p className="warn" role="alert">
          The Claude connector is only for the Glow Tape operator for now.
        </p>
      )}
      {!error && name && !operatorOnly && (
        <div className="stack">
          <p>
            <strong>{name}</strong> wants to use Glow Tape as you. It will be able to read and
            change everything you can see and do here, including contacts and chats. Glow Tape
            itself still has no AI.
          </p>
          <p className="hint">
            You can turn it off any time in the Operator console, under Claude connector.
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => answer(false)}>
              Allow
            </button>
            <button type="button" className="link" disabled={busy} onClick={() => answer(true)}>
              Don't allow
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
