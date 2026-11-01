import { useEffect, useRef, useState } from 'react'
import { pb } from '../lib/pb.ts'
import { scrubImage } from '../lib/images.ts'
import { pbErrorMessage } from '../lib/files.ts'
import {
  MAX_ATTACHMENTS,
  TRACKERS,
  displayFileName,
  isImageFile,
  visibleCols,
  type TrackerCol,
  type TrackerKey,
} from '../lib/trackers.ts'
import type { TrackerItemRecord } from '../lib/types.ts'

// Sheets, the phone-in-the-field view (Steven 2026-11-01: "out in the field
// with just my phone… without weird scrolling"; "a list with a few basic
// elements… color coded for status, then click it to get the full size
// card"). SheetList = slim rows; tapping one opens SheetItemSheet, the whole
// row full-screen: every field, every photo and file, and (for managers)
// editing, adding photos straight from the camera, and attaching PDFs.

export function fileUrl(item: TrackerItemRecord, name: string, token: string, thumb?: string) {
  if (!token) return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pb.files.getURL(item as any, name, thumb ? { token, thumb } : { token })
}

async function openFile(item: TrackerItemRecord, name: string) {
  try {
    const token = await pb.files.getToken()
    window.open(fileUrl(item, name, token), '_blank', 'noopener')
  } catch {
    window.alert("Couldn't open the file — try again.")
  }
}

// What people typically write in Status. Offered, never forced — the field
// stays free text so an old spreadsheet's wording imports as-is.
const STATUS_SUGGESTIONS = [
  'Need it',
  'Looking',
  'Have it',
  'Borrowed',
  'Rented',
  'Bought',
  'Building',
  'Done',
  'Returned',
]

// Upload photos (shrunk + EXIF-stripped) and other files onto a row.
export async function addAttachments(
  item: TrackerItemRecord,
  files: File[],
): Promise<TrackerItemRecord> {
  const room = MAX_ATTACHMENTS - (item.attachments?.length ?? 0)
  if (room <= 0) throw new Error(`A row holds up to ${MAX_ATTACHMENTS} files — remove one first.`)
  const form = new FormData()
  for (const f of files.slice(0, room)) {
    form.append('attachments+', f.type.startsWith('image/') ? await scrubImage(f) : f)
  }
  return pb.collection('tracker_items').update<TrackerItemRecord>(item.id, form)
}

const DOC_ACCEPT =
  '.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// --- The compact list ------------------------------------------------------------

// Status words → a color family, so a glance down the list shows what's still
// missing. Free text stays free text; unknown words get the neutral look.
export function statusTone(status: string): 'need' | 'ok' | 'out' | '' {
  const s = status.toLowerCase()
  if (!s) return ''
  if (/need|look|missing|lost|broken|to ?do|todo|find|repair|fix/.test(s)) return 'need'
  if (/borrow|rent|loan|fitting|build|order|shipping|progress|sewing|making/.test(s)) return 'out'
  if (/have|got|found|done|bought|built|ready|return|owned|ok|✓/.test(s)) return 'ok'
  return ''
}

