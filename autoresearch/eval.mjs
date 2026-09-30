// Glow Tape UI/UX autoresearch eval. Deterministic: local PocketBase + seeded
// data + headless Chromium at phone width. Prints `SCORE: <ux debt>` (LOWER is better).
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PB = 'http://127.0.0.1:8090';
const PORT = 4179;
const APP = `http://127.0.0.1:${PORT}`;
const noBuild = process.argv.includes('--no-build');
const shots = process.argv.includes('--shots');
const verbose = process.argv.includes('--verbose');

if (!noBuild) execSync('npx vite build --logLevel error', { stdio: 'inherit' });

const seed = JSON.parse(execSync('node autoresearch/seed.mjs').toString().trim().split('\n').pop());
const P = seed.production;
const admin = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: 'admin@test.local', password: 'testpass12345' }),
}).then((r) => r.json());
async function tokenFor(email) {
  const u = await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent(`email='${email}'`)}`, { headers: { Authorization: admin.token } }).then((r) => r.json());
  const id = u.items[0].id;
  const r = await fetch(`${PB}/api/collections/users/impersonate/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: admin.token }, body: JSON.stringify({ duration: 3600 }) }).then((r) => r.json());
  return { token: r.token, record: r.record };
}

// Screens: [name, who, path]
const SCREENS = [
  ['signin', null, '/'],
  ['home', 'director', '/'],
  ['dashboard-dir', 'director', `/production/${P}/dashboard`],
  ['schedule-dir', 'director', `/production/${P}/schedule`],
  ['messages-dir', 'director', `/production/${P}/messages`],
  ['todo-dir', 'director', `/production/${P}/todo`],
  ['sheets', 'director', `/production/${P}/sheets`],
  ['docs', 'director', `/production/${P}/docs`],
  ['notes', 'director', `/production/${P}/notes`],
  ['people', 'director', `/production/${P}/people`],
  ['manage', 'director', `/production/${P}/admin`],
  ['casting', 'director', `/production/${P}/casting`],
  ['profile', 'actor', '/profile'],
  ['dashboard-cast', 'actor', `/production/${P}/dashboard`],
  ['schedule-cast', 'actor', `/production/${P}/schedule`],
  ['messages-cast', 'actor', `/production/${P}/messages`],
  // Desktop (1280px) spot checks — layout must hold on a laptop too.
  ['desk:schedule-dir', 'director', `/production/${P}/schedule`],
  ['desk:manage', 'director', `/production/${P}/admin`],
  ['desk:dashboard-cast', 'actor', `/production/${P}/dashboard`],
];

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(APP); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

const axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const IMPACT = { critical: 10, serious: 5, moderate: 2, minor: 1 };
const W = { axe: 1, tap: 1, crowded: 0.5, overflow: 25, inputZoom: 2, clippedPh: 1, tinyText: 0.25, noFocus: 2, aaa: 0.1, error: 50 };
const tokens = { director: await tokenFor('director@test.local'), actor: await tokenFor('actor@test.local') };
const results = {};
let total = 0;
if (shots) mkdirSync('autoresearch/shots', { recursive: true });

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
for (const [name, who, path] of SCREENS) {
  if (only && !only.split(',').includes(name)) continue;
  const ctx = await browser.newContext({ viewport: name.startsWith('desk:') ? { width: 1280, height: 800 } : { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' });
  await ctx.addInitScript(([auth]) => {
    localStorage.clear();
    if (auth) localStorage.setItem('pocketbase_auth', JSON.stringify(auth));
  }, [who ? tokens[who] : null]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.addScriptTag({ content: axeSource });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }));
  });
  const dom = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
    const ctrls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary')].filter(vis);
    const desc = (el, r) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    // The effective hit box: a control wrapped in a <label> is hit via the label;
    // an .sr-only file input is operated through its visible label.
    const hitBox = (el) => {
      if (el.matches('input, select, textarea')) {
        const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
        // Either the control or its label can take the tap — use the bigger one.
        if (lab && vis(lab)) { const a = lab.getBoundingClientRect(), b = el.getBoundingClientRect(); return a.width * a.height >= b.width * b.height ? a : b; }
        if (el.classList.contains('sr-only')) return null;
      }
      return el.getBoundingClientRect();
    };
    const inlineText = (el) => el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 20;
    const small = [], boxes = [];
    for (const el of ctrls) {
      const r = hitBox(el); if (!r) continue;
      if (inlineText(el)) continue;
      boxes.push(r);
      if (r.height < 44 || r.width < 44) small.push(desc(el, r));
    }
    // Target spacing: distinct targets whose hit boxes sit < 8px apart.
    let crowded = 0;
    const uniq = boxes.filter((r, i) => boxes.findIndex((q) => q.x === r.x && q.y === r.y && q.width === r.width && q.height === r.height) === i);
    for (let i = 0; i < uniq.length; i++) for (let k = i + 1; k < uniq.length; k++) {
      const a = uniq[i], b = uniq[k];
      const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      const overlap = dx === 0 && dy === 0;
      if (!overlap && Math.max(dx, dy) < 8) crowded++;
    }
    const zoom = [...document.querySelectorAll('input, select, textarea')].filter(vis).filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).length;
    // Placeholders cut off by their input's width.
    const cv = document.createElement('canvas').getContext('2d');
    let clippedPh = 0;
    for (const el of [...document.querySelectorAll('input[placeholder], textarea[placeholder]')].filter(vis)) {
      if (el.tagName === 'TEXTAREA') continue;
      const s = getComputedStyle(el); cv.font = `italic ${s.fontSize} ${s.fontFamily}`;
      const avail = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      if (cv.measureText(el.placeholder).width > avail + 1) clippedPh++;
    }
    // Small text: visible text-bearing leaf elements under 14px.
    let tinyText = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const t = walker.currentNode; const el = t.parentElement;
      if (!el || seen.has(el) || !t.textContent.trim() || !vis(el) || el.closest('.sr-only')) continue;
      seen.add(el);
      if (parseFloat(getComputedStyle(el).fontSize) < 14) tinyText++;
    }
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const text = document.body.innerText.replace(/\s+/g, ' ').trim().length;
    const fonts = [...document.querySelectorAll('p, li, td, label, span')].filter(vis).map((e) => parseFloat(getComputedStyle(e).fontSize)).sort((a, b) => a - b);
    return { controls: ctrls.length, small, crowded, zoom, clippedPh, tinyText, overflow, text, medianFont: fonts.length ? fonts[fonts.length >> 1] : 0 };
  });
  // Focus visibility: tab through the first 20 stops; each must show an outline
  // or box-shadow ring (or change background) while focused.
  let noFocus = 0; const noFocusList = [];
  await page.mouse.click(1, 1);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || (s.boxShadow && s.boxShadow !== 'none');
      return { ring, d: `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}"` };
    });
    if (!f) break;
    if (!f.ring) { noFocus++; noFocusList.push(f.d); }
  }
  // AAA (7:1) contrast is reported separately at low weight — a "nice to have".
  const aaa = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: ['color-contrast-enhanced'], resultTypes: ['violations'] });
    return r.violations.reduce((s, v) => s + v.nodes.length, 0);
  });
  if (shots) {
    await page.screenshot({ path: `autoresearch/shots/${name}.png`, fullPage: true });
    // Readable chunks of long pages for human review.
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const vw = page.viewportSize().width;
    for (let y = 0, i = 0; y < h && i < 12; y += 1400, i++) await page.screenshot({ path: `autoresearch/shots/${name.replace(':', '_')}-${i}.png`, fullPage: true, clip: { x: 0, y, width: vw, height: Math.min(1400, h - y) } });
  }
  const axePts = axe.reduce((s, v) => s + (IMPACT[v.impact] || 1) * v.n, 0);
  const pts = Math.round((W.axe * axePts + W.tap * dom.small.length + W.crowded * dom.crowded + W.overflow * (dom.overflow ? 1 : 0) + W.inputZoom * dom.zoom + W.clippedPh * dom.clippedPh + W.tinyText * dom.tinyText + W.noFocus * noFocus + W.aaa * aaa + W.error * errors.length) * 100) / 100;
  total += pts;
  results[name] = { pts, axePts, axe, tapSmall: dom.small.length, small: dom.small.slice(0, 12), crowded: dom.crowded, clippedPh: dom.clippedPh, tinyText: dom.tinyText, noFocus, noFocusList, aaa, zoom: dom.zoom, overflow: dom.overflow, errors, controls: dom.controls, text: dom.text, medianFont: dom.medianFont };
  if (verbose) console.log(name, pts, JSON.stringify({ axe: axe.map((v) => `${v.id}:${v.impact}x${v.n}`), small: dom.small, crowded: dom.crowded, clippedPh: dom.clippedPh, tiny: dom.tinyText, noFocusList, aaa, zoom: dom.zoom, overflow: dom.overflow, errors }));
  await ctx.close();
}
await browser.close();
preview.kill();

// Guards vs. the committed guard baseline: no screen may lose controls or >3% text,
// and median body font must not shrink (anti-gaming: hiding/shrinking things).
let guard = true; const why = [];
let base = null;
try { base = JSON.parse(readFileSync('autoresearch/guard_baseline.json', 'utf8')); } catch {}
if (process.argv.includes('--write-guard')) {
  writeFileSync('autoresearch/guard_baseline.json', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { controls: v.controls, text: v.text, medianFont: v.medianFont }])), null, 1));
} else if (base) {
  for (const [k, v] of Object.entries(results)) {
    const b = base[k]; if (!b) continue;
    if (v.controls < b.controls) { guard = false; why.push(`${k}: controls ${b.controls}->${v.controls}`); }
    if (v.text < b.text * 0.97) { guard = false; why.push(`${k}: text ${b.text}->${v.text}`); }
    if (v.medianFont < b.medianFont) { guard = false; why.push(`${k}: medianFont ${b.medianFont}->${v.medianFont}`); }
  }
}
writeFileSync('autoresearch/last_eval.json', JSON.stringify({ total, guard, why, results }, null, 1));
console.log(Object.entries(results).map(([k, v]) => `${k.padEnd(15)} ${String(v.pts).padStart(6)}  axe=${v.axePts} tap=${v.tapSmall} crowd=${v.crowded} tiny=${v.tinyText} focus=${v.noFocus} aaa=${v.aaa} ph=${v.clippedPh} zoom=${v.zoom}${v.overflow ? ' OVERFLOW' : ''}${v.errors.length ? ' ERR' : ''}`).join('\n'));
console.log(`GUARD: ${guard ? 'PASS' : 'FAIL ' + why.join('; ')}`);
console.log(`SCORE: ${Math.round(total * 100) / 100}`);
