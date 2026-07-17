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
