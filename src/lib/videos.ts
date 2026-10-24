import { pb } from './pb.ts'
import type { VideoCheckinRecord } from './types.ts'

// Video check-ins (migration 1759100000). The 3-minute cap lives here — the
// in-app recorder stops itself, uploads are measured before sending — and
// the server's 300 MB file cap is the backstop.
export const MAX_SECONDS = 180
export const MAX_BYTES = 300 * 1024 * 1024
// A little grace for phones that report 3:00.4 on a 3-minute clip.
const UPLOAD_GRACE_SECONDS = 5

// mp4 first: it plays everywhere (iPhones included); webm is Chrome's
// fallback on older Android.
export function pickRecorderType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const t of ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

export function canRecordHere(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && pickRecorderType() !== ''
}

// Seconds, or null when the browser can't tell (some webm files).
export function videoDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    const done = (d: number | null) => {
      URL.revokeObjectURL(url)
      resolve(d)
    }
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null)
    v.onerror = () => done(null)
    v.src = url
  })
}

// Plain-English reason a picked file can't go up, or '' when it's fine.
export async function checkUpload(file: File): Promise<string> {
  if (!file.type.startsWith('video/')) return "That isn't a video file."
  if (file.size > MAX_BYTES) {
    return "That video file is too big. Try the 🎥 Record button instead — it makes a smaller file."
  }
  const d = await videoDuration(file)
  if (d !== null && d > MAX_SECONDS + UPLOAD_GRACE_SECONDS) {
    const m = Math.floor(d / 60)
    const s = Math.round(d % 60)
    return `That video is ${m}:${String(s).padStart(2, '0')} long. Keep it under 3 minutes.`
  }
  return ''
}

export function formatSeconds(total: number): string {
  const t = Math.max(0, Math.round(total))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

// Create (or replace, with `existingId`) a check-in with upload progress —
// the SDK has no progress events, and a 3-minute video on a phone
// connection takes long enough that people need to see it moving.
export function uploadCheckin(opts: {
  existingId?: string
  production: string
  request: string
  member: string
  file: Blob
  filename: string
  seconds: number
  onProgress: (fraction: number) => void
}): Promise<VideoCheckinRecord> {
  const form = new FormData()
  if (!opts.existingId) {
    form.append('production', opts.production)
    form.append('request', opts.request)
    form.append('member', opts.member)
  }
  form.append('video', opts.file, opts.filename)
  form.append('seconds', String(Math.round(opts.seconds)))
  form.append('uploadedBy', pb.authStore.record?.id ?? '')
  const path = opts.existingId
    ? `/api/collections/video_checkins/records/${opts.existingId}`
    : '/api/collections/video_checkins/records'
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(opts.existingId ? 'PATCH' : 'POST', pb.buildURL(path))
    xhr.setRequestHeader('Authorization', pb.authStore.token)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as VideoCheckinRecord)
      else {
        const data = (body as { data?: Record<string, { message?: string }>; message?: string }) || {}
        const field = data.data && Object.values(data.data)[0]?.message
        reject(new Error(field || data.message || "The upload didn't go through."))
      }
    }
    xhr.onerror = () => reject(new Error('The connection dropped during the upload.'))
    xhr.send(form)
  })
}

// Protected file: fetch it whole with a fresh token. A token in a <video src>
// would expire mid-watch and break seeking.
export async function fetchVideo(r: VideoCheckinRecord): Promise<string> {
  const token = await pb.files.getToken()
  const res = await fetch(pb.files.getURL(r, r.video, { token }))
  if (!res.ok) throw new Error("Couldn't load the video.")
  return URL.createObjectURL(await res.blob())
}
