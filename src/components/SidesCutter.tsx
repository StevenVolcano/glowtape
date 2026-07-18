import { useState } from 'react'
import { pb } from '../lib/pb.ts'
import { useProduction } from '../pages/Production.tsx'
import { pbErrorMessage } from '../lib/files.ts'
import type { ResourceRecord } from '../lib/types.ts'

// Cut audition sides straight from the script: name it, list the pages, and
// a new small PDF is posted with the audition materials (area 'audition', so
// it shows on the signup form while auditions are open). The cutting happens
// entirely in the browser with pdf-lib — lazy-loaded so readers who never
// cut sides don't pay for it.

function parsePages(text: string, max: number): number[] | null {
  const out: number[] = []
  for (const part of text.split(',')) {
    const p = part.trim()
    if (!p) continue
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(p)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (a < 1 || b < a || b > max) return null
    for (let i = a; i <= b; i++) out.push(i)
  }
  return [...new Set(out)]
}

export default function SidesCutter({
  resource,
  pageCount,
}: {
  resource: ResourceRecord
  pageCount: number
}) {
  const { production } = useProduction()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [range, setRange] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const pages = parsePages(range, pageCount)

  async function cut() {
    if (!pages || pages.length === 0) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const { PDFDocument } = await import('pdf-lib')
      const token = await pb.files.getToken()
      const url = pb.files.getURL(resource, resource.file, { token })
      const bytes = await (await fetch(url)).arrayBuffer()
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const out = await PDFDocument.create()
      const copied = await out.copyPages(
        src,
        pages.map((p) => p - 1),
      )
      for (const p of copied) out.addPage(p)
      const outBytes = await out.save()
      const name = title.trim() || `Side — pages ${range.trim()}`
      await pb.collection('resources').create({
        production: production.id,
        area: 'audition',
        audience: 'everyone',
        title: name,
        file: new File([outBytes], `${name.replace(/[^\w-]+/g, '-').slice(0, 60) || 'side'}.pdf`, {
          type: 'application/pdf',
        }),
      })
      setMsg(`"${name}" (${pages.length} page${pages.length === 1 ? '' : 's'}) is posted with the audition materials.`)
      setTitle('')
      setRange('')
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't cut that side — try again."))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <p className="no-print">
        <button className="link" onClick={() => setOpen(true)}>
          ✂️ Cut audition sides from this script
        </button>
      </p>
    )
  }

  return (
    <div className="card stack no-print">
      <strong>✂️ Cut audition sides</strong>
      <p className="hint" style={{ margin: 0 }}>
        Pick the pages, name the side, and it's posted with the audition materials as its
        own little PDF — auditioners see it on the signup form. The page numbers are this
        viewer's (1–{pageCount}), which may differ from the numbers printed on the script.
      </p>
      <div className="row">
        <input
          aria-label="Name of the side"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Example: Side 1 — Bankers scene"
          style={{ flex: 2, minWidth: '12rem' }}
        />
        <input
          aria-label="Pages to include"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          placeholder="Example: 34-36 or 12, 34-36"
          style={{ flex: 1, minWidth: '8rem' }}
        />
      </div>
      {range.trim() !== '' && !pages && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          Pages should look like "34-36" or "12, 34-36", within 1–{pageCount}.
        </p>
      )}
      <div className="row">
        <button type="button" onClick={cut} disabled={busy || !pages || pages.length === 0}>
          {busy
            ? 'Cutting…'
            : pages && pages.length > 0
              ? `Cut ${pages.length} page${pages.length === 1 ? '' : 's'} & post it`
              : 'Cut & post'}
        </button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {msg && <p className="acked" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  )
}
