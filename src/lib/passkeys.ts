import { pb } from './pb.ts'

// Fingerprint / face sign-in (passkeys). The phone or computer keeps the
// private key behind its own fingerprint, Face ID or PIN; Glow Tape only
// stores the public half (pb_hooks/passkeys.pb.js).

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
}

function toB64url(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const utf8 = (s: string) => new TextEncoder().encode(s)

// A short guess at what this device is, so the list on Home makes sense.
export function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows computer'
  if (/CrOS/.test(ua)) return 'Chromebook'
  return 'This device'
}

// The browser throws NotAllowedError when the person cancels or times out —
// not worth an error message.
export function isCancel(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
}

export async function registerPasskey(label: string): Promise<void> {
  const opts = await pb.send('/api/glowtape/passkey/register/start', { method: 'POST' })
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: utf8(opts.challenge),
      rp: { id: opts.rpId, name: 'Glow Tape' },
      user: { id: utf8(opts.userId), name: opts.userName, displayName: opts.displayName },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -8 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: (opts.exclude as string[]).map((id) => ({
        type: 'public-key' as const,
        id: fromB64url(id),
      })),
      attestation: 'none',
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Nothing was saved.')
  const res = cred.response as AuthenticatorAttestationResponse
  const publicKey = res.getPublicKey?.()
  if (!publicKey) {
    throw new Error("This browser can't save fingerprint sign-in. Try Chrome, Safari or Edge.")
  }
  await pb.send('/api/glowtape/passkey/register/finish', {
    method: 'POST',
    body: {
      challengeId: opts.challengeId,
      credentialId: toB64url(cred.rawId),
      clientDataJSON: toB64url(res.clientDataJSON),
      publicKey: toB64url(publicKey),
      alg: res.getPublicKeyAlgorithm(),
      label,
    },
  })
}

export async function signInWithPasskey(): Promise<void> {
  const opts = await pb.send('/api/glowtape/passkey/signin/start', { method: 'POST' })
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: utf8(opts.challenge),
      rpId: opts.rpId,
      userVerification: 'required',
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No sign-in was picked.')
  const res = cred.response as AuthenticatorAssertionResponse
  const out = await pb.send('/api/glowtape/passkey/signin/finish', {
    method: 'POST',
    body: {
      challengeId: opts.challengeId,
      credentialId: toB64url(cred.rawId),
      clientDataJSON: toB64url(res.clientDataJSON),
      authenticatorData: toB64url(res.authenticatorData),
      signature: toB64url(res.signature),
    },
  })
  pb.authStore.save(out.token, out.record)
}
