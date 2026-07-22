import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import SidesCutter from '../components/SidesCutter.tsx'
import { LINE_NOTE_LABELS, chatName, firstLastInitial, memberName } from '../lib/types.ts'
import type { AnnotationRecord, LineNoteKind, LineNoteRecord, ResourceRecord } from '../lib/types.ts'

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
  const [searchParams] = useSearchParams()
  const [pageNum, setPageNum] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1))
  const [pageCount, setPageCount] = useState(0)
  const [notes, setNotes] = useState<AnnotationRecord[]>([])
  const [mode, setMode] = useState<'read' | 'pin' | 'draw' | 'highlight' | 'erase' | 'line'>('read')
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null)
  const [draftText, setDraftText] = useState('')
  const [draftScope, setDraftScope] = useState<'personal' | 'production'>('personal')
  const [color, setColor] = useState<keyof typeof HIGHLIGHT_COLORS>('yellow')
  // Highlight style: freehand, snapped-straight, or a filled box — phones
  // wobble, and a block of text wants one wash, not four passes.
  const [hlStyle, setHlStyle] = useState<'free' | 'straight' | 'box'>(
    () => (localStorage.getItem('gt-highlight-style') as 'free' | 'straight' | 'box') || 'straight',
  )

  function pickHlStyle(v: 'free' | 'straight' | 'box') {
    setHlStyle(v)
    localStorage.setItem('gt-highlight-style', v)
  }
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
  const [lineNotes, setLineNotes] = useState<LineNoteRecord[]>([])
  const [lineDraft, setLineDraft] = useState<{ x: number; y: number } | null>(null)
  const [lineMember, setLineMember] = useState('')
  const [lineKind, setLineKind] = useState<LineNoteKind>('dropped')
  const [lineText, setLineText] = useState('')
  const [openLineNote, setOpenLineNote] = useState('')
  const [sendBusy, setSendBusy] = useState(false)
  const [sendStatus, setSendStatus] = useState('')
  const [sendErr, setSendErr] = useState('')
  const [noteErr, setNoteErr] = useState('')
  // "My lines": glow paints them, hide covers them for off-book practice.
  // Regions come from the PDF's embedded text (same as line-note snippets) —
  // best-effort speaker-tag parsing, nothing stored on the server.
  const [myLinesMode, setMyLinesMode] = useState<'off' | 'glow' | 'hide'>('off')
  const [myChars, setMyChars] = useState('')
  const [myRegions, setMyRegions] = useState<{ x0: number; y0: number; x1: number; y1: number }[]>([])
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const regionCache = useRef(new Map<string, { x0: number; y0: number; x1: number; y1: number }[]>())
  // Undo: ids of annotations created in THIS sitting, newest last.
  const [undoStack, setUndoStack] = useState<string[]>([])
  // Erase mode collects a selection; one tap of the erase button clears them all.
  const [selected, setSelected] = useState<Set<string>>(new Set())
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
    const lns = await pb.collection('line_notes').getFullList<LineNoteRecord>({
      filter: pb.filter('resource = {:r}', { r: resourceId }),
      expand: 'member,member.user,author',
      sort: 'page,created',
    })
    setLineNotes(lns)
  }

  // Deep link from a To-Do line note: ?note=<id> jumps to its page and opens
  // it, so the 🎯 pin marks the exact spot without hunting. One-shot — after
  // arrival the reader navigates freely.
  const jumpedToNote = useRef(false)
  useEffect(() => {
    if (jumpedToNote.current) return
    const target = searchParams.get('note')
    if (!target) return
    const n = lineNotes.find((x) => x.id === target)
    if (!n) return
    jumpedToNote.current = true
    setPageNum(n.page)
    setOpenLineNote(n.id)
  }, [lineNotes, searchParams])

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

  // Default the character name from their cast assignment; remember edits
  // per document on this device.
  useEffect(() => {
    if (!resourceId) return
    const saved = localStorage.getItem(`gt-chars-${resourceId}`)
    if (saved !== null) {
      setMyChars(saved)
      return
    }
    const mine = members.find((m) => m.user === user?.id && m.role === 'performer')
    if (mine?.position) setMyChars(mine.position)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, members.length])

  // Find this page's regions of "my" dialogue from the embedded text.
  // Heuristics for stage formats: a speaker tag is a short all-caps line (or
  // one ending with a colon); a speech runs until the next tag. Inline tags
  // ("GANDER. Welcome to the Rock.") count too. Tags themselves are never
  // covered — they're the "you're up" cue.
  async function computeMyLines(
    pageN: number,
    chars: string[],
  ): Promise<{ x0: number; y0: number; x1: number; y1: number }[]> {
    if (!pdf || chars.length === 0) return []
    const key = `${pageN}|${chars.join(',')}`
    const cached = regionCache.current.get(key)
    if (cached) return cached
    const page = await pdf.getPage(pageN)
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    type TLine = { y: number; x0: number; x1: number; h: number; parts: { x: number; str: string }[] }
    const lines: TLine[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [vx, vy] = vp.convertToViewportPoint(item.transform[4], item.transform[5])
      const x = vx / vp.width
      const y = vy / vp.height
      const w = (item.width || 0) / vp.width
      const h = (item.height || 0) / vp.height || 0.012
      const near = lines.find((l) => Math.abs(l.y - y) < 0.008)
      if (near) {
        near.parts.push({ x, str: item.str })
        near.x0 = Math.min(near.x0, x)
        near.x1 = Math.max(near.x1, x + w)
        near.h = Math.max(near.h, h)
      } else {
        lines.push({ y, x0: x, x1: x + w, h, parts: [{ x, str: item.str }] })
      }
    }
    lines.sort((a, b) => a.y - b.y)
    const textOf = (l: TLine) =>
      l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim()
    const caps = (t: string) => /^[A-Z0-9 .,:;&'()#/-]+$/.test(t) && /[A-Z]{2}/.test(t)
    // A tag ends with ':', or is 1–2 caps words — longer caps lines without a
    // colon are usually sung lyrics, not speaker names.
    const isTag = (t: string) =>
      caps(t) &&
      (t.endsWith(':') ||
        (t.split(' ').length <= 2 && t.length <= 24) ||
        (t.endsWith('.') && t.split(' ').length <= 3))
    const matchesMe = (t: string) => {
      const up = t.replace(/[.:]+$/, '').trim().toUpperCase()
      return chars.some((c) => up === c || up.startsWith(c + ' ') || up.startsWith(c + ','))
    }
    const out: { x0: number; y0: number; x1: number; y1: number }[] = []
    let inMine = false
    for (const l of lines) {
      const t = textOf(l)
      if (!t) continue
      // "(shouting)" and other parentheticals are often lowercase — strip
      // them before deciding whether this line is a speaker tag.
      const base = t.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
      if (base && isTag(base)) {
        inMine = matchesMe(base)
        continue
      }
      const inline = /^([A-Z][A-Z .,&'/-]{1,28}?)[.:]\s+\S/.exec(t)
      if (inline) {
        inMine = matchesMe(inline[1])
        if (!inMine) continue
      }
      if (inMine) out.push({ x0: l.x0, y0: l.y - l.h, x1: l.x1, y1: l.y + l.h * 0.35 })
    }
    regionCache.current.set(key, out)
    return out
  }

  useEffect(() => {
    setRevealed(new Set())
    const chars = myChars
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
    if (myLinesMode === 'off' || chars.length === 0 || !pdf) {
      setMyRegions([])
      return
    }
    let cancelled = false
    computeMyLines(pageNum, chars)
      .then((r) => {
        if (!cancelled) setMyRegions(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLinesMode, myChars, pageNum, pdf])

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
    if (faded) ctx.globalAlpha = 0.35
    if (kind === 'box') {
      ctx.fillStyle = (HIGHLIGHT_COLORS[colorKey ?? 'yellow'] ?? HIGHLIGHT_COLORS.yellow).stroke
      const x = Math.min(pts[0].x, pts[1].x) * w
      const y = Math.min(pts[0].y, pts[1].y) * h
      ctx.fillRect(x, y, Math.abs(pts[1].x - pts[0].x) * w, Math.abs(pts[1].y - pts[0].y) * h)
    } else {
      strokeStyle(kind, ctx, w, colorKey)
      ctx.beginPath()
      ctx.moveTo(pts[0].x * w, pts[0].y * h)
      for (const pt of pts.slice(1)) ctx.lineTo(pt.x * w, pt.y * h)
      ctx.stroke()
    }
    ctx.restore()
  }

  function repaintOverlay() {
    const overlay = overlayRef.current
    const ctx = overlay?.getContext('2d')
    if (!overlay || !ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    // "My lines" layer sits under everyone's marks.
    if (myLinesMode !== 'off') {
      for (let i = 0; i < myRegions.length; i++) {
        const r = myRegions[i]
        const pad = overlay.width * 0.004
        const x = r.x0 * overlay.width - pad
        const y = r.y0 * overlay.height - pad
        const w = (r.x1 - r.x0) * overlay.width + pad * 2
        const h = (r.y1 - r.y0) * overlay.height + pad * 2
        if (myLinesMode === 'glow') {
          ctx.fillStyle = 'rgba(255, 214, 0, 0.3)'
          ctx.fillRect(x, y, w, h)
        } else if (!revealed.has(i)) {
          ctx.fillStyle = '#dcd9cf'
          ctx.fillRect(x, y, w, h)
          ctx.strokeStyle = '#b9b4a4'
          ctx.lineWidth = Math.max(1, overlay.width * 0.001)
          ctx.strokeRect(x, y, w, h)
        }
      }
    }
    for (const n of notes) {
      if (n.page !== pageNum || !n.path?.length) continue
      if (n.done && !showDone) continue
      paintStroke(ctx, n.path, n.kind ?? 'draw', overlay.width, overlay.height, !!n.done, n.color)
      if (selected.has(n.id)) {
        // marked for erasing: dashed red outline
        ctx.save()
        ctx.strokeStyle = '#b3372f'
        ctx.lineWidth = overlay.width * 0.003
        ctx.setLineDash([overlay.width * 0.01, overlay.width * 0.008])
        if (n.kind === 'box' && n.path.length >= 2) {
          const x = Math.min(n.path[0].x, n.path[1].x) * overlay.width
          const y = Math.min(n.path[0].y, n.path[1].y) * overlay.height
          ctx.strokeRect(
            x,
            y,
            Math.abs(n.path[1].x - n.path[0].x) * overlay.width,
            Math.abs(n.path[1].y - n.path[0].y) * overlay.height,
          )
        } else {
          ctx.beginPath()
          ctx.moveTo(n.path[0].x * overlay.width, n.path[0].y * overlay.height)
          for (const pt of n.path.slice(1)) ctx.lineTo(pt.x * overlay.width, pt.y * overlay.height)
          ctx.stroke()
        }
        ctx.restore()
      }
    }
  }

  // Repaint saved strokes whenever the page (re)renders or notes change.
  useEffect(() => {
    repaintOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, pageNum, renderTick, showDone, selected, myLinesMode, myRegions, revealed])

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
    const overlay = overlayRef.current
    const ctx = overlay?.getContext('2d')
    if (!overlay || !ctx) return
    const guided = mode === 'highlight' && hlStyle !== 'free'
    if (guided) {
      // straight/box preview: redraw everything plus the shape so far
      repaintOverlay()
      const first = strokeRef.current[0]
      if (hlStyle === 'box') {
        paintStroke(ctx, [first, pt], 'box', overlay.width, overlay.height, false, color)
      } else {
        paintStroke(ctx, [first, snapStraight(first, pt)], 'highlight', overlay.width, overlay.height, false, color)
      }
    } else {
      paintStroke(ctx, strokeRef.current.slice(-2), mode, overlay.width, overlay.height, false, color)
    }
  }

  // Nearly-level lines snap level — highlighting text wants horizontal.
  function snapStraight(a: { x: number; y: number }, b: { x: number; y: number }) {
    if (Math.abs(b.y - a.y) < 0.015) return { x: b.x, y: a.y }
    return b
  }

  async function pointerUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    let pts = strokeRef.current
    strokeRef.current = []
    if (pts.length < 2 || !resourceId) return
    let kind: string = mode === 'highlight' ? 'highlight' : 'draw'
    if (mode === 'highlight' && hlStyle === 'straight') {
      pts = [pts[0], snapStraight(pts[0], pts[pts.length - 1])]
    } else if (mode === 'highlight' && hlStyle === 'box') {
      kind = 'box'
      pts = [pts[0], pts[pts.length - 1]]
    }
    try {
      const rec = await pb.collection('annotations').create({
        production: production.id,
        resource: resourceId,
        user: user!.id,
        page: pageNum,
        x: pts[0].x,
        y: pts[0].y,
        text: '',
        kind,
        color: mode === 'highlight' ? color : '',
        path: pts,
        scope: isManager ? draftScope : 'personal',
        done: false,
      })
      setUndoStack((prev) => [...prev, rec.id].slice(-50))
      setNoteErr('')
      await loadNotes()
    } catch {
      setNoteErr("Couldn't save that mark — check your connection and try again.")
    }
  }

  async function eraseAt(x: number, y: number) {
    const rect = holderRef.current?.getBoundingClientRect()
    if (!rect) return
    const threshold = 18 / rect.width // ~18px in normalized units
    const aspect = rect.height / rect.width
    const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const ax = a.x, ay = a.y * aspect, bx = b.x, by = b.y * aspect, px = p.x, py = p.y * aspect
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    }
    for (const n of notes) {
      if (n.page !== pageNum || !n.path?.length) continue
      const mine = n.user === user?.id || (n.scope === 'production' && isManager)
      if (!mine) continue
      const hit =
        n.kind === 'box' && n.path.length >= 2
          ? x >= Math.min(n.path[0].x, n.path[1].x) - threshold &&
            x <= Math.max(n.path[0].x, n.path[1].x) + threshold &&
            y >= Math.min(n.path[0].y, n.path[1].y) - threshold &&
            y <= Math.max(n.path[0].y, n.path[1].y) + threshold
          : n.path.some(
              (pt, i) =>
                (i > 0 && segDist({ x, y }, n.path![i - 1], pt) < threshold) ||
                Math.hypot(pt.x - x, (pt.y - y) * aspect) < threshold,
            )
      if (hit) {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(n.id)) next.delete(n.id)
          else next.add(n.id)
          return next
        })
        return
      }
    }
  }

  async function eraseSelected() {
    if (selected.size === 0) return
    if (
      !window.confirm(
        `Erase ${selected.size === 1 ? 'this mark' : `these ${selected.size} marks`}? This can't be undone.`,
      )
    )
      return
    for (const id of selected) {
      try {
        await pb.collection('annotations').delete(id)
      } catch {
        /* already gone */
      }
    }
    setSelected(new Set())
    setUndoStack((prev) => prev.filter((id) => !selected.has(id)))
    await loadNotes()
  }

  async function undoLast() {
    const id = undoStack[undoStack.length - 1]
    if (!id) return
    setUndoStack((prev) => prev.slice(0, -1))
    try {
      await pb.collection('annotations').delete(id)
    } catch {
      /* already erased another way */
    }
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    await loadNotes()
  }

  function pageClick(e: React.MouseEvent<HTMLDivElement>) {
    // Off-book peek: in read mode a tap on a covered line reveals it.
    if (mode === 'read' && myLinesMode === 'hide' && holderRef.current) {
      const rect = holderRef.current.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      const i = myRegions.findIndex(
        (r) => x >= r.x0 - 0.01 && x <= r.x1 + 0.01 && y >= r.y0 - 0.005 && y <= r.y1 + 0.005,
      )
      if (i >= 0) {
        setRevealed((prev) => {
          const next = new Set(prev)
          if (next.has(i)) next.delete(i)
          else next.add(i)
          return next
        })
        return
      }
    }
    if (mode === 'line' && isManager && holderRef.current) {
      const rect = holderRef.current.getBoundingClientRect()
      setLineDraft({
        x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
        y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
      })
      return
    }
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
    try {
      const rec = await pb.collection('annotations').create({
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
      setUndoStack((prev) => [...prev, rec.id].slice(-50))
      setNoteErr('')
      setDraft(null)
      setDraftText('')
      setMode('read')
      await loadNotes()
    } catch {
      setNoteErr("Couldn't save that note — check your connection and try again.")
    }
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

  // Pull the printed lines around the tapped spot from the PDF's embedded
  // text — the tapped line plus one above and one below, so the actor can
  // read the moment without even opening the script. Digital scripts have
  // real text; scanned photocopies yield nothing and we quietly skip it.
  async function snippetAround(yFrac: number): Promise<string> {
    if (!pdf) return ''
    try {
      const page = await pdf.getPage(pageNum)
      const vp = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      type TextLine = { y: number; parts: { x: number; str: string }[] }
      const lines: TextLine[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const [vx, vy] = vp.convertToViewportPoint(item.transform[4], item.transform[5])
        const x = vx / vp.width
        const y = vy / vp.height
        const near = lines.find((l) => Math.abs(l.y - y) < 0.008)
        if (near) near.parts.push({ x, str: item.str })
        else lines.push({ y, parts: [{ x, str: item.str }] })
      }
      if (lines.length === 0) return ''
      lines.sort((a, b) => a.y - b.y)
      let nearest = 0
      for (let i = 1; i < lines.length; i++) {
        if (Math.abs(lines[i].y - yFrac) < Math.abs(lines[nearest].y - yFrac)) nearest = i
      }
      const joinLine = (l: TextLine) =>
        l.parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      return lines
        .slice(Math.max(0, nearest - 1), nearest + 2)
        .map(joinLine)
        .filter(Boolean)
        .join('\n')
        .slice(0, 400)
    } catch {
      return ''
    }
  }

  async function saveLineNote() {
    if (!lineDraft || !lineMember || !resourceId) return
    const snippet = await snippetAround(lineDraft.y)
    await pb.collection('line_notes').create({
      production: production.id,
      resource: resourceId,
      member: lineMember,
      author: user!.id,
      page: pageNum,
      x: lineDraft.x,
      y: lineDraft.y,
      kind: lineKind,
      text: lineText.trim(),
      snippet,
      done: false,
    })
    setLineDraft(null)
    setLineText('')
    await loadNotes()
  }

  // One push per rehearsal, not per note: send everything not yet notified.
  async function sendLineNotes() {
    setSendBusy(true)
    setSendStatus('')
    setSendErr('')
    try {
      const res = await pb.send<{ notes: number; people: number }>(
        '/api/glowtape/line-notes/send',
        { method: 'POST', body: { production: production.id } },
      )
      setSendStatus(
        res.notes === 0
          ? 'Nothing new to send.'
          : `Sent — ${res.notes} note${res.notes === 1 ? '' : 's'} to ${res.people} ${
              res.people === 1 ? 'person' : 'people'
            }.`,
      )
      await loadNotes()
    } catch {
      setSendErr('Sending failed — check your connection and try again.')
    } finally {
      setSendBusy(false)
    }
  }

  async function toggleLineDone(n: LineNoteRecord) {
    await pb.collection('line_notes').update(n.id, { done: !n.done })
    await loadNotes()
  }

  async function removeLineNote(n: LineNoteRecord) {
    if (!window.confirm('Delete this line note?')) return
    await pb.collection('line_notes').delete(n.id)
    setOpenLineNote('')
    await loadNotes()
  }

  const lineWho = (n: LineNoteRecord) => {
    const m = n.expand?.member
    if (!m) return 'someone'
    const full = m.expand?.user?.name
    return full ? chatName(full, m) : memberName(m)
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
            ...((isManager ? [['line', '🎯 Line note']] : []) as ['line', string][]),
          ] as readonly (readonly [string, string])[]
        ).map(([m, label]) => (
          <button
            type="button"
            key={m}
            className={`chip ${mode === m ? 'chip-active' : ''}`}
            aria-pressed={mode === m}
            aria-label={label.replace(/^\S+\s/, '')}
            onClick={() => {
              setMode(m as typeof mode)
              setDraft(null)
              setLineDraft(null)
              if (m !== 'erase') setSelected(new Set())
            }}
          >
            {compact ? label.split(' ')[0] : label}
          </button>
        ))}
        {undoStack.length > 0 && (
          <button
            type="button"
            className="chip"
            aria-label="Undo my last note or mark"
            onClick={undoLast}
          >
            ↩{compact ? '' : ' Undo'}
          </button>
        )}
        {compact && isManager && draftScope === 'production' && (
          <span className="pill" title="New notes and marks are production-wide">📌 all</span>
        )}
      </div>
      <div className="chips no-print" role="group" aria-label="My lines">
        <button
          type="button"
          className={`chip ${myLinesMode === 'glow' ? 'chip-active' : ''}`}
          aria-pressed={myLinesMode === 'glow'}
          aria-label="Highlight my lines"
          onClick={() => setMyLinesMode(myLinesMode === 'glow' ? 'off' : 'glow')}
        >
          ✨{compact ? '' : ' My lines'}
        </button>
        <button
          type="button"
          className={`chip ${myLinesMode === 'hide' ? 'chip-active' : ''}`}
          aria-pressed={myLinesMode === 'hide'}
          aria-label="Off book — cover my lines"
          onClick={() => setMyLinesMode(myLinesMode === 'hide' ? 'off' : 'hide')}
        >
          🙈{compact ? '' : ' Off book'}
        </button>
        {myLinesMode !== 'off' && (
          <input
            aria-label="Your character name or names, comma-separated"
            value={myChars}
            onChange={(e) => {
              setMyChars(e.target.value)
              if (resourceId) localStorage.setItem(`gt-chars-${resourceId}`, e.target.value)
            }}
            placeholder="Character name(s) — for example: GANDER, ANNETTE"
            style={{ flex: 1, minWidth: '11rem' }}
          />
        )}
      </div>
      {myLinesMode === 'hide' && !compact && (
        <p className="hint no-print">
          Your lines are covered. Read the other lines as your cues, say yours out loud, then
          tap a gray bar to peek and check yourself — tap again to cover it. Turning the page
          covers everything again.
        </p>
      )}
      {myLinesMode !== 'off' && myRegions.length === 0 && myChars.trim() !== '' && (
        <p className="hint no-print">
          Nothing found for “{myChars}” on this page — make sure it's spelled the way the
          script prints the speaker names (this works best on scripts with standard
          NAME-then-dialogue formatting).
        </p>
      )}
      {mode === 'pin' && !compact && (
        <p className="hint no-print">Tap the spot on the page where the note goes.</p>
      )}
      {mode === 'line' && !compact && (
        <p className="hint no-print">
          Tap the line in the script, then say whose it was and what happened — they get it
          instantly and check it off once it's solid. Only they (and the team) see it.
        </p>
      )}
      {mode === 'highlight' && (
        <div className="chips no-print" role="group" aria-label="Highlighter style">
          {(
            [
              ['straight', '📏', 'Straight line'],
              ['box', '▭', 'Box'],
              ['free', '✍', 'Freehand'],
            ] as const
          ).map(([v, icon, label]) => (
            <button
              type="button"
              key={v}
              className={`chip ${hlStyle === v ? 'chip-active' : ''}`}
              aria-pressed={hlStyle === v}
              aria-label={label}
              onClick={() => pickHlStyle(v)}
            >
              {compact ? icon : `${icon} ${label}`}
            </button>
          ))}
        </div>
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
        <p className="hint no-print">
          Tap your drawings and highlights to mark them — tap again to unmark — then erase
          them all at once.
        </p>
      )}
      {mode === 'erase' && selected.size > 0 && (
        <div className="row no-print" style={{ alignItems: 'center' }}>
          <button type="button" onClick={eraseSelected}>
            🧽 Erase {selected.size === 1 ? 'the marked one' : `all ${selected.size} marked`}
          </button>
          <button type="button" className="link" onClick={() => setSelected(new Set())}>
            Unmark all
          </button>
        </div>
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
        <button
          type="button"
          aria-label="Previous page"
          disabled={pageNum <= 1}
          onClick={() => setPageNum(pageNum - 1)}
        >
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
          aria-label="Next page"
          disabled={pageNum >= pageCount}
          onClick={() => setPageNum(pageNum + 1)}
        >
          {compact ? '→' : 'Page →'}
        </button>
      </div>

      {noteErr && (
        <p className="error" role="alert">
          {noteErr}
        </p>
      )}
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
        {lineNotes
          .filter((n) => n.page === pageNum && (showDone || !n.done))
          .map((n) => (
            <button
              key={n.id}
              type="button"
              aria-label={`Line note for ${lineWho(n)}: ${LINE_NOTE_LABELS[n.kind]}`}
              onClick={(e) => {
                e.stopPropagation()
                setOpenLineNote(openLineNote === n.id ? '' : n.id)
                setOpenNote('')
              }}
              style={{
                position: 'absolute',
                left: `${n.x * 100}%`,
                top: `${n.y * 100}%`,
                transform: 'translate(-50%, -90%)',
                background: 'none',
                border: 'none',
                padding: '0.3rem',
                minHeight: '1.9rem',
                minWidth: '1.9rem',
                fontSize: openLineNote === n.id ? '2rem' : '1.4rem',
                opacity: n.done ? 0.45 : 1,
                filter: n.done
                  ? 'grayscale(1)'
                  : openLineNote === n.id
                    ? 'drop-shadow(0 0 6px rgba(255, 200, 0, 0.9))'
                    : 'none',
              }}
            >
              🎯
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
        {lineDraft && (
          <span
            style={{
              position: 'absolute',
              left: `${lineDraft.x * 100}%`,
              top: `${lineDraft.y * 100}%`,
              transform: 'translate(-50%, -90%)',
              fontSize: '1.4rem',
            }}
          >
            🎯
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

      {lineDraft && (
        <div className="card stack">
          <strong>🎯 Line note — page {pageNum}</strong>
          <label>
            Whose line?
            <select
              aria-label="Who the line note is for"
              value={lineMember}
              onChange={(e) => setLineMember(e.target.value)}
            >
              <option value="">— pick a person —</option>
              {members
                .filter((m) => m.role !== 'guardian' && !m.claimedFrom)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberName(m)}
                  </option>
                ))}
            </select>
          </label>
          <div className="chips">
            {(Object.keys(LINE_NOTE_LABELS) as LineNoteKind[]).map((k) => (
              <button
                type="button"
                key={k}
                className={`chip ${lineKind === k ? 'chip-active' : ''}`}
                aria-pressed={lineKind === k}
                onClick={() => setLineKind(k)}
              >
                {LINE_NOTE_LABELS[k]}
              </button>
            ))}
          </div>
          <label>
            The line, or what happened (optional)
            <input
              maxLength={500}
              value={lineText}
              onChange={(e) => setLineText(e.target.value)}
              placeholder={'Example: "We were somewhere in the middle of nowhere" — jumped to verse 2'}
            />
          </label>
          <div className="row">
            <button type="button" onClick={saveLineNote} disabled={!lineMember}>
              Save the line note
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setLineDraft(null)
                setLineText('')
              }}
            >
              Never mind
            </button>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            It lands on their To-Do tab, and only they (and the production team) can see it.
            No phones buzz yet — when you're done for the night, tap 📣 in the list below to
            send everyone their notes in one notification each.
          </p>
        </div>
      )}

      {openLineNote &&
        (() => {
          const n = lineNotes.find((x) => x.id === openLineNote)
          if (!n) return null
          const canMark = isManager || n.expand?.member?.user === user?.id || n.expand?.member?.guardians?.includes(user?.id ?? '')
          // Step through open notes in page order without leaving the script.
          const cycle = lineNotes.filter((x) => !x.done)
          const idx = cycle.findIndex((x) => x.id === n.id)
          const step = (dir: 1 | -1) => {
            const next = cycle[(idx + dir + cycle.length) % cycle.length]
            setPageNum(next.page)
            setOpenLineNote(next.id)
          }
          return (
            <div className="card stack" role="region" aria-label="Line note details">
              <p style={{ margin: 0 }}>
                🎯 <strong>{LINE_NOTE_LABELS[n.kind]}</strong> — {lineWho(n)}
              </p>
              {n.snippet && (
                <blockquote
                  className="hint"
                  style={{
                    margin: 0,
                    borderLeft: '3px solid var(--accent, #888)',
                    paddingLeft: '0.6rem',
                    whiteSpace: 'pre-wrap',
                    fontStyle: 'italic',
                  }}
                >
                  {n.snippet}
                </blockquote>
              )}
              {n.text && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.text}</p>}
              <p className="hint" style={{ margin: 0 }}>
                page {n.page} · from {n.expand?.author?.name ? firstLastInitial(n.expand.author.name) : 'the team'}
                {n.done ? ' · done ✓' : idx >= 0 && cycle.length > 1 ? ` · note ${idx + 1} of ${cycle.length} open` : ''}
              </p>
              <div className="row">
                {canMark && (
                  <button
                    type="button"
                    onClick={async () => {
                      // Fixing a note flows straight to the next open one, so
                      // working through the night's notes never loses its place.
                      const next = !n.done && cycle.length > 1 ? cycle[(idx + 1) % cycle.length] : null
                      await toggleLineDone(n)
                      if (next && next.id !== n.id) {
                        setPageNum(next.page)
                        setOpenLineNote(next.id)
                      }
                    }}
                  >
                    {n.done ? '↩ Not fixed yet' : "✓ Got it — it's fixed"}
                  </button>
                )}
                {idx >= 0 && cycle.length > 1 && (
                  <>
                    <button type="button" className="link" onClick={() => step(-1)}>
                      ◂ Previous
                    </button>
                    <button type="button" className="link" onClick={() => step(1)}>
                      Next ▸
                    </button>
                  </>
                )}
                {isManager && (
                  <button type="button" className="link" onClick={() => removeLineNote(n)}>
                    Delete
                  </button>
                )}
                <button type="button" className="link" onClick={() => setOpenLineNote('')}>
                  Close
                </button>
                {!isManager && (
                  <Link className="link" to={`/production/${production.id}/todo`}>
                    ← My To-Do list
                  </Link>
                )}
              </div>
            </div>
          )
        })()}

      {openNote &&
        (() => {
          const n = notes.find((x) => x.id === openNote)
          if (!n) return null
          const canEdit = n.user === user?.id || (n.scope === 'production' && isManager)
          return (
            <div className="card stack" role="region" aria-label="Note details">
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

      {lineNotes.length > 0 && (
        <>
          <h3 className="dept-heading">
            🎯 Line notes ({lineNotes.filter((n) => !n.done).length} open)
          </h3>
          {isManager && lineNotes.some((n) => !n.notified) && (
            <div className="row" style={{ alignItems: 'center' }}>
              <button type="button" onClick={sendLineNotes} disabled={sendBusy}>
                {sendBusy
                  ? 'Sending…'
                  : `📣 Send tonight's line notes (${lineNotes.filter((n) => !n.notified).length})`}
              </button>
              <span className="hint">One notification per person, covering all their notes.</span>
            </div>
          )}
          {sendStatus && (
            <p className="acked" role="status">
              {sendStatus}
            </p>
          )}
          {sendErr && (
            <p className="error" role="alert">
              {sendErr}
            </p>
          )}
          <ul className="plain-list">
            {lineNotes
              .filter((n) => showDone || !n.done)
              .map((n) => {
                const canMark =
                  isManager ||
                  n.expand?.member?.user === user?.id ||
                  n.expand?.member?.guardians?.includes(user?.id ?? '')
                return (
                  <li key={n.id} className="row" style={{ alignItems: 'center' }}>
                    {canMark ? (
                      <input
                        type="checkbox"
                        aria-label={`Mark fixed: ${LINE_NOTE_LABELS[n.kind]} p. ${n.page}`}
                        checked={n.done}
                        onChange={() => toggleLineDone(n)}
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
                        setOpenLineNote(n.id)
                        setOpenNote('')
                      }}
                    >
                      p. {n.page} — {LINE_NOTE_LABELS[n.kind]}
                      {isManager ? ` — ${lineWho(n)}` : ''}
                      {n.text ? ` — ${n.text.slice(0, 60)}${n.text.length > 60 ? '…' : ''}` : ''}
                    </button>
                  </li>
                )
              })}
          </ul>
        </>
      )}

      <h3 className="dept-heading">
        Notes in this document ({openCount} open)
      </h3>
      {visibleNotes.length === 0 && (
        <p className="hint">No notes yet — tap 📝 Note, then the spot on the page where it goes.</p>
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
      {isManager && resource && pageCount > 0 && (
        <SidesCutter resource={resource} pageCount={pageCount} />
      )}
    </section>
  )
}
