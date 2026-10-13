import { useEffect, useRef, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'

export interface GifChoice {
  id: string
  title: string
  preview: string
  width: number
  height: number
}

// GIPHY renditions by id. 200w is the chat size; _s is the still frame shown
// to people who asked their device for reduced motion.
export const gifUrl = (id: string) => `https://media.giphy.com/media/${id}/200w.webp`
export const gifFallbackUrl = (id: string) => `https://media.giphy.com/media/${id}/200w.gif`
export const gifStillUrl = (id: string) => `https://media.giphy.com/media/${id}/200w_s.gif`

// Searches run through Glow Tape's server (which keeps the GIPHY key and
// forces G-rated results) and only on submit, so typing doesn't burn the
// hourly search allowance.
export default function GifPicker({
  onPick,
  onClose,
}: {
  onPick: (gif: GifChoice) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GifChoice[]>([])
  const [status, setStatus] = useState('Loading popular GIFs…')
  const [enabled, setEnabled] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  async function search(query: string) {
    setStatus(query ? `Searching for “${query}”…` : 'Loading popular GIFs…')
    try {
      const res = await pb.send<{ enabled: boolean; results: GifChoice[] }>('/api/glowtape/gifs', {
        query: query ? { q: query } : {},
      })
      setEnabled(res.enabled)
      setResults(res.results)
      if (!res.enabled) setStatus("GIFs aren't turned on for Glow Tape yet.")
      else if (res.results.length === 0) setStatus('No GIFs found. Try another word.')
      else setStatus(query ? `${res.results.length} GIFs for “${query}”` : 'Popular right now')
    } catch (err) {
      setResults([])
      setStatus((err as { message?: string })?.message || "GIF search isn't answering right now.")
    }
  }

  useEffect(() => {
    search('')
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    search(q.trim())
  }

  return (
    <section className="gif-picker" aria-label="Choose a GIF">
      <div className="gif-picker-head">
        <strong>Choose a GIF</strong>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </div>
      {enabled && (
        <form onSubmit={submit} className="row">
          <input
            ref={inputRef}
            type="search"
            aria-label="Search GIFs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Example: applause"
          />
          <button type="submit">Search</button>
        </form>
      )}
      <p className="hint" role="status">
        {status}
      </p>
      {results.length > 0 && (
        <div className="gif-grid">
          {results.map((g) => (
            <button
              type="button"
              key={g.id}
              className="gif-choice"
              aria-label={`Use GIF: ${g.title || 'untitled'}`}
              onClick={() => onPick(g)}
            >
              <img src={g.preview} alt="" width={g.width} height={g.height} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {enabled && <p className="gif-credit">Powered by GIPHY · G-rated only</p>}
    </section>
  )
}
