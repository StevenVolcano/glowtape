// One autoresearch iteration: eval the working-tree styles.css, keep (build+commit)
// or revert, append to autoresearch.jsonl, regenerate the dashboard.
// Usage: node autoresearch/iter.mjs "<description>"
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const desc = process.argv[2] || '(no description)';
const L = 'autoresearch/autoresearch.jsonl';
const lines = readFileSync(L, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const cfg = lines[0];
const res = lines.filter((l) => l.type === 'result');
const best = Math.min(cfg.baseline, ...res.filter((r) => r.status === 'keep' || r.status === 'baseline').map((r) => r.score));
const iteration = res.filter((r) => r.status !== 'baseline').length + 1;
let score = null, guard = null, status, out = '';
try {
  out = execSync('node autoresearch/eval.mjs', { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  score = Number(/SCORE: ([\d.]+)/.exec(out)[1]);
  guard = /GUARD: PASS/.test(out);
} catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
let commit = null;
if (score === null) status = 'crash';
else if (!guard) status = score < best - cfg.min_delta ? 'guard_fail' : 'discard';
else if (score < best - cfg.min_delta) {
  try {
    execSync('npx tsc -b', { stdio: 'ignore' });
    execSync(`git commit -qam ${JSON.stringify(`ux: ${desc} (autoresearch #${iteration}, ${best}→${score})`)}`);
    commit = execSync('git rev-parse --short HEAD').toString().trim();
    status = 'keep';
  } catch { status = 'crash'; }
} else status = 'discard';
if (status !== 'keep') execSync('git checkout -- src/styles.css');
const delta = score === null ? null : (score - best >= 0 ? '+' : '') + (Math.round((score - best) * 100) / 100);
const entry = { type: 'result', iteration, commit, score, delta, guard_pass: guard, status, description: desc, timestamp: new Date().toISOString() };
appendFileSync(L, JSON.stringify(entry) + '\n');
const all = [...res, entry].filter((r) => r.status !== 'baseline');
const cur = Math.min(best, status === 'keep' ? score : Infinity);
const count = (s) => all.filter((r) => r.status === s).length;
writeFileSync('autoresearch/autoresearch_dashboard.md', `# Autoresearch Dashboard — UI/UX

**Constrained file:** \`${cfg.constrained_file}\` · metric: UX debt (lower is better)
**Baseline:** ${cfg.baseline} | **Current best:** ${cur} | **Iterations:** ${all.length}/${cfg.iterations_planned}
**Guard:** no lost controls/text, no font shrink, build passes

| # | Score | Delta | Guard | Status | Description |
|---|-------|-------|-------|--------|-------------|
${all.map((r) => `| ${r.iteration} | ${r.score ?? '—'} | ${r.delta ?? '—'} | ${r.guard_pass === null ? '—' : r.guard_pass ? 'PASS' : 'FAIL'} | ${r.status} | ${r.description} |`).join('\n')}

**Kept:** ${count('keep')} | **Discarded:** ${count('discard')} | **Crashed:** ${count('crash')} | **Guard failures:** ${count('guard_fail')}
`);
console.log(`#${iteration} ${status} score=${score} best_before=${best} ${guard === false ? out.match(/GUARD: .*/)?.[0] : ''}`);
