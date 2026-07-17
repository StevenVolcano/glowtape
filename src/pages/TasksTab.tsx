import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import SetupGuide from '../components/SetupGuide.tsx'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { formatDay, memberName, LINE_NOTE_LABELS } from '../lib/types.ts'
import type { LineNoteRecord, MemberRecord, TaskRecord } from '../lib/types.ts'

const DEFAULT_DEPARTMENTS = [
  'Set',
  'Props',
  'Costumes',
  'Lighting',
  'Sound',
  'Publicity',
  'Front of House',
  'Stage Management',
]

export default function TasksTab() {
  const { production, members, isManager } = useProduction()
  const { user } = useAuth()
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [filter, setFilter] = useState<'open' | 'mine' | 'all'>('open')

  async function load() {
    const list = await pb.collection('tasks').getFullList<TaskRecord>({
      filter: pb.filter('production = {:p}', { p: production.id }),
      sort: 'done,due,created',
    })
    setTasks(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  const myMemberIds = members
    .filter((m) => m.user === user?.id || m.guardians?.includes(user?.id ?? ''))
    .map((m) => m.id)

  const canToggle = (t: TaskRecord) => isManager || (!!t.assignee && myMemberIds.includes(t.assignee))

  async function toggleDone(t: TaskRecord) {
    await pb.collection('tasks').update(t.id, { done: !t.done })
    await load()
  }

  async function remove(t: TaskRecord) {
    if (!window.confirm(`Delete "${t.title}"?`)) return
    await pb.collection('tasks').delete(t.id)
    await load()
  }

  const today = new Date().toISOString().slice(0, 10)
  const visible = tasks.filter((t) => {
    if (filter === 'open') return !t.done
    if (filter === 'mine') return !!t.assignee && myMemberIds.includes(t.assignee)
    return true
  })

  const departments = [...new Set(visible.map((t) => t.department || 'General'))]

  const myEditable = members.filter(
    (m) => m.user === user?.id || (m.minor && m.guardians?.includes(user?.id ?? '')),
  )

  return (
    <div>
      {isManager && <SetupGuide />}
      {myEditable.map((m) => (
        <BioEditor key={m.id} member={m} onSaved={load} />
      ))}
      <LineNotesSection />
      <section>
        <h2>To-do</h2>
        <div className="chips">
          {(['open', 'mine', 'all'] as const).map((f) => (
            <button
              key={f}
              className={`chip ${filter === f ? 'chip-active' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'open' ? 'Open' : f === 'mine' ? 'Mine' : 'Everything'}
            </button>
          ))}
        </div>
        {visible.length === 0 && (
          <p className="hint">
            {filter === 'mine' ? 'Nothing assigned to you. Enjoy it.' : 'Nothing here — lovely.'}
          </p>
        )}
        {departments.map((dept) => (
          <div key={dept}>
            <h3 className="dept-heading">{dept}</h3>
            <ul className="plain-list">
              {visible
                .filter((t) => (t.department || 'General') === dept)
                .map((t) => {
                  const assignee = members.find((m) => m.id === t.assignee)
                  const overdue = !t.done && t.due && String(t.due).slice(0, 10) < today
                  return (
                    <li key={t.id} className={`task-row ${t.done ? 'task-done' : ''}`}>
                      <label className="row task-main">
                        <input
                          type="checkbox"
                          checked={t.done}
                          disabled={!canToggle(t)}
                          onChange={() => toggleDone(t)}
                        />
                        <span>
                          {t.title}
                          {assignee && <span className="hint"> — {memberName(assignee)}</span>}
                          {t.due && (
                            <span className={overdue ? 'error' : 'hint'}>
                              {' '}
                              · due {formatDay(t.due)}
                              {overdue ? ' (overdue)' : ''}
                            </span>
                          )}
                        </span>
                      </label>
                      {isManager && (
                        <button
                          className="link"
                          aria-label={`Delete task ${t.title}`}
                          onClick={() => remove(t)}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </section>

      {isManager && <NewTaskForm members={members} onAdded={load} />}
    </div>
  )
}

// Open line notes for your own members (or your kids'), delivered from the
// script room. The server only sends an actor their own notes; a guardian
// sees their child's. Checking one off marks it fixed for the team too.
function LineNotesSection() {
  const { production, members } = useProduction()
  const { user } = useAuth()
  const [notes, setNotes] = useState<LineNoteRecord[]>([])

  const myMemberIds = members
    .filter((m) => m.user === user?.id || m.guardians?.includes(user?.id ?? ''))
    .map((m) => m.id)

  async function load() {
    const list = await pb.collection('line_notes').getFullList<LineNoteRecord>({
      filter: pb.filter('production = {:p} && done = false', { p: production.id }),
      sort: 'page,created',
    })
    setNotes(list)
  }

  useEffect(() => {
    load().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production.id])

  const mine = notes.filter((n) => myMemberIds.includes(n.member))
  if (mine.length === 0) return null

  async function markDone(n: LineNoteRecord) {
    await pb.collection('line_notes').update(n.id, { done: true })
    await load()
  }

  const base = `/production/${production.id}`

  return (
    <section>
      <h2>🎯 Line notes ({mine.length})</h2>
      <p className="hint">
        Notes from the team about lines to look at before next time. Check one off once
        you've got it down.
      </p>
      <ul className="plain-list">
        {mine.map((n) => {
          const who = members.find((m) => m.id === n.member)
          return (
            <li key={n.id} className="task-row">
              <label className="row task-main">
                <input type="checkbox" checked={false} onChange={() => markDone(n)} />
                <span>
                  <strong>{LINE_NOTE_LABELS[n.kind] ?? n.kind}</strong> — p. {n.page}
                  {myMemberIds.length > 1 && who && (
                    <span className="hint"> · {memberName(who)}</span>
                  )}
                  {n.text && <span className="hint"> · {n.text}</span>}
                </span>
              </label>
              <Link
                className="link"
                to={`${base}/script/${n.resource}?page=${n.page}&note=${n.id}`}
              >
                Show me in the script
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function NewTaskForm({
  members,
  onAdded,
}: {
  members: MemberRecord[]
  onAdded: () => Promise<void>
}) {
  const { production } = useProduction()
  const [title, setTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setDone('')
    try {
      await pb.collection('tasks').create({
        production: production.id,
        title: title.trim(),
        department: department.trim(),
        assignee: assignee || null,
        due: due || null,
      })
      setDone(assignee ? 'Added — the assignee was emailed.' : 'Added.')
      setTitle('')
      setDue('')
      await onAdded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Add a task</h2>
      <form onSubmit={add} className="stack">
        <input
          aria-label="Task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing — for example: source a fainting couch"
        />
        <div className="row">
          <input
            aria-label="Department"
            list="gt-departments"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Department"
          />
          <datalist id="gt-departments">
            {DEFAULT_DEPARTMENTS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <select
            aria-label="Assign to"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Unassigned</option>
            {members
              .filter((m) => !(m.multi && !m.user))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {memberName(m)}
                </option>
              ))}
          </select>
          <label>
            Due
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <button type="submit" disabled={busy || !title.trim()}>
          Add task
        </button>
        {done && <p className="acked" role="status">{done}</p>}
      </form>
    </section>
  )
}

// Write/edit a program bio; saving also checks off the matching bio task.
function BioEditor({ member, onSaved }: { member: MemberRecord; onSaved: () => Promise<void> }) {
  const { reload } = useProduction()
  const [bio, setBio] = useState(member.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')

  const whose = member.minor ? `${member.displayName}'s` : 'Your'

  async function save() {
    setBusy(true)
    setSaved('')
    try {
      await pb.collection('members').update(member.id, { bio: bio.trim() })
      if (bio.trim()) {
        try {
          const open = await pb.collection('tasks').getFullList({
            filter: pb.filter("assignee = {:m} && kind = 'bio' && done = false", { m: member.id }),
          })
          for (const t of open) await pb.collection('tasks').update(t.id, { done: true })
        } catch {
          /* no task to complete */
        }
      }
      setSaved('Saved — thank you! 🎭')
      await reload()
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack bio-editor">
      <h2>{whose} program bio</h2>
      <p className="hint">
        Two to four sentences for the printed program — favorite past roles, who you'd like to
        thank, that sort of thing.
      </p>
      <textarea
        rows={4}
        maxLength={1200}
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder={
          member.minor
            ? `Example: ${member.displayName} is thrilled to make their Driftwood debut…`
            : 'Example: Pat is delighted to return to the stage after…'
        }
      />
      <div className="row">
        <button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save bio'}
        </button>
        {saved && <span className="acked" role="status">{saved}</span>}
      </div>
    </div>
  )
}
