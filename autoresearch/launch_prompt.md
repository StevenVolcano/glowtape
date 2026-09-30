Read `autoresearch/instructions.md` and `CLAUDE.md`, then `src/styles.css`.

Start PocketBase if it isn't running (`cd backend && ./pocketbase serve --http 127.0.0.1:8090 &`),
run `node autoresearch/eval.mjs` once and confirm SCORE 734.05 + GUARD: PASS
(record as the `baseline` line if autoresearch.jsonl has none).

Then run 100 iterations. Each iteration: pick ONE idea from the strategy (use
`--verbose` / last_eval.json to target the biggest offenders), edit only
`src/styles.css`, run the eval, and:
- SCORE lower by ≥ 0.1 AND GUARD: PASS AND constitution respected → `npm run build`,
  commit, status `keep`.
- otherwise `git checkout -- src/styles.css`, status `discard` / `guard_fail` / `crash`.
Append a result line to `autoresearch/autoresearch.jsonl` and regenerate
`autoresearch/autoresearch_dashboard.md` after every iteration. Every 10th keep,
run `--no-build --shots` and look at a few screenshots for visual regressions.

If you lose context, read autoresearch.jsonl + the dashboard to recover state and
continue from the last iteration number. If 8 iterations in a row are discarded,
the remaining debt is probably in the frozen .tsx files — note which and stop.

When done, write `autoresearch/report.md`: what worked, what didn't, remaining
debt by signal, and which fixes need .tsx changes (Round 2 candidates).
