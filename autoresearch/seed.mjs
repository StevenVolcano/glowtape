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
const SEED_V = 'A small town, a big heart. [seed v4]';
if (existing && existing.description === SEED_V && !process.env.RESEED) { const note = await first('notes', `production='${existing.id}'`);
  const ev = await first('events', `production='${existing.id}' && signinCode!=''`);
  const res = await first('resources', `production='${existing.id}'`);
  console.log(JSON.stringify({ already: true, production: existing.id, note: note?.id, event: ev?.id, resource: res?.id })); process.exit(0); }
if (existing) await fetch(`${PB}/api/collections/productions/records/${existing.id}`, { method: 'DELETE', headers: H });

const mkUser = async (email, name) => (await first('users', `email='${email}'`)) || create('users', { email, name, password: 'x-pass-12345', passwordConfirm: 'x-pass-12345', verified: true });
const dir = await mkUser('director@test.local', 'Dana Director');
const actor = await mkUser('actor@test.local', 'Alex Actor');
const org = await create('orgs', { name: 'Driftwood Players' });
const prod = await create('productions', { org: org.id, title: 'Our Town', writtenBy: 'Thornton Wilder', managers: [dir.id], status: 'rehearsal', description: SEED_V, auditionOpen: true, auditionNotes: 'Bring a one-minute monologue. No experience needed.', auditionQuestions: ['Any schedule conflicts we should know about?'] });
const dm = await create('members', { production: prod.id, user: dir.id, role: 'director', position: 'Director', manager: true });
const am = await create('members', { production: prod.id, user: actor.id, role: 'performer', position: 'Emily Webb' });
for (const pos of ['George Gibbs', 'Stage Manager', 'Mrs. Webb']) await create('members', { production: prod.id, role: 'performer', position: pos });
const SIGNIN = 'DOOR42';
const day = (d, h) => { const t = new Date(Date.UTC(2026, 9, d, h + 7)); return t.toISOString().replace('T', ' '); };
const evs = [];
for (const [d, kind, title] of [[5, 'Rehearsal', 'Act 1 blocking'], [7, 'Rehearsal', 'Act 2 blocking'], [12, 'Tech', 'Tech run'], [16, 'Performance', 'Opening night'], [17, 'Performance', 'Closing']]) {
  evs.push(await create('events', { production: prod.id, title, kind, start: day(d, 18), end: day(d, 21), location: 'Driftwood Playhouse', status: 'scheduled', signinCode: evs.length === 0 ? 'DOOR42' : '' }));
}
await create('announcements', { production: prod.id, author: dir.id, title: 'Welcome to Our Town!', body: 'Scripts are in the Docs tab.', pinned: true });
await create('tasks', { production: prod.id, title: 'Find a ladder', department: 'Set', assignee: am.id });
await create('tracker_items', { production: prod.id, tracker: 'props', name: 'Ladder', status: 'needed' }).catch(e => console.error(e.message));
await create('notes', { production: prod.id, author: dir.id, title: 'Act 1 notes', body: 'Projection in scene 2.' }).catch(e => console.error(e.message));
const ch = await first('channels', `production='${prod.id}' && name='All Call'`);
const soft = (p) => p.catch((e) => console.error(e.message));
if (ch) {
  const m1 = await soft(create('messages', { channel: ch.id, author: dir.id, text: 'Welcome, everyone! First read-through is Monday at 6.' }));
  await soft(create('messages', { channel: ch.id, author: actor.id, text: 'See everyone Monday!' }));
  if (m1) { await soft(create('reactions', { message: m1.id, user: actor.id, emoji: '🎭' })); await soft(create('reactions', { message: m1.id, user: dir.id, emoji: '👍' })); }
}
// Richer state so more of the UI is on screen (round 3).
const others = (await fetch(`${PB}/api/collections/members/records?filter=${encodeURIComponent(`production='${prod.id}' && user=''`)}`, { headers: H }).then(j)).items;
await soft(create('units', { production: prod.id, name: 'Opening: Grover\'s Corners', act: 'Act 1', pages: '1-6', order: 1, onstage: [am.id, others[0].id], notes: 'Stage Manager narrates' }));
await soft(create('units', { production: prod.id, name: 'The soda fountain', act: 'Act 2', pages: '40-44', order: 2, onstage: [am.id, others[0].id] }));
await soft(create('units', { production: prod.id, name: 'Goodbye, world', act: 'Act 3', pages: '70-75', order: 3, onstage: [am.id] }));
for (const [kind, name, status] of [['props', 'Ladder', 'needed'], ['props', 'Two ironing boards', 'found'], ['costumes', 'Emily wedding dress', 'fitting'], ['sound_cues', 'Train whistle', '']]) await soft(create('tracker_items', { production: prod.id, tracker: kind, name, status }));
for (const [h, m] of [[17, 0], [17, 15], [17, 30]]) await soft(create('slots', { production: prod.id, title: 'Costume fittings', start: day(9, h).replace(':00:00', `:${String(m).padStart(2, '0')}:00`), minutes: 15, location: 'Green room', member: h === 17 && m === 0 ? am.id : '' }));
const party = await soft(create('events', { production: prod.id, title: 'Cast party', kind: 'Cast Party', start: day(18, 19), end: day(18, 22), location: 'Driftwood Playhouse', status: 'scheduled', bringCategories: ['Mains', 'Desserts', 'Drinks'] }));
if (party) await soft(create('bring_items', { production: prod.id, event: party.id, user: actor.id, item: 'Lemon bars', category: 'Desserts' }));
await soft(fetch(`${PB}/api/collections/events/records/${evs[0].id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ timeline: [{ title: 'Warm-ups', minutes: 15 }, { title: 'Act 1 scenes 1-3', minutes: 90 }, { title: 'Notes', minutes: 15 }] }) }));
await soft(create('conflicts', { production: prod.id, user: actor.id, start: day(12, 0), end: day(12, 0), note: 'Work trip' }));
await soft(create('profiles', { user: actor.id, pronouns: 'she/her', experience: 'Annie (2023), Our Town reading', skills: 'alto, tap' }));
// A small script PDF for the script room (round 4).
{
  const { createRequire } = await import('node:module');
  const { PDFDocument, StandardFonts } = createRequire(import.meta.url)('pdf-lib');
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const pg = doc.addPage([612, 792]);
    const lines = ['STAGE MANAGER:', 'This play is called Our Town.', 'EMILY:', 'Mama, am I pretty?', 'MRS. WEBB:', 'Yes, of course you are.'];
    lines.forEach((t, k) => pg.drawText(t, { x: 72, y: 700 - k * 24, size: 14, font }));
  }
  const fd = new FormData();
  fd.append('production', prod.id); fd.append('area', 'show'); fd.append('title', 'Our Town — rehearsal script'); fd.append('audience', 'everyone');
  fd.append('file', new Blob([await doc.save()], { type: 'application/pdf' }), 'script.pdf');
  const r = await fetch(`${PB}/api/collections/resources/records`, { method: 'POST', headers: { Authorization: admin.token }, body: fd });
  if (!r.ok) console.error('resource', await r.text());
}
await soft(create('auditions', { production: prod.id, user: actor.id, roles: 'Emily Webb', answers: { 'Any schedule conflicts we should know about?': 'One work trip in October' } }));
console.log(JSON.stringify({ signin: 'DOOR42', production: prod.id, director: dir.id, actor: actor.id, event: evs[0].id }));
