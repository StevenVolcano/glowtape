// Seeds a deterministic demo production into a LOCAL PocketBase (never prod).
const PB = process.env.PB_URL || 'http://127.0.0.1:8090';
const j = (r) => r.json();
const admin = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: 'admin@test.local', password: 'testpass12345' }),
}).then(j);
const H = { 'content-type': 'application/json', Authorization: admin.token };
async function create(col, data) {
  const r = await fetch(`${PB}/api/collections/${col}/records`, { method: 'POST', headers: H, body: JSON.stringify(data) });
  const b = await r.json();
  if (!r.ok) throw new Error(`${col}: ${JSON.stringify(b)}`);
  return b;
}
async function first(col, filter) {
  const r = await fetch(`${PB}/api/collections/${col}/records?filter=${encodeURIComponent(filter)}`, { headers: H }).then(j);
  return r.items?.[0];
}
// Operator (Glow Tape Stagehand) account for the /operator console screen.
if (!(await first('users', "email='operator@test.local'"))) await create('users', { email: 'operator@test.local', name: 'Olive Operator', password: 'x-pass-12345', passwordConfirm: 'x-pass-12345', verified: true, operator: true });
const existing = await first('productions', "title='Our Town'");
if (existing && !process.env.RESEED) { const note = await first('notes', `production='${existing.id}'`);
  const ev = await first('events', `production='${existing.id}'`);
  console.log(JSON.stringify({ already: true, production: existing.id, note: note?.id, event: ev?.id })); process.exit(0); }
if (existing) await fetch(`${PB}/api/collections/productions/records/${existing.id}`, { method: 'DELETE', headers: H });

const mkUser = async (email, name) => (await first('users', `email='${email}'`)) || create('users', { email, name, password: 'x-pass-12345', passwordConfirm: 'x-pass-12345', verified: true });
const dir = await mkUser('director@test.local', 'Dana Director');
const actor = await mkUser('actor@test.local', 'Alex Actor');
const org = await create('orgs', { name: 'Driftwood Players' });
const prod = await create('productions', { org: org.id, title: 'Our Town', writtenBy: 'Thornton Wilder', managers: [dir.id], status: 'rehearsal', description: 'A small town, a big heart.' });
const dm = await create('members', { production: prod.id, user: dir.id, role: 'director', position: 'Director', manager: true });
const am = await create('members', { production: prod.id, user: actor.id, role: 'performer', position: 'Emily Webb' });
for (const pos of ['George Gibbs', 'Stage Manager', 'Mrs. Webb']) await create('members', { production: prod.id, role: 'performer', position: pos });
const day = (d, h) => { const t = new Date(Date.UTC(2026, 9, d, h + 7)); return t.toISOString().replace('T', ' '); };
const evs = [];
for (const [d, kind, title] of [[5, 'Rehearsal', 'Act 1 blocking'], [7, 'Rehearsal', 'Act 2 blocking'], [12, 'Tech', 'Tech run'], [16, 'Performance', 'Opening night'], [17, 'Performance', 'Closing']]) {
  evs.push(await create('events', { production: prod.id, title, kind, start: day(d, 18), end: day(d, 21), location: 'Driftwood Playhouse', status: 'scheduled' }));
}
await create('announcements', { production: prod.id, author: dir.id, title: 'Welcome to Our Town!', body: 'Scripts are in the Docs tab.', pinned: true });
await create('tasks', { production: prod.id, title: 'Find a ladder', department: 'Set', assignee: am.id });
await create('tracker_items', { production: prod.id, tracker: 'props', name: 'Ladder', status: 'needed' }).catch(e => console.error(e.message));
await create('notes', { production: prod.id, author: dir.id, title: 'Act 1 notes', body: 'Projection in scene 2.' }).catch(e => console.error(e.message));
const ch = await first('channels', `production='${prod.id}' && name='All Call'`);
if (ch) await create('messages', { channel: ch.id, author: actor.id, body: 'See everyone Tuesday!' }).catch(e => console.error(e.message));
console.log(JSON.stringify({ production: prod.id, director: dir.id, actor: actor.id, event: evs[0].id }));
