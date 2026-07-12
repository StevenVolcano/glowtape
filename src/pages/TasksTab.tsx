import { useEffect, useState, type FormEvent } from 'react'
import { pb } from '../lib/pb.ts'
import { useAuth } from '../lib/auth.tsx'
import { useProduction } from './Production.tsx'
import { formatDay, memberName } from '../lib/types.ts'
import type { MemberRecord, TaskRecord } from '../lib/types.ts'

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

  return (
    <div>
      <section>
        <h2>To-do</h2>
        <div className="chips">
          {(['open', 'mine', 'all'] as const).map((f) => (
            <button
              key={f}
              className={`chip ${filter === f ? 'chip-active' : ''}`}
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
                        <button className="link" onClick={() => remove(t)}>
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
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing — e.g. Source a fainting couch"
        />
        <div className="row">
          <input
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
        {done && <p className="acked">{done}</p>}
      </form>
    </section>
  )
}
