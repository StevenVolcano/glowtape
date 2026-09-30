// Summarize remaining debt by signal + the most common offenders.
import { readFileSync } from 'node:fs';
const { results } = JSON.parse(readFileSync('autoresearch/last_eval.json', 'utf8'));
const sum = {}; const offenders = {};
for (const [k, v] of Object.entries(results)) {
  for (const f of ['axePts', 'tapSmall', 'crowded', 'tinyText', 'noFocus', 'aaa', 'clippedPh', 'zoom']) sum[f] = (sum[f] || 0) + v[f];
  for (const s of v.small) { const key = s.replace(/ \d+x\d+$/, ''); offenders[key] = (offenders[key] || 0) + 1; }
  for (const s of v.noFocusList) offenders['FOCUS ' + s] = (offenders['FOCUS ' + s] || 0) + 1;
  for (const a of v.axe) offenders['AXE ' + a.id + ' ' + a.sample] = (offenders['AXE ' + a.id] || 0) + a.n;
}
console.log(sum);
console.log(Object.entries(offenders).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${n}× ${k}`).join('\n'));
