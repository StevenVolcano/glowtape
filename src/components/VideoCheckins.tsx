import { useEffect, useRef, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from '../pages/Production.tsx'
import { formatDay, memberName } from '../lib/types.ts'
import type { GroupRecord, MemberRecord, VideoCheckinRecord, VideoRequestRecord } from '../lib/types.ts'
import {
  MAX_SECONDS,
  canRecordHere,
  checkUpload,
  fetchVideo,
  formatSeconds,
  pickRecorderType,
  uploadCheckin,
} from '../lib/videos.ts'
import { pbErrorMessage } from '../lib/files.ts'
import Section, { FoldGroup } from './Section.tsx'

// Video check-ins (migration 1759100000): a manager asks for a short video
// (dialect lines, a song cut…); each asked actor records one right here
// (3-minute cap); managers and the request's reviewer group watch and leave
// notes. Castmates never see each other's videos — the collection rules
// decide, this component just shows whatever comes back.

// Who a request asks: its members list, or every performer when empty —
// only rows someone can record for (an account, or a parent's).
const recordable = (m: MemberRecord) => !!m.user || (m.guardians?.length ?? 0) > 0
function askedMembers(r: VideoRequestRecord, members: MemberRecord[]): MemberRecord[] {
  if (r.members?.length) return members.filter((m) => r.members.includes(m.id))
  return members.filter((m) => m.role === 'performer' && recordable(m))
}

function nameWithRole(m: MemberRecord): string {
  const n = memberName(m)
  return m.position && m.position !== n ? `${n} (${m.position})` : n
}

export default function VideoCheckinsSection() {
  const { production, members, isManager } = useProduction()
  const { user } = useAuth()
  const [requests, setRequests] = useState<VideoRequestRecord[]>([])
  const [checkins, setCheckins] = useState<VideoCheckinRecord[]>([])
  const [groups, setGroups] = useState<GroupRecord[]>([])

  async function load() {
    const p = production.id
    const [rq, ci, gr] = await Promise.all([
      pb.collection('video_requests').getFullList<VideoRequestRecord>({
        filter: pb.filter('production = {:p}', { p }),
        sort: '-created',
      }),
      pb.collection('video_checkins').getFullList<VideoCheckinRecord>({
        filter: pb.filter('production = {:p}', { p }),
      }),
      pb.collection('groups').getFullList<GroupRecord>({
        filter: pb.filter('production = {:p}', { p }),
        sort: 'order,name',
      }),
    ])
    setRequests(rq)
    setCheckins(ci)
    setGroups(gr)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  const uid = user?.id ?? ''
  // rows I record for: my own (not my parent row) and my children's
  const mine = members.filter(
    (m) => m.role !== 'guardian' && (m.user === uid || m.guardians?.includes(uid)),
  )
  const myGroupIds = new Set(members.filter((m) => m.user === uid).flatMap((m) => m.groups ?? []))
  const isReviewer = (r: VideoRequestRecord) => isManager || (!!r.reviewGroup && myGroupIds.has(r.reviewGroup))

  const shown = requests.filter((r) => {
    if (isReviewer(r)) return true
    if (r.closed) return checkins.some((c) => c.request === r.id) // keep my notes visible
    return askedMembers(r, members).some((m) => mine.some((x) => x.id === m.id))
  })
  if (shown.length === 0 && !isManager) return null

  const waiting = shown.filter(
    (r) =>
      !r.closed &&
      askedMembers(r, members).some(
        (m) => mine.some((x) => x.id === m.id) && !checkins.some((c) => c.request === r.id && c.member === m.id),
      ),
  ).length

  return (
    <Section id="videos" title={<>🎥 Video check-ins{waiting > 0 ? ` (${waiting} to record)` : ''}</>}>
      {shown.length === 0 && <p className="hint">No video requests yet.</p>}
      {shown.map((r) => (
        <RequestGroup
          key={r.id}
          request={r}
          asked={askedMembers(r, members)}
          mine={mine}
          checkins={checkins.filter((c) => c.request === r.id)}
          reviewer={isReviewer(r)}
          groupName={groups.find((g) => g.id === r.reviewGroup)?.name ?? ''}
          onChange={load}
        />
      ))}
      {isManager && !production.archived && <NewRequestForm groups={groups} onAdded={load} />}
    </Section>
  )
}

function RequestGroup({
  request: r,
  asked,
  mine,
  checkins,
  reviewer,
  groupName,
  onChange,
}: {
  request: VideoRequestRecord
  asked: MemberRecord[]
  mine: MemberRecord[]
  checkins: VideoCheckinRecord[]
  reviewer: boolean
  groupName: string
  onChange: () => Promise<void>
}) {
  const { isManager, members } = useProduction()
  const { user } = useAuth()
  const [err, setErr] = useState('')
  const myAsked = mine.filter((m) => asked.some((a) => a.id === m.id) || checkins.some((c) => c.member === m.id))
  const sent = asked.filter((m) => checkins.some((c) => c.member === m.id)).length
  const reviewed = checkins.filter((c) => c.reviewed).length

  const summary = reviewer
    ? `${sent} of ${asked.length} in · ${reviewed} reviewed${r.closed ? ' · closed' : ''}`
    : myAsked.every((m) => checkins.some((c) => c.member === m.id))
      ? '✓ Sent'
      : r.closed
        ? 'Closed'
        : 'Not sent yet'

  async function setClosed(closed: boolean) {
    setErr('')
    try {
      await pb.collection('video_requests').update(r.id, { closed })
      await onChange()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't change the request — try again."))
    }
  }

  async function deleteVideos() {
    if (!window.confirm(`Delete all ${checkins.length} videos (and their notes) for "${r.title}"? This can't be undone.`)) return
    setErr('')
    try {
      for (const c of checkins) await pb.collection('video_checkins').delete(c.id)
      await onChange()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't delete every video — try again."))
    }
  }

  async function deleteRequest() {
    if (!window.confirm(`Delete the request "${r.title}" and every video sent for it? This can't be undone.`)) return
    setErr('')
    try {
      await pb.collection('video_requests').delete(r.id)
      await onChange()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't delete the request — try again."))
    }
  }

  return (
    <FoldGroup title={`🎥 ${r.title}`} summary={summary}>
      <div className="stack">
        {r.instructions && <p style={{ whiteSpace: 'pre-wrap' }}>{r.instructions}</p>}
        {r.due && <p className="hint">Please send it by {formatDay(r.due)}.</p>}
        <p className="hint">
          Seen only by the managers{groupName ? ` and the ${groupName} group` : ''} — and by
          you. Castmates can't see each other's videos.
        </p>

        {myAsked.map((m) => (
          <MyCheckin
            key={m.id}
            request={r}
            member={m}
            forChild={m.user !== (user?.id ?? '')}
            checkin={checkins.find((c) => c.member === m.id) ?? null}
            onChange={onChange}
          />
        ))}

        {reviewer && (
          <>
            <h3>Everyone asked</h3>
            <ul className="plain-list">
              {asked.map((m) => {
                const c = checkins.find((x) => x.member === m.id)
                return <ReviewRow key={m.id} member={m} checkin={c ?? null} onChange={onChange} />
              })}
              {checkins
                .filter((c) => !asked.some((m) => m.id === c.member))
                .map((c) => {
                  const m = members.find((x) => x.id === c.member)
                  return m ? <ReviewRow key={c.id} member={m} checkin={c} onChange={onChange} /> : null
                })}
            </ul>
          </>
        )}

        {isManager && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="link" onClick={() => setClosed(!r.closed)}>
              {r.closed ? 'Reopen for uploads' : 'Close — no more uploads'}
            </button>
            {checkins.length > 0 && (
              <button className="link" onClick={deleteVideos}>
                🗑 Delete all {checkins.length} videos
              </button>
            )}
            <button className="link" onClick={deleteRequest}>
              ✕ Delete this request
            </button>
          </div>
        )}
        {err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}
      </div>
    </FoldGroup>
  )
}

// The actor's own box: record / upload / re-record, watch it back, read notes.
function MyCheckin({
  request,
  member,
  forChild,
  checkin,
  onChange,
}: {
  request: VideoRequestRecord
  member: MemberRecord
  forChild: boolean
  checkin: VideoCheckinRecord | null
  onChange: () => Promise<void>
}) {
  const { production } = useProduction()
  const [mode, setMode] = useState<'idle' | 'record'>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const canAdd = !request.closed && !production.archived
  const who = forChild ? `${memberName(member)}'s video` : 'Your video'

  async function send(file: Blob, filename: string, seconds: number) {
    setErr('')
    setStatus('')
    setProgress(0)
    try {
      await uploadCheckin({
        existingId: checkin?.id,
        production: production.id,
        request: request.id,
        member: member.id,
        file,
        filename,
        seconds,
        onProgress: setProgress,
      })
      setMode('idle')
      setStatus(checkin ? 'Replaced — the reviewers will see the new one.' : 'Sent! The reviewers can watch it now.')
      await onChange()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The upload didn't go through — try again.")
    } finally {
      setProgress(null)
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return
    setErr('')
    const problem = await checkUpload(file)
    if (problem) {
      setErr(problem)
      return
    }
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
    await send(file, `checkin.${ext}`, 0)
  }

  return (
    <div className="card stack">
      <strong>
        {who}
        {checkin ? ` — sent ${checkin.seconds ? `(${formatSeconds(checkin.seconds)})` : ''}` : ' — not sent yet'}
      </strong>
      {checkin && <WatchButton checkin={checkin} label={forChild ? 'Watch it' : 'Watch yours'} />}
      {checkin?.reviewed && (
        <div className="stack">
          <strong>📝 Notes</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{checkin.feedback || 'Reviewed — no written notes.'}</p>
        </div>
      )}
      {canAdd && progress === null && mode === 'idle' && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {canRecordHere() && (
            <button onClick={() => setMode('record')}>🎥 {checkin ? 'Record a new one' : 'Record'}</button>
          )}
          <button className="link" onClick={() => fileRef.current?.click()}>
            {canRecordHere() ? 'Or upload a video you already have' : '🎥 Record or pick a video'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="sr-only"
            aria-label={`Upload ${who.toLowerCase()}`}
            onChange={(e) => {
              pickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      )}
      {canAdd && progress === null && mode === 'record' && (
        <Recorder
          onCancel={() => setMode('idle')}
          onUse={(blob, seconds) => send(blob, blob.type.includes('webm') ? 'checkin.webm' : 'checkin.mp4', seconds)}
        />
      )}
      {progress !== null && (
        <div className="stack" role="status">
          <span>Uploading… {Math.round(progress * 100)}% — keep this page open.</span>
          <progress value={progress} max={1} aria-label="Upload progress" />
        </div>
      )}
      {checkin && canAdd && progress === null && mode === 'idle' && (
        <p className="hint">A new one replaces this one{checkin.reviewed ? ' (the notes stay)' : ''}.</p>
      )}
      {status && (
        <p className="ok" role="status">
          {status}
        </p>
      )}
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

// In-browser recorder: front camera, 720p-ish at a modest bitrate (a
// 3-minute take lands around 35 MB), stops itself at 3:00.
function Recorder({ onUse, onCancel }: { onUse: (blob: Blob, seconds: number) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<'starting' | 'ready' | 'recording' | 'done' | 'failed'>('starting')
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<{ blob: Blob; url: string; seconds: number } | null>(null)
  const [err, setErr] = useState('')
  const liveRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAt = useRef(0)

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function openCamera() {
    setErr('')
    setPhase('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      streamRef.current = stream
      if (liveRef.current) liveRef.current.srcObject = stream
      setPhase('ready')
    } catch {
      setErr(
        "Glow Tape couldn't use your camera. Allow camera and microphone for this site (your browser asks, or check its settings), or use “upload a video you already have”.",
      )
      setPhase('failed')
    }
  }

  useEffect(() => {
    openCamera()
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      if (recRef.current?.state === 'recording') recRef.current.stop()
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (take) URL.revokeObjectURL(take.url)
  }, [take])

  function start() {
    const stream = streamRef.current
    if (!stream) return
    const mimeType = pickRecorderType()
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      const seconds = Math.min(MAX_SECONDS, (Date.now() - startedAt.current) / 1000)
      const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
      setTake({ blob, url: URL.createObjectURL(blob), seconds })
      setPhase('done')
      stopCamera()
    }
    recRef.current = rec
    startedAt.current = Date.now()
    setElapsed(0)
    rec.start(1000)
    setPhase('recording')
    timerRef.current = window.setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000
      setElapsed(s)
      if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop()
    }, 250)
  }

  function stop() {
    if (recRef.current?.state === 'recording') recRef.current.stop()
  }

  function again() {
    setTake(null)
    openCamera()
  }

  const left = MAX_SECONDS - elapsed
  return (
    <div className="stack video-recorder">
      {phase !== 'done' && phase !== 'failed' && (
        <video ref={liveRef} className="video-live" autoPlay muted playsInline aria-label="Camera preview" />
      )}
      {phase === 'starting' && <p className="hint" role="status">Opening the camera…</p>}
      {phase === 'ready' && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button onClick={start}>● Start recording</button>
          <button className="link" onClick={onCancel}>
            Cancel
          </button>
          <span className="hint">Up to 3 minutes — it stops by itself.</span>
        </div>
      )}
      {phase === 'recording' && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button onClick={stop}>■ Stop</button>
          <span role="timer" aria-live="off" className={left <= 15 ? 'warn' : ''}>
            ● {formatSeconds(elapsed)} / {formatSeconds(MAX_SECONDS)}
            {left <= 15 ? ` — ${Math.ceil(left)} seconds left` : ''}
          </span>
        </div>
      )}
      {phase === 'done' && take && (
        <>
          <video src={take.url} controls playsInline className="video-player" aria-label="Your recording" />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button onClick={() => onUse(take.blob, take.seconds)}>✓ Send this one</button>
            <button className="link" onClick={again}>
              ↺ Record again
            </button>
            <button className="link" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {phase === 'failed' && (
        <>
          <p className="error" role="alert">
            {err}
          </p>
          <div className="row">
            <button className="link" onClick={openCamera}>
              Try again
            </button>
            <button className="link" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function WatchButton({ checkin, label }: { checkin: VideoCheckinRecord; label: string }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // a replaced video gets a new filename → drop the stale copy
  useEffect(() => {
    setUrl('')
  }, [checkin.video])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  async function load() {
    setBusy(true)
    setErr('')
    try {
      setUrl(await fetchVideo(checkin))
    } catch {
      setErr("Couldn't load the video — try again.")
    } finally {
      setBusy(false)
    }
  }

  if (url) return <video src={url} controls playsInline autoPlay className="video-player" aria-label={label} />
  return (
    <div>
      <button className="link" onClick={load} disabled={busy}>
        {busy ? 'Loading the video…' : `▶ ${label}`}
      </button>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

// One line per asked person for reviewers: status, watch, notes.
function ReviewRow({
  member,
  checkin,
  onChange,
}: {
  member: MemberRecord
  checkin: VideoCheckinRecord | null
  onChange: () => Promise<void>
}) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(checkin?.feedback ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    setNotes(checkin?.feedback ?? '')
  }, [checkin?.feedback])

  const name = nameWithRole(member)
  if (!checkin) {
    return (
      <li className="task-row">
        <span>
          {name} <span className="hint">— not sent yet</span>
        </span>
      </li>
    )
  }

  async function save(reviewed: boolean) {
    if (!checkin) return
    setBusy(true)
    setErr('')
    setSaved('')
    try {
      await pb.collection('video_checkins').update(checkin.id, {
        feedback: notes.trim(),
        reviewed,
        feedbackBy: user?.id ?? '',
      })
      setSaved(reviewed && !checkin.reviewed ? 'Saved — they were sent your notes.' : 'Saved.')
      await onChange()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't save the notes — try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="task-row" style={{ display: 'block' }}>
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {checkin.reviewed ? '✓' : '🎥'} {name}
        {checkin.seconds ? ` · ${formatSeconds(checkin.seconds)}` : ''}
        {checkin.reviewed ? ' · reviewed' : ' · ready to review'}
      </button>
      {open && (
        <div className="stack">
          <WatchButton checkin={checkin} label={`Watch ${memberName(member)}`} />
          <label className="stack">
            <span>Notes for {memberName(member)}</span>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Example: Lovely vowels; the r's slip in the second speech."
            />
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {!checkin.reviewed ? (
              <button onClick={() => save(true)} disabled={busy}>
                ✓ Send notes & mark reviewed
              </button>
            ) : (
              <button onClick={() => save(true)} disabled={busy || notes.trim() === checkin.feedback}>
                Save changes
              </button>
            )}
            {!checkin.reviewed && (
              <button className="link" onClick={() => save(false)} disabled={busy}>
                Save a draft (not sent)
              </button>
            )}
          </div>
          <p className="hint">
            Reviewers' notes are private to {memberName(member)}
            {member.minor ? ' and their parents' : ''}, the managers, and the reviewers.
          </p>
          {saved && (
            <p className="ok" role="status">
              {saved}
            </p>
          )}
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function NewRequestForm({ groups, onAdded }: { groups: GroupRecord[]; onAdded: () => Promise<void> }) {
  const { production, members } = useProduction()
  const { user } = useAuth()
  const defaultGroup = groups.find((g) => /production team/i.test(g.name))?.id ?? ''
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [due, setDue] = useState('')
  const [reviewGroup, setReviewGroup] = useState<string | null>(null)
  const [who, setWho] = useState<'performers' | 'pick'>('performers')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const performers = members.filter((m) => m.role === 'performer' && recordable(m))
  const choosable = members.filter((m) => m.role !== 'guardian' && recordable(m))
  const group = reviewGroup ?? defaultGroup

  async function add(e: FormEvent) {
    e.preventDefault()
    if (who === 'pick' && picked.length === 0) {
      setErr('Pick at least one person.')
      return
    }
    const count = who === 'pick' ? picked.length : performers.length
    if (!window.confirm(`Ask ${count} ${count === 1 ? 'person' : 'people'} for "${title.trim()}"? They'll get an email and a notification.`)) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      await pb.collection('video_requests').create({
        production: production.id,
        title: title.trim(),
        instructions: instructions.trim(),
        due: due || null,
        members: who === 'pick' ? picked : [],
        reviewGroup: group || null,
        author: user?.id,
      })
      setMsg(`Sent to ${count} ${count === 1 ? 'person' : 'people'}.`)
      setTitle('')
      setInstructions('')
      setDue('')
      setPicked([])
      await onAdded()
    } catch (e) {
      setErr(pbErrorMessage(e, "Couldn't send the request — try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={add} className="stack card">
      <h3>Ask for a video</h3>
      <input
        aria-label="What to record"
        required
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Example: Your dialect lines, Act 1"
      />
      <textarea
        aria-label="Instructions"
        rows={3}
        maxLength={2000}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Example: Say your first two speeches in your character's accent. Face the camera, somewhere quiet."
      />
      <label className="stack">
        <span>Send it by (optional)</span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <label className="stack">
        <span>Who else can watch and give notes</span>
        <select value={group} onChange={(e) => setReviewGroup(e.target.value)}>
          <option value="">Just the managers</option>
          {groups
            .filter((g) => !g.auto)
            .map((g) => (
              <option key={g.id} value={g.id}>
                Managers + the {g.name} group
              </option>
            ))}
        </select>
      </label>
      <div className="chips" role="group" aria-label="Who to ask">
        <button
          type="button"
          className={`chip ${who === 'performers' ? 'chip-active' : ''}`}
          aria-pressed={who === 'performers'}
          onClick={() => setWho('performers')}
        >
          Every performer ({performers.length})
        </button>
        <button
          type="button"
          className={`chip ${who === 'pick' ? 'chip-active' : ''}`}
          aria-pressed={who === 'pick'}
          onClick={() => setWho('pick')}
        >
          Pick people
        </button>
      </div>
      {who === 'pick' && (
        <div className="chips" role="group" aria-label="People to ask">
          {choosable.map((m) => {
            const on = picked.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={`chip ${on ? 'chip-active' : ''}`}
                aria-pressed={on}
                onClick={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id])}
              >
                {nameWithRole(m)}
              </button>
            )
          })}
        </div>
      )}
      <button type="submit" disabled={busy || !title.trim()}>
        {busy ? 'Sending…' : 'Send the request'}
      </button>
      <p className="hint">
        Each person records up to 3 minutes right in Glow Tape. Videos aren't backed up — delete
        them once you're done; archiving the show deletes them too.
      </p>
      {msg && (
        <p className="ok" role="status">
          {msg}
        </p>
      )}
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </form>
  )
}