// One slim row per item (Steven: "don't clog up everything" — the full card
// is one tap away): thumbnail, name, the one or two facts that find it,
// a color-coded status.
export function SheetList({
  tracker,
  items,
  token,
  refreshToken,
  onOpen,
}: {
  tracker: TrackerKey
  items: TrackerItemRecord[]
  token: string
  refreshToken: () => void
  onOpen: (item: TrackerItemRecord) => void
}) {
  const labels = TRACKERS[tracker].cols
  // Where it is first (that's what you're hunting for), then the first two
  // other details this sheet uses.
  const detailCols = visibleCols(tracker).filter(
    (c) => c !== 'name' && c !== 'status' && c !== 'notes',
  )
  const ordered = [
    ...detailCols.filter((c) => c === 'where'),
    ...detailCols.filter((c) => c !== 'where'),
  ]
  const physical = TRACKERS[tracker].physical

  return (
    <ul className="sheet-list">
      {items.map((item) => {
        const files = item.attachments ?? []
        const cover = files.find(isImageFile)
        const title = item.name || 'Untitled'
        const facts = ordered
          .filter((c) => item[c])
          .slice(0, 2)
          .map((c) => (c === 'where' ? `📍 ${item[c]}` : `${labels[c]}: ${item[c]}`))
        const tone = statusTone(item.status ?? '')
        return (
          <li key={item.id}>
            <button
              type="button"
              className={`sheet-row ${tone ? `tone-${tone}` : ''}`}
              onClick={() => onOpen(item)}
            >
              {physical && (
                <span className="sheet-row-thumb" aria-hidden="true">
                  {cover && token ? (
                    <img src={fileUrl(item, cover, token, '240x240')} alt="" loading="lazy" onError={refreshToken} />
                  ) : (
                    '📷'
                  )}
                </span>
              )}
              <span className="sheet-row-text">
                <span className="sheet-row-title">{title}</span>
                {facts.length > 0 && <span className="sheet-row-facts">{facts.join(' · ')}</span>}
              </span>
              {files.length > 0 && !cover && (
                <span className="sheet-row-files" aria-label={`${files.length} files`}>
                  📎{files.length}
                </span>
              )}
              {item.status && <span className={`sheet-status ${tone ? `tone-${tone}` : ''}`}>{item.status}</span>}
              <span className="sheet-row-caret" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// --- One row, full screen ------------------------------------------------------

export function SheetItemSheet({
  tracker,
  item,
  token,
  refreshToken,
  isManager,
  isNew,
  onSaveField,
  onSaved,
  onDelete,
  onMove,
  position,
  count,
  onClose,
}: {
  tracker: TrackerKey
  item: TrackerItemRecord
  token: string
  refreshToken: () => void
  isManager: boolean
  isNew: boolean
  onSaveField: (item: TrackerItemRecord, col: TrackerCol, value: string) => Promise<void>
  onSaved: (updated: TrackerItemRecord) => void
  onDelete: (item: TrackerItemRecord) => Promise<boolean>
  // Present only when a manager is looking at the sheet in its own order.
  onMove?: (dir: -1 | 1) => void
  position: number
  count: number
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [shown, setShown] = useState(0)
  const cols = visibleCols(tracker)
  const labels = TRACKERS[tracker].cols
  const files = item.attachments ?? []
  const images = files.filter(isImageFile)
  const docs = files.filter((f) => !isImageFile(f))
  const title = item.name || (isNew ? 'New row' : 'Untitled')
  const current = images[Math.min(shown, images.length - 1)]

  useEffect(() => {
    const d = dialogRef.current
    if (d && !d.open) d.showModal()
    // showModal() focuses the first button (← Done); a brand-new row wants
    // its name typed first.
    if (d && isNew) d.querySelector<HTMLInputElement>('input[data-col="name"]')?.focus()
    // Escape lands in onClose via the 'close' event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function upload(list: FileList | null, label: string) {
    const picked = Array.from(list ?? [])
    if (picked.length === 0) return
    setBusy(label)
    setErr('')
    try {
      const updated = await addAttachments(item, picked)
      onSaved(updated)
      const newImages = (updated.attachments ?? []).filter(isImageFile)
      if (label === 'photo' && newImages.length) setShown(newImages.length - 1)
    } catch (e) {
      setErr(pbErrorMessage(e, 'That didn’t upload — try again?'))
    } finally {
      setBusy('')
    }
  }

  async function removeFile(name: string) {
    if (!window.confirm(`Remove ${isImageFile(name) ? 'this photo' : displayFileName(name)}?`)) return
    setBusy('remove')
    setErr('')
    try {
      onSaved(
        await pb.collection('tracker_items').update<TrackerItemRecord>(item.id, {
          'attachments-': [name],
        }),
      )
      setShown((s) => Math.max(0, s - 1))
    } catch (e) {
      setErr(pbErrorMessage(e, 'Couldn’t remove it — try again?'))
    } finally {
      setBusy('')
    }
  }

  async function save(col: TrackerCol, value: string) {
    setErr('')
    try {
      await onSaveField(item, col, value)
    } catch (e) {
      setErr(pbErrorMessage(e, 'That change didn’t save — try again?'))
    }
  }

  const listId = `sheet-status-${item.id}`

  return (
    <dialog
      ref={dialogRef}
      className="sheet-dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current.close()
      }}
    >
      <div className="sheet-dialog-bar">
        <button type="button" onClick={() => dialogRef.current?.close()}>
          ← Done
        </button>
        <span className="sheet-dialog-title">{title}</span>
        {item.status && (
          <span className={`sheet-status ${statusTone(item.status) ? `tone-${statusTone(item.status)}` : ''}`}>
            {item.status}
          </span>
        )}
      </div>

      <div className="sheet-dialog-body">
        {current && token && (
          <figure className="sheet-photo">
            <button
              type="button"
              className="sheet-photo-big"
              onClick={() => openFile(item, current)}
              aria-label="Open the full-size photo"
            >
              <img src={fileUrl(item, current, token, '800x0')} alt={`Photo of ${title}`} onError={refreshToken} />
            </button>
            {images.length > 1 && (
              <div className="row sheet-photo-nav">
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={() => setShown((s) => (s - 1 + images.length) % images.length)}
                >
                  ◂
                </button>
                <span className="hint" aria-live="polite">
                  Photo {Math.min(shown, images.length - 1) + 1} of {images.length}
                </span>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={() => setShown((s) => (s + 1) % images.length)}
                >
                  ▸
                </button>
              </div>
            )}
            {isManager && (
              <button type="button" className="link" disabled={!!busy} onClick={() => removeFile(current)}>
                🗑 Remove this photo
              </button>
            )}
          </figure>
        )}

        {isManager && (
          <div className="row sheet-upload no-print">
            <button type="button" disabled={!!busy} onClick={() => photoRef.current?.click()}>
              {busy === 'photo' ? 'Saving…' : images.length ? '📷 Add another photo' : '📷 Add a photo'}
            </button>
            <button type="button" disabled={!!busy} onClick={() => docRef.current?.click()}>
              {busy === 'doc' ? 'Uploading…' : '📎 Attach a file'}
            </button>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const l = e.target.files
                upload(l, 'photo').finally(() => (e.target.value = ''))
              }}
            />
            <input
              ref={docRef}
              type="file"
              accept={DOC_ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const l = e.target.files
                upload(l, 'doc').finally(() => (e.target.value = ''))
              }}
            />
          </div>
        )}
        {err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}

        {docs.length > 0 && (
          <ul className="sheet-docs">
            {docs.map((d) => (
              <li key={d} className="row">
                <button type="button" className="link" onClick={() => openFile(item, d)}>
                  📄 {displayFileName(d)}
                </button>
                {isManager && (
                  <button
                    type="button"
                    className="link"
                    aria-label={`Remove ${displayFileName(d)}`}
                    disabled={!!busy}
                    onClick={() => removeFile(d)}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isManager ? (
          <div className="stack sheet-fields">
            {cols.map((c) => (
              <label key={c}>
                {c === 'where' ? '📍 ' : ''}
                {labels[c]}
                {c === 'notes' ? (
                  <textarea
                    defaultValue={item[c] ?? ''}
                    maxLength={2000}
                    rows={4}
                    onBlur={(e) => save(c, e.target.value.trim())}
                  />
                ) : (
                  <input
                    defaultValue={item[c] ?? ''}
                    maxLength={200}
                    data-col={c}
                    list={c === 'status' ? listId : undefined}
                    placeholder={
                      c === 'where' ? 'Example: Prop table stage left, or bin 4' : undefined
                    }
                    onBlur={(e) => save(c, e.target.value.trim())}
                  />
                )}
              </label>
            ))}
            <datalist id={listId}>
              {STATUS_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="hint">Changes save as you go.</p>
            {onMove && count > 1 && (
              <div className="row" role="group" aria-label="Place in the sheet">
                <button type="button" disabled={position <= 0} onClick={() => onMove(-1)}>
                  ↑ Move up
                </button>
                <button type="button" disabled={position >= count - 1} onClick={() => onMove(1)}>
                  ↓ Move down
                </button>
                <span className="hint" aria-live="polite">
                  {position + 1} of {count}
                </span>
              </div>
            )}
            <button
              type="button"
              className="link danger"
              onClick={async () => {
                if (await onDelete(item)) dialogRef.current?.close()
              }}
            >
              🗑 Delete this row
            </button>
          </div>
        ) : (
          <dl className="sheet-detail">
            {cols
              .filter((c) => item[c])
              .map((c) => (
                <div key={c}>
                  <dt>{c === 'where' ? '📍 ' : ''}{labels[c]}</dt>
                  <dd>{item[c]}</dd>
                </div>
              ))}
          </dl>
        )}
      </div>
    </dialog>
  )
}
