// Passkey (WebAuthn) checks for fingerprint / face / device-PIN sign-in.
// PocketBase's JSVM can't verify ECDSA/RSA signatures, so the hooks hand the
// browser's response here. Pure functions, no state: PocketBase owns the
// challenges, the stored public keys and the sign counters.
//
// All binary values travel as base64url strings.

import { createHash, createPublicKey, verify } from 'node:crypto'

const b64 = (s) => Buffer.from(String(s || ''), 'base64url')

function readClientData(clientDataJSON, type, challenge, origin) {
  let data
  try {
    data = JSON.parse(b64(clientDataJSON).toString('utf8'))
  } catch {
    throw new Error('unreadable client data')
  }
  if (data.type !== type) throw new Error('wrong ceremony type')
  // PocketBase issues plain-text challenges; the browser was handed their
  // UTF-8 bytes and echoes them back base64url-encoded.
  const want = Buffer.from(String(challenge || ''), 'utf8').toString('base64url')
  if (!challenge || data.challenge !== want) throw new Error('challenge mismatch')
  if (data.origin !== origin) throw new Error('origin mismatch')
}

function keyFromSpki(publicKey) {
  return createPublicKey({ key: b64(publicKey), format: 'der', type: 'spki' })
}

// Registration: the browser hands over the new key as SPKI DER
// (AuthenticatorAttestationResponse.getPublicKey()). We ask for no
// attestation, so the checks are: right ceremony/challenge/origin, and a
// key Node can actually load for a supported algorithm.
export function checkRegistration({ clientDataJSON, challenge, origin, publicKey, alg }) {
  readClientData(clientDataJSON, 'webauthn.create', challenge, origin)
  if (![-7, -8, -257].includes(Number(alg))) throw new Error('unsupported algorithm')
  const key = keyFromSpki(publicKey)
  const want = { '-7': 'ec', '-8': 'ed25519', '-257': 'rsa' }[String(alg)]
  if (key.asymmetricKeyType !== want) throw new Error('key does not match algorithm')
  return { ok: true }
}

// Sign-in: verify the authenticator's signature over
// authenticatorData || SHA-256(clientDataJSON) with the stored key.
export function checkAssertion({
  clientDataJSON,
  authenticatorData,
  signature,
  challenge,
  origin,
  rpId,
  publicKey,
  alg,
}) {
  readClientData(clientDataJSON, 'webauthn.get', challenge, origin)
  const auth = b64(authenticatorData)
  if (auth.length < 37) throw new Error('short authenticator data')
  const rpHash = createHash('sha256').update(String(rpId)).digest()
  if (!auth.subarray(0, 32).equals(rpHash)) throw new Error('rp id mismatch')
  const flags = auth[32]
  if (!(flags & 0x01)) throw new Error('user not present')
  // Fingerprint / face / device PIN — required, so a stolen unlocked phone
  // still can't sign in without the person.
  if (!(flags & 0x04)) throw new Error('user not verified')
  const signCount = auth.readUInt32BE(33)
  const signed = Buffer.concat([auth, createHash('sha256').update(b64(clientDataJSON)).digest()])
  const key = keyFromSpki(publicKey)
  const ok = verify(Number(alg) === -8 ? null : 'sha256', signed, key, b64(signature))
  if (!ok) throw new Error('bad signature')
  return { ok: true, signCount }
}
