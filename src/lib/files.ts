import { useCallback, useRef, useState } from 'react'
import { pb } from './pb.ts'
import type { ResourceRecord } from './types.ts'

// Resource files are protected (migration 1755800000): plain URLs 404 without
// a short-lived token, so links fetch a fresh token at click time. Access
// control rides the record's view rule.
export async function openResourceFile(r: ResourceRecord) {
  try {
    const token = await pb.files.getToken()
    window.open(pb.files.getURL(r, r.file, { token }), '_blank', 'noopener')
  } catch {
    window.alert("Couldn't open the file — try again.")
  }
}

// PocketBase packs the useful part of a validation failure in
// response.data ({field: {message}}); surface it instead of the generic
// "Something went wrong while processing your request.".
export function pbErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, { message?: string }> } }).response
    ?.data
  if (data) {
    const parts = Object.entries(data)
      .map(([field, d]) => (d?.message ? `${field}: ${d.message}` : ''))
      .filter(Boolean)
    if (parts.length > 0) return parts.join(' · ')
  }
  return err instanceof Error && err.message ? err.message : fallback
}

// Protected-file token for pages that show many protected thumbnails (Sheets
// attachments). Tokens live ~3 minutes; a lazy thumbnail scrolled into view
// later 404s, so an <img onError> calls refresh(), which fetches a new token
// at most once every 20 seconds (no loops when a file is genuinely gone).
export function useFileToken() {
  const [token, setToken] = useState('')
  const last = useRef(0)
  const refresh = useCallback(() => {
    if (Date.now() - last.current < 20_000) return
    last.current = Date.now()
    pb.files
      .getToken()
      .then(setToken)
      .catch(() => {})
  }, [])
  return { token, refresh }
}
