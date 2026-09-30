// Summarize remaining debt by signal + the most common offenders.
import { readFileSync } from 'node:fs';
const { results } = JSON.parse(readFileSync('autoresearch/last_eval.json', 'utf8'));
const sum = {}; const offenders = {};
for (const [k, v] of Object.entries(results)) {
  for (const f of ['forced', 'spacingClip', 'axePts', 'tapSmall', 'crowded', 'tinyText', 'noFocus', 'aaa', 'clippedPh', 'zoom']) sum[f] = (sum[f] || 0) + v[f];
  for (const s of v.small) { const key = s.replace(/ \d+x\d+$/, ''); offenders[key] = (offenders[key] || 0) + 1; }
  for (const s of v.crowdList || []) { const key = 'CROWD ' + s.replace(/ \d+x\d+/g, ''); offenders[key] = (offenders[key] || 0) + 1; }
  for (const s of v.aaaList || []) { const key = 'AAA ' + s.replace(/^.*? (?=[\d.]+ #)/, ''); offenders[key] = (offenders[key] || 0) + 1; }
  for (const s of v.phList || []) offenders['PH ' + s] = (offenders['PH ' + s] || 0) + 1;
  for (const s of v.tinyList || []) offenders['TINY ' + s] = (offenders['TINY ' + s] || 0) + 1;
  for (const s of v.forcedList || []) offenders['FORCED ' + s] = (offenders['FORCED ' + s] || 0) + 1;
  for (const s of v.spacingList || []) offenders['TSPACE ' + s] = (offenders['TSPACE ' + s] || 0) + 1;
  if (v.spacingOverflow) offenders['TSPACE-OVERFLOW ' + k] = 1;
  for (const s of v.noFocusList) offenders['FOCUS ' + s] = (offenders['FOCUS ' + s] || 0) + 1;
  for (const a of v.axe) offenders['AXE ' + a.id + ' ' + a.sample] = (offenders['AXE ' + a.id] || 0) + a.n;
}
console.log(sum);
console.log(Object.entries(offenders).sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, n]) => `${n}× ${k}`).join('\n'));
