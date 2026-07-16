import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { chatName, firstLastInitial } from '../lib/types.ts'
import type { AnnotationRecord, ResourceRecord } from '../lib/types.ts'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// The script room: read a PDF (script, libretto, score) with sticky-note
// pins. Production notes come from the staff and everyone sees them;
// personal notes are yours alone. Notes can be marked off when fixed —
// "pencil in the cut at the top of p. 42" stops nagging once it's done.
export default function ScriptRoom() {
  const { resourceId } = useParams()
  const { production, members, isManager } = useProduction()
  const { user } = useAuth()
  const [resource, setResource] = useState<ResourceRecord | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [notes, setNotes] = useState<AnnotationRecord[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null)
  const [draftText, setDraftText] = useState('')
  const [draftScope, setDraftScope] = useState<'personal' | 'production'>('personal')
  const [openNote, setOpenNote] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [failed, setFailed] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const renderTask = useRef<{ cancel: () => void } | null>(null)

  const base = `/production/${production.id}`

  async function loadNotes() {
    if (!resourceId) return
    const list = await pb.collection('annotations').getFullList<AnnotationRecord>({
      filter: pb.filter('resource = {:r}', { r: resourceId }),
      expand: 'user',
      sort: 'page,created',
    })
    setNotes(list)
  }

  useEffect(() => {
    if (!resourceId) return
    let cancelled = false
    pb.collection('resources')
      .getOne<ResourceRecord>(resourceId)
      .then(async (r) => {
        if (cancelled) return
        setResource(r)
        const url = pb.files.getURL(r, r.file)
        const doc = await pdfjsLib.getDocument({ url }).promise
        if (cancelled) return
        setPdf(doc)
        setPageCount(doc.numPages)
      })
      .catch(() => setFailed("Couldn't open this document."))
    loadNotes().catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId])

  // Render the current page, scaled to the container, crisp on retina.
  useEffect(() => {
    if (!pdf || !canvasRef.current || !holderRef.current) return
    let cancelled = false
    pdf.getPage(pageNum).then((page) => {
      if (cancelled || !canvasRef.current || !holderRef.current) return
      const width = holderRef.current.clientWidth
      const base = page.getViewport({ scale: 1 })
      const scale = width / base.width
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${width}px`
      canvas.style.height = `${viewport.height / dpr}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      renderTask.current?.cancel()
      const task = page.render({ canvasContext: ctx, viewport, canvas })
      renderTask.current = task
      task.promise.catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNum])

  function pageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!adding || !holderRef.current) return
    const rect = holderRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setDraft({ x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) })
  }

  async function saveDraft() {
    if (!draft || !draftText.trim() || !resourceId) return
    await pb.collection('annotations').create({
      production: production.id,
      resource: resourceId,
      user: user!.id,
      page: pageNum,
      x: draft.x,
      y: draft.y,
      text: draftText.trim(),
      scope: isManager ? draftScope : 'personal',
      done: false,
    })
    setDraft(null)
    setDraftText('')
    setAdding(false)
    await loadNotes()
  }

  async function toggleDone(n: AnnotationRecord) {
    await pb.collection('annotations').update(n.id, { done: !n.done })
    await loadNotes()
  }

  async function remove(n: AnnotationRecord) {
    if (!window.confirm('Delete this note?')) return
    await pb.collection('annotations').delete(n.id)
    setOpenNote('')
    await loadNotes()
  }

  const authorName = (n: AnnotationRecord) => {
    const full = n.expand?.user?.name || 'someone'
    const member = members.find((m) => m.user === n.user)
    return member ? chatName(full, member) : firstLastInitial(full)
  }

  const visibleNotes = notes.filter((n) => showDone || !n.done)
  const pageNotes = visibleNotes.filter((n) => n.page === pageNum)
  const openCount = notes.filter((n) => !n.done).length

  if (failed) {
    return (
      <section>
        <p className="error">{failed}</p>
        <Link className="link" to={`${base}/schedule`}>
          ← Back to the schedule
        </Link>
      </section>
    )
  }

  return (
    <section>
      <div className="row space-between">
        <h2>📖 {resource?.title ?? 'Script'}</h2>
        <Link className="link" to={`${base}/schedule`}>
          ← Back
        </Link>
      </div>
      <p className="hint">
        Tap <em>➕ Add a note</em>, then tap the spot on the page. 📌 notes are from the
        production team (everyone sees them); 📝 notes are yours alone. Check a note off when
        it's taken care of.
      </p>

      <div className="row no-print" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className={adding ? '' : 'link'}
          aria-pressed={adding}
          onClick={() => {
            setAdding(!adding)
            setDraft(null)
          }}
        >
          {adding ? 'Tap the page where the note goes…' : '➕ Add a note'}
        </button>
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            style={{ width: '1.2rem', minHeight: '1.2rem' }}
          />
          Show done notes
        </label>
      </div>

      <div className="row no-print" style={{ alignItems: 'center' }}>
        <button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>
          ← Page
        </button>
        <span>
          Page{' '}
          <input
            aria-label="Page number"
            type="number"
            min={1}
            max={pageCount || 1}
            value={pageNum}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 1 && v <= pageCount) setPageNum(v)
            }}
            style={{ width: '5rem', display: 'inline-block' }}
          />{' '}
          of {pageCount || '…'}
        </span>
        <button
          type="button"
          disabled={pageNum >= pageCount}
          onClick={() => setPageNum(pageNum + 1)}
        >
          Page →
        </button>
      </div>

      <div
        ref={holderRef}
        onClick={pageClick}
        style={{
          position: 'relative',
          cursor: adding ? 'crosshair' : 'default',
          border: '1px solid var(--line)',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%' }} />
        {pageNotes.map((n) => (
          <button
            key={n.id}
            type="button"
            aria-label={`Note by ${authorName(n)}: ${n.text.slice(0, 60)}`}
            onClick={(e) => {
              e.stopPropagation()
              setOpenNote(openNote === n.id ? '' : n.id)
            }}
            style={{
              position: 'absolute',
              left: `${n.x * 100}%`,
              top: `${n.y * 100}%`,
              transform: 'translate(-50%, -90%)',
              background: 'none',
              border: 'none',
              padding: 0,
              minHeight: 0,
              fontSize: '1.4rem',
              opacity: n.done ? 0.45 : 1,
              filter: n.done ? 'grayscale(1)' : 'none',
            }}
          >
            {n.scope === 'production' ? '📌' : '📝'}
          </button>
        ))}
        {draft && (
          <span
            style={{
              position: 'absolute',
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              transform: 'translate(-50%, -90%)',
              fontSize: '1.4rem',
            }}
          >
            📍
          </span>
        )}
      </div>

      {draft && (
        <div className="card stack">
          <label>
            The note
            <textarea
              rows={2}
              maxLength={1000}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Example: cut the second verse — pencil brackets here"
              autoFocus
            />
          </label>
          {isManager && (
            <label className="row" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={draftScope === 'production'}
                onChange={(e) => setDraftScope(e.target.checked ? 'production' : 'personal')}
                style={{ width: '1.2rem', minHeight: '1.2rem' }}
              />
              📌 Production note — everyone in the show sees it
            </label>
          )}
          <div className="row">
            <button type="button" onClick={saveDraft} disabled={!draftText.trim()}>
              Save note
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setDraft(null)
                setDraftText('')
              }}
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      {openNote &&
        (() => {
          const n = notes.find((x) => x.id === openNote)
          if (!n) return null
          const canEdit = n.user === user?.id || (n.scope === 'production' && isManager)
          return (
            <div className="card stack" role="dialog" aria-label="Note details">
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {n.scope === 'production' ? '📌' : '📝'} {n.text}
              </p>
              <p className="hint" style={{ margin: 0 }}>
                {authorName(n)} · page {n.page}
                {n.done ? ' · done ✓' : ''}
              </p>
              <div className="row">
                {canEdit && (
                  <button type="button" onClick={() => toggleDone(n)}>
                    {n.done ? '↩ Not done after all' : '✓ Mark it done'}
                  </button>
                )}
                {canEdit && (
                  <button type="button" className="link" onClick={() => remove(n)}>
                    Delete
                  </button>
                )}
                <button type="button" className="link" onClick={() => setOpenNote('')}>
                  Close
                </button>
              </div>
            </div>
          )
        })()}

      <h3 className="dept-heading">
        Notes in this document ({openCount} open)
      </h3>
      {visibleNotes.length === 0 && (
        <p className="hint">No notes yet — tap ➕ Add a note and then a spot on the page.</p>
      )}
      <ul className="plain-list">
        {visibleNotes.map((n) => (
          <li key={n.id} className="row" style={{ alignItems: 'center' }}>
            {(n.user === user?.id || (n.scope === 'production' && isManager)) ? (
              <input
                type="checkbox"
                aria-label={`Mark done: ${n.text.slice(0, 60)}`}
                checked={n.done}
                onChange={() => toggleDone(n)}
                style={{ width: '1.3rem', minHeight: '1.3rem', flexShrink: 0 }}
              />
            ) : (
              <span style={{ width: '1.3rem', flexShrink: 0 }}>{n.done ? '✓' : ''}</span>
            )}
            <button
              type="button"
              className="link"
              style={{ textAlign: 'left', textDecoration: n.done ? 'line-through' : 'underline' }}
              onClick={() => {
                setPageNum(n.page)
                setOpenNote(n.id)
              }}
            >
              p. {n.page} — {n.scope === 'production' ? '📌' : '📝'} {n.text.slice(0, 90)}
              {n.text.length > 90 ? '…' : ''}
            </button>
            <span className="hint">{authorName(n)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
