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
