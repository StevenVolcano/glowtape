import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import SetupGuide from '../components/SetupGuide.tsx'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { matchMember } from '../lib/breakdown.ts'
import { csvField, parseCsv } from '../lib/trackers.ts'
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
      {isManager && <TaskCsv tasks={tasks} members={members} onImported={load} />}
    </div>
  )
}

// Import a planning spreadsheet (one CSV) as tasks, and export the board
// back out. Columns are matched loosely — a sheet with DUE / WHO / TYPE /
// WHAT headers (the classic planning-workbook shape) imports as-is. WHO is
// matched against roles and names; initials or strangers import unassigned.
const TASK_COLS = {
  title: ['what', 'task', 'todo', 'item', 'description', 'title'],
  department: ['type', 'department', 'category', 'dept', 'area', 'phase'],
  due: ['due', 'deadline', 'date', 'when'],
  assignee: ['who', 'assignee', 'assigned', 'owner', 'person'],
  done: ['done', 'complete', 'completed', 'status', 'check'],
} as const
type TaskCol = keyof typeof TASK_COLS

function mapTaskHeaders(header: string[]): (TaskCol | null)[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  return header.map((h) => {
    const n = norm(h)
    if (!n) return null
    for (const [col, aliases] of Object.entries(TASK_COLS) as [TaskCol, readonly string[]][]) {
      if (aliases.some((a) => n === a || n.includes(a))) return col
    }
    return null
  })
}

// "2024-08-18", "2024-08-18 00:00:00", "8/18/2024", "Aug 18, 2024" → "2024-08-18".
function parseDueDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return ''
}

function TaskCsv({
  tasks,
  members,
  onImported,
}: {
  tasks: TaskRecord[]
  members: MemberRecord[]
  onImported: () => Promise<void>
}) {
  const { production } = useProduction()
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const pool = members.filter((m) => m.role !== 'guardian' && !m.claimedFrom)

  async function importCsv(file: File) {
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      setStatus('That file needs a header row plus at least one task.')
      return
    }
    const mapping = mapTaskHeaders(rows[0])
    if (!mapping.includes('title')) {
      setStatus(
        `Couldn't find a task column (What / Task / Title) in the headers: ${rows[0].join(', ')}`,
      )
      return
    }
    setStatus(`Importing ${rows.length - 1} tasks…`)
    const unmatched = new Set<string>()
    let imported = 0
    let badDates = 0
    let assigned = 0
    for (const row of rows.slice(1)) {
      const data: Record<string, unknown> = { production: production.id }
      row.forEach((cell, i) => {
        const col = mapping[i]
        if (!col) return
        const value = cell.trim()
        if (col === 'title') data.title = value.slice(0, 200)
        else if (col === 'department') data.department = value.slice(0, 60)
        else if (col === 'due') {
          const d = parseDueDate(value)
          if (d) data.due = d
          else if (value) badDates++
        } else if (col === 'done') {
          data.done = /^(true|yes|y|x|✓|done|1)$/i.test(value)
        } else if (col === 'assignee' && value) {
          const m = matchMember(value, pool)
          if (m) {
            data.assignee = m.id
            assigned++
          } else {
            unmatched.add(value)
          }
        }
      })
      if (!data.title) continue
      // Messy sheets repeat their header row mid-list — don't import it.
      if (/^(what|task|title|todo)$/i.test(String(data.title))) continue
      await pb.collection('tasks').create(data)
      imported++
    }
    await onImported()
    setStatus(
      `Imported ${imported} tasks. ✓` +
        (assigned ? ` ${assigned} matched to people (they get the usual task email).` : '') +
        (unmatched.size
          ? ` Didn't recognize: ${[...unmatched].slice(0, 10).join(', ')}${
              unmatched.size > 10 ? '…' : ''
            } — those imported unassigned; assign them here when you're ready.`
          : '') +
        (badDates ? ` ${badDates} due dates couldn't be read and were left blank.` : ''),
    )
  }

  function exportCsv() {
    const header = ['Task', 'Type', 'Who', 'Due', 'Done']
    const lines = tasks.map((t) => {
      const m = members.find((x) => x.id === t.assignee)
      return [
        t.title,
        t.department,
        m ? memberName(m) : '',
        t.due ? String(t.due).slice(0, 10) : '',
        t.done ? 'yes' : '',
      ]
        .map((c) => csvField(String(c ?? '')))
        .join(',')
    })
    const csv = [header.map(csvField).join(','), ...lines].join('\r\n') + '\r\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${production.title} — To-do.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button onClick={() => fileRef.current?.click()}>⬆ Import tasks from CSV</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Import tasks from a CSV file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) importCsv(f).catch(() => setStatus('Import failed — sorry.'))
          }}
        />
        {tasks.length > 0 && <button onClick={exportCsv}>⬇ Export CSV</button>}
      </div>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
      <p className="hint">
        Got a planning spreadsheet? Export it as CSV (Google Sheets: File → Download → CSV, one
        tab at a time) with columns like <em>What, Type, Who, Due, Done</em> and it lands here —
        the Type column becomes the department groupings. Who is matched by role or name;
        anything unrecognized just imports unassigned, and tasks never need an assignee.
      </p>
    </section>
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
                  {n.snippet && (
                    <span className="hint" style={{ display: 'block', fontStyle: 'italic' }}>
                      “{n.snippet.split('\n').join(' / ')}”
                    </span>
                  )}
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
  const [addErr, setAddErr] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setDone('')
    setAddErr('')
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
    } catch {
      setAddErr("Couldn't add the task — try again.")
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
        {addErr && <p className="error" role="alert">{addErr}</p>}
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
  const [bioErr, setBioErr] = useState('')

  const whose = member.minor ? `${member.displayName}'s` : 'Your'

  async function save() {
    setBusy(true)
    setSaved('')
    setBioErr('')
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
    } catch {
      setBioErr("Couldn't save the bio — check your connection and try again. Your words are still here.")
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
        {bioErr && <span className="error" role="alert">{bioErr}</span>}
      </div>
    </div>
  )
}
