import { useRef, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { scrubImage } from '../lib/images.ts'
import type { TrackerItemRecord } from '../lib/types.ts'

// One photo per Sheets row, so "the blue suitcase" is never a guessing game.
// The cell shows a small thumbnail; tapping it opens the full photo. Managers
// add one from the phone camera or the photo library (accept="image/*" lets
// the phone offer both), and replace or remove it from the enlarged view.
export default function TrackerPhoto({
  item,
  canEdit,
  onSaved,
}: {
  item: TrackerItemRecord
  canEdit: boolean
  onSaved: (updated: TrackerItemRecord) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const what = item.name || 'this row'

  const url = (thumb?: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pb.files.getURL(item as any, item.photo, thumb ? { thumb } : undefined)

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setErr('')
    try {
      const form = new FormData()
      form.set('photo', await scrubImage(file))
      onSaved(await pb.collection('tracker_items').update<TrackerItemRecord>(item.id, form))
    } catch {
      setErr('That photo didn’t save — try again?')
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto() {
    if (!window.confirm(`Remove the photo of ${what}?`)) return
    setBusy(true)
    setErr('')
    try {
      onSaved(await pb.collection('tracker_items').update<TrackerItemRecord>(item.id, { photo: null }))
      dialogRef.current?.close()
    } catch {
      setErr('Couldn’t remove the photo — try again?')
    } finally {
      setBusy(false)
    }
  }

  const picker = canEdit && (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        upload(file)
      }}
    />
  )

  return (
    <div className="tracker-photo">
      {picker}
      {item.photo ? (
        <button
          type="button"
          className="tracker-thumb"
          aria-label={`Photo of ${what} — tap to enlarge`}
          onClick={() => dialogRef.current?.showModal()}
        >
          <img src={url('120x120')} alt="" loading="lazy" />
        </button>
      ) : canEdit ? (
        <button
          type="button"
          className="photo-btn no-print"
          aria-label={`Add a photo of ${what}`}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? '…' : '📷'}
        </button>
      ) : null}
      {err && !item.photo && (
        <p className="error" role="alert">
          {err}
        </p>
      )}

      {item.photo && (
        <dialog
          ref={dialogRef}
          className="photo-dialog"
          aria-label={`Photo of ${what}`}
          // A tap on the dimmed backdrop (outside the content box) closes it.
          onClick={(e) => {
            if (e.target === dialogRef.current) dialogRef.current.close()
          }}
        >
          <div className="photo-dialog-body">
            <p className="photo-dialog-title">{what}</p>
            <img src={url()} alt={`Photo of ${what}`} />
            {err && (
              <p className="error" role="alert">
                {err}
              </p>
            )}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {canEdit && (
                <>
                  <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
                    {busy ? 'Saving…' : '📷 Replace photo'}
                  </button>
                  <button type="button" disabled={busy} onClick={removePhoto}>
                    🗑 Remove photo
                  </button>
                </>
              )}
              <button type="button" onClick={() => dialogRef.current?.close()}>
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}
