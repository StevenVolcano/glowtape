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

// Highlighter shades — translucent so the text stays readable underneath.
const HIGHLIGHT_COLORS: Record<string, { label: string; swatch: string; stroke: string }> = {
  yellow: { label: 'Yellow', swatch: '#ffdc00', stroke: 'rgba(255, 220, 0, 0.4)' },
  cyan: { label: 'Cyan', swatch: '#00c8e6', stroke: 'rgba(0, 200, 230, 0.35)' },
  lime: { label: 'Lime green', swatch: '#7ede3f', stroke: 'rgba(126, 222, 63, 0.4)' },
  pink: { label: 'Pink', swatch: '#ff7bc2', stroke: 'rgba(255, 123, 194, 0.4)' },
}

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
  const [mode, setMode] = useState<'read' | 'pin' | 'draw' | 'highlight' | 'erase'>('read')
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null)
  const [draftText, setDraftText] = useState('')
  const [draftScope, setDraftScope] = useState<'personal' | 'production'>('personal')
  const [color, setColor] = useState<keyof typeof HIGHLIGHT_COLORS>('yellow')
  const [openNote, setOpenNote] = useState('')
  const [showDone, setShowDone] = useState(false)
  // Compact mode: once the tools are familiar, give the page the screen.
  const [compact, setCompact] = useState(() => localStorage.getItem('gt-script-compact') === '1')

  function toggleCompact() {
    setCompact((prev) => {
      localStorage.setItem('gt-script-compact', prev ? '0' : '1')
      return !prev
    })
  }
  const [failed, setFailed] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const renderTask = useRef<{ cancel: () => void } | null>(null)
  const strokeRef = useRef<{ x: number; y: number }[]>([])
  const drawingRef = useRef(false)
  const [renderTick, setRenderTick] = useState(0)

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
        const token = await pb.files.getToken()
        const url = pb.files.getURL(r, r.file, { token })
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
      const overlay = overlayRef.current
      if (overlay) {
        overlay.width = viewport.width
        overlay.height = viewport.height
        overlay.style.width = `${width}px`
        overlay.style.height = `${viewport.height / dpr}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      renderTask.current?.cancel()
      const task = page.render({ canvasContext: ctx, viewport })
      renderTask.current = task
      task.promise
        .then(() => setRenderTick((t) => t + 1))
        .catch((err: unknown) => {
          // page flips cancel the old render — that's routine, not failure
          if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
            setFailed("Couldn't draw the page — try reloading, and tell the operator if it keeps happening.")
          }
        })
    })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNum])

  const strokeStyle = (kind: string, ctx: CanvasRenderingContext2D, w: number, colorKey?: string) => {
    if (kind === 'highlight') {
      ctx.strokeStyle = (HIGHLIGHT_COLORS[colorKey ?? 'yellow'] ?? HIGHLIGHT_COLORS.yellow).stroke
      ctx.lineWidth = w * 0.025
    } else {
      ctx.strokeStyle = '#b3372f'
      ctx.lineWidth = w * 0.004
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  function paintStroke(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], kind: string, w: number, h: number, faded: boolean, colorKey?: string) {
    if (pts.length < 2) return
    ctx.save()
    strokeStyle(kind, ctx, w, colorKey)
    if (faded) ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(pts[0].x * w, pts[0].y * h)
    for (const pt of pts.slice(1)) ctx.lineTo(pt.x * w, pt.y * h)
    ctx.stroke()
    ctx.restore()
  }

  // Repaint saved strokes whenever the page (re)renders or notes change.
  useEffect(() => {
    const overlay = overlayRef.current
    const ctx = overlay?.getContext('2d')
    if (!overlay || !ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    for (const n of notes) {
      if (n.page !== pageNum || !n.path?.length) continue
      if (n.done && !showDone) continue
      paintStroke(ctx, n.path, n.kind ?? 'draw', overlay.width, overlay.height, !!n.done, n.color)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, pageNum, renderTick, showDone])

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = holderRef.current!.getBoundingClientRect()
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    }
  }

  function pointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (mode !== 'draw' && mode !== 'highlight') return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drawingRef.current = true
    strokeRef.current = [pointFromEvent(e)]
  }

  function pointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawingRef.current || !holderRef.current) return
    e.preventDefault()
    const pt = pointFromEvent(e)
    const last = strokeRef.current[strokeRef.current.length - 1]
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.004) return
    strokeRef.current.push(pt)
    // live feedback: repaint saved strokes' overlay plus the one in progress
    const overlay = overlayRef.current
    const ctx = overlay?.getContext('2d')
    if (overlay && ctx) paintStroke(ctx, strokeRef.current.slice(-2), mode, overlay.width, overlay.height, false, color)
  }

  async function pointerUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    const pts = strokeRef.current
    strokeRef.current = []
    if (pts.length < 2 || !resourceId) return
    await pb.collection('annotations').create({
      production: production.id,
      resource: resourceId,
      user: user!.id,
      page: pageNum,
      x: pts[0].x,
      y: pts[0].y,
      text: '',
      kind: mode === 'highlight' ? 'highlight' : 'draw',
      color: mode === 'highlight' ? color : '',
      path: pts,
      scope: isManager ? draftScope : 'personal',
      done: false,
    })
    await loadNotes()
  }

  async function eraseAt(x: number, y: number) {
    const rect = holderRef.current?.getBoundingClientRect()
    if (!rect) return
    const threshold = 18 / rect.width // ~18px in normalized units
    for (const n of notes) {
      if (n.page !== pageNum || !n.path?.length) continue
      const mine = n.user === user?.id || (n.scope === 'production' && isManager)
      if (!mine) continue
      const hit = n.path.some((pt) => Math.hypot(pt.x - x, (pt.y - y) * (rect.height / rect.width)) < threshold)
      if (hit) {
        if (window.confirm(`Erase this ${n.kind === 'highlight' ? 'highlight' : 'drawing'}?`)) {
          await pb.collection('annotations').delete(n.id)
          await loadNotes()
        }
        return
      }
    }
  }

  function pageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (mode === 'erase' && holderRef.current) {
      const rect = holderRef.current.getBoundingClientRect()
      eraseAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
      return
    }
    if (mode !== 'pin' || !holderRef.current) return
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
      kind: 'pin',
      scope: isManager ? draftScope : 'personal',
      done: false,
    })
    setDraft(null)
    setDraftText('')
    setMode('read')
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

  const pins = notes.filter((n) => !n.path?.length)
  const visibleNotes = pins.filter((n) => showDone || !n.done)
  const pageNotes = visibleNotes.filter((n) => n.page === pageNum)
  const openCount = pins.filter((n) => !n.done).length

  if (failed) {
    return (
      <section>
        <p className="error">{failed}</p>
        <Link className="link" to={`${base}/docs`}>
          ← Back to Docs
        </Link>
      </section>
    )
  }

  return (
    <section>
      <div className="row space-between">
        {!compact && <h2>📖 {resource?.title ?? 'Script'}</h2>}
        <div className="row" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="link"
            aria-pressed={compact}
            onClick={toggleCompact}
          >
            {compact ? '↙ Full controls' : '⛶ Compact view'}
          </button>
          <Link className="link" to={`${base}/docs`}>
            ← Back
          </Link>
        </div>
      </div>
      {!compact && (
        <p className="hint">
          Pick a tool, then use the page: 📝 notes pin to a spot you tap, ✏️ draws, 🖍
          highlights, 🧽 erases your marks. 📌 notes and marks from the production team are
          seen by everyone; yours are yours alone. Everything saves by itself the moment you
          make it — there's nothing to save manually.
        </p>
      )}

      <div className="chips no-print">
        {(
          [
            ['read', '👆 Read'],
            ['pin', '📝 Note'],
            ['draw', '✏️ Draw'],
            ['highlight', '🖍 Highlight'],
            ['erase', '🧽 Erase'],
          ] as const
        ).map(([m, label]) => (
          <button
            type="button"
            key={m}
            className={`chip ${mode === m ? 'chip-active' : ''}`}
            aria-pressed={mode === m}
            aria-label={label.replace(/^\S+\s/, '')}
            onClick={() => {
              setMode(m)
              setDraft(null)
            }}
          >
            {compact ? label.split(' ')[0] : label}
          </button>
        ))}
        {compact && isManager && draftScope === 'production' && (
          <span className="pill" title="New notes and marks are production-wide">📌 all</span>
        )}
      </div>
      {mode === 'pin' && !compact && (
        <p className="hint no-print">Tap the spot on the page where the note goes.</p>
      )}
      {mode === 'highlight' && (
        <div className="chips no-print" role="group" aria-label="Highlighter color">
          {Object.entries(HIGHLIGHT_COLORS).map(([key, c]) => (
            <button
              type="button"
              key={key}
              className={`chip ${color === key ? 'chip-active' : ''}`}
              aria-pressed={color === key}
              aria-label={c.label}
              onClick={() => setColor(key)}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: compact ? '1.2rem' : '0.9rem',
                  height: compact ? '1.2rem' : '0.9rem',
                  borderRadius: '3px',
                  background: c.swatch,
                  marginRight: compact ? 0 : '0.35rem',
                  verticalAlign: '-0.1rem',
                }}
              />
              {!compact && c.label}
            </button>
          ))}
        </div>
      )}
      {(mode === 'draw' || mode === 'highlight') && !compact && (
        <p className="hint no-print">
          Drag on the page to {mode === 'highlight' ? 'highlight' : 'draw'}
          {isManager && draftScope === 'production'
            ? ' — as a 📌 production mark everyone sees.'
            : ' — only you see your marks.'}
        </p>
      )}
      {mode === 'erase' && !compact && (
        <p className="hint no-print">Tap a drawing or highlight to erase it (only your own).</p>
      )}
      {!compact && (
      <div className="row no-print" style={{ alignItems: 'center' }}>
        {isManager && (
          <label className="row" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draftScope === 'production'}
              onChange={(e) => setDraftScope(e.target.checked ? 'production' : 'personal')}
              style={{ width: '1.2rem', minHeight: '1.2rem' }}
            />
            📌 New notes &amp; marks are production-wide (everyone sees them)
          </label>
        )}
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
      )}

      <div className="row no-print" style={{ alignItems: 'center' }}>
        <button type="button" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>
          {compact ? '←' : '← Page'}
        </button>
        <span>
          {!compact && 'Page '}
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
            style={{ width: compact ? '4rem' : '5rem', display: 'inline-block' }}
          />{' '}
          {compact ? `/ ${pageCount || '…'}` : `of ${pageCount || '…'}`}
        </span>
        <button
          type="button"
          disabled={pageNum >= pageCount}
          onClick={() => setPageNum(pageNum + 1)}
        >
          {compact ? '→' : 'Page →'}
        </button>
      </div>

      <div
        ref={holderRef}
        onClick={pageClick}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        style={{
          position: 'relative',
          cursor: mode === 'read' ? 'default' : 'crosshair',
          touchAction: mode === 'draw' || mode === 'highlight' ? 'none' : 'auto',
          border: '1px solid var(--line)',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%' }} />
        <canvas
          ref={overlayRef}
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, maxWidth: '100%', pointerEvents: 'none' }}
        />
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
            <p className="hint" style={{ margin: 0 }}>
              {draftScope === 'production'
                ? '📌 Saving as a production note — everyone sees it.'
                : '📝 Saving as a personal note — only you see it. (The checkbox above switches.)'}
            </p>
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
