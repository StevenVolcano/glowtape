import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { formatStamp, pbDate } from '../lib/types.ts'
import type { ChannelRecord, NoteRecord } from '../lib/types.ts'

// Rehearsal notes (and any other production notes). Each note has a stable
// URL — Copy link, paste it in a channel, and the chat makes it tappable.
export default function NotesTab() {
  const { production, isManager } = useProduction()
  const { user } = useAuth()
  const { noteId } = useParams()
  const navigate = useNavigate()
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')

  const base = `/production/${production.id}/notes`

  async function load() {
    const list = await pb.collection('notes').getFullList<NoteRecord>({
      filter: pb.filter('production = {:p}', { p: production.id }),
      sort: '-updated',
      expand: 'author',
    })
    setNotes(list)
    setLoaded(true)
  }

  useEffect(() => {
    load().catch(() => setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  async function newNote() {
    const today = new Date()
    const rec = await pb.collection('notes').create<NoteRecord>({
      production: production.id,
      author: user?.id,
      title: `Rehearsal notes — ${today.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })}`,
      body: '',
    })
    await load()
    navigate(`${base}/${rec.id}`)
  }

  const q = query.trim().toLowerCase()
  const matches = q
    ? notes.filter(
        (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
      )
    : notes

  // A little context around the first body hit, so you can tell WHICH
  // "fainting couch" note this is without opening it.
  function snippet(n: NoteRecord): string {
    if (!q || n.title.toLowerCase().includes(q)) return ''
    const i = n.body.toLowerCase().indexOf(q)
    if (i < 0) return ''
    const from = Math.max(0, i - 30)
    const to = Math.min(n.body.length, i + q.length + 50)
    return `${from > 0 ? '…' : ''}${n.body.slice(from, to).replace(/\s+/g, ' ')}${
      to < n.body.length ? '…' : ''
    }`
  }

  const selected = noteId ? notes.find((n) => n.id === noteId) : null

  if (noteId && loaded && !selected) {
    return (
      <section>
        <p className="error">That note isn't here anymore.</p>
        <button className="link" onClick={() => navigate(base)}>
          ← All notes
        </button>
      </section>
    )
  }

  if (selected) {
    return (
      <NoteView
        note={selected}
        canEdit={isManager || selected.author === user?.id}
        onBack={() => navigate(base)}
        onChanged={load}
      />
    )
  }

  return (
    <div>
      <section>
        <h2>Notes</h2>
        <p className="hint">
          Rehearsal notes, production meetings, whatever needs writing down. Every note has a
          link you can paste into a channel so the right people can tap straight into it.
        </p>
        <button onClick={newNote}>+ New note</button>
        {loaded && notes.length === 0 && (
          <p className="hint">No notes yet — tap the button after your next run-through.</p>
        )}
        {notes.length > 1 && (
          <input
            type="search"
            aria-label="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes — e.g. fainting couch, cue 12, Act 2…"
            style={{ marginTop: '0.75rem' }}
          />
        )}
        {q && (
          <p className="hint" role="status">
            {matches.length === 0
              ? 'No notes mention that.'
              : `${matches.length} of ${notes.length} notes match.`}
          </p>
        )}
        <ul className="plain-list">
          {matches.map((n) => (
            <li key={n.id}>
              <button className="link" onClick={() => navigate(`${base}/${n.id}`)}>
                📝 {n.title}
              </button>{' '}
              <span className="hint">
                {n.expand?.author?.name} · {formatStamp(n.updated)}
              </span>
              {snippet(n) && <div className="hint">“{snippet(n)}”</div>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function NoteView({
  note,
  canEdit,
  onBack,
  onChanged,
}: {
  note: NoteRecord
  canEdit: boolean
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [channels, setChannels] = useState<ChannelRecord[]>([])
  const [channelId, setChannelId] = useState('')

  useEffect(() => {
    pb.collection('channels')
      .getFullList<ChannelRecord>({
        filter: pb.filter('production = {:p} && archived != true', { p: note.production }),
        sort: 'created',
      })
      .then((list) => {
        setChannels(list)
        setChannelId((prev) => prev || list.find((c) => !c.member)?.id || '')
      })
      .catch(() => {})
  }, [note.production])

  async function postToChat() {
    if (!channelId) return
    setBusy(true)
    try {
      const url = `${window.location.origin}/production/${note.production}/notes/${note.id}`
      await pb.collection('messages').create({
        channel: channelId,
        author: user?.id,
        text: url,
      })
      const name = channels.find((c) => c.id === channelId)?.name ?? 'the channel'
      setSaved(`Posted to ${name}. ✓`)
      setTimeout(() => setSaved(''), 4000)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
    setSaved('')
  }, [note.id, note.title, note.body])

  async function save() {
    setBusy(true)
    setSaved('')
    try {
      await pb.collection('notes').update(note.id, { title: title.trim() || note.title, body })
      setSaved('Saved. ✓')
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/production/${note.production}/notes/${note.id}`,
    )
    setSaved('Link copied — paste it into a channel.')
    setTimeout(() => setSaved(''), 3000)
  }

  async function remove() {
    if (!window.confirm(`Delete "${note.title}"?`)) return
    await pb.collection('notes').delete(note.id)
    await onChanged()
    onBack()
  }

  return (
    <section>
      <button className="link" onClick={onBack}>
        ← All notes
      </button>
      <div className="stack">
        {canEdit ? (
          <input
            aria-label="Note title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        ) : (
          <h2>{note.title}</h2>
        )}
        <p className="hint">
          {note.expand?.author?.name} · last updated {pbDate(note.updated).toLocaleString()}
        </p>
        {canEdit ? (
          <textarea
            aria-label="Note"
            rows={14}
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              'Act 1 — pick up the pace in the kitchen scene\nProps: fainting couch still missing a cushion\nLights: cue 12 late again…'
            }
          />
        ) : (
          <p style={{ whiteSpace: 'pre-wrap' }}>{note.body || <em>Nothing here yet.</em>}</p>
        )}
        <div className="row">
          {canEdit && (
            <button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
          <button className="link" onClick={copyLink}>
            🔗 Copy link
          </button>
          {channels.length > 0 && (
            <>
              <select
                aria-label="Channel to post to"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button onClick={postToChat} disabled={busy || !channelId}>
                💬 Post to chat
              </button>
            </>
          )}
          {canEdit && (
            <button className="link" aria-label={`Delete note ${note.title}`} onClick={remove}>
              ✕
            </button>
          )}
          {saved && <span className="acked" role="status">{saved}</span>}
        </div>
      </div>
    </section>
  )
}
