# Autoresearch — Glow Tape UI/UX (Round 1)

## System context
Glow Tape is a Vite + React 19 PWA for community-theater productions (see
CLAUDE.md). Nearly all visual design lives in ONE stylesheet, `src/styles.css`
(design tokens on `:root`, component classes, print + reduced-motion rules).
The eval builds the app, serves it against a LOCAL PocketBase seeded with a
demo show ("Our Town"), opens 19 screens in headless Chromium (16 at 390px
phone width, 3 at 1280px desktop) as a signed-out visitor, the director and an
actor, and scores measurable UX debt on each.

## Constrained file (the ONLY file you may edit)
`src/styles.css`

Tunable levers:
- Tap-target sizing: min-height/padding on `a.link`, `.row a`, `button.link`,
  inline map/calendar links, checkboxes' wrapping labels, tab links.
- Target spacing: gaps/margins between stacked links and chip rows (≥ 8px).
- Focus visibility: `:focus-visible` rings for `a`, `summary`, `[role=button]`,
  tabs — a ≥2px outline or a box-shadow ring (keep it on-brand, visible on
  both `--paper` and white cards).
- Type scale: nothing visible under 14px (hints, meta lines, badges, footers).
- Contrast: darken muted/hint text tokens toward 7:1 (AAA) where cheap.
- Placeholder fit: inputs whose italic placeholder is cut off (smaller
  placeholder font is NOT allowed — see guards; use layout: full-width inputs,
  wrapping rows, flex-basis).

## Frozen (do not touch)
Everything except `src/styles.css`: all `.tsx/.ts`, `public/*`, backend,
`autoresearch/*` (eval, seed, guard_baseline.json). Changing the eval or
baseline to "win" invalidates the run.

## Eval
```
node autoresearch/eval.mjs            # builds (vite), ~37s
node autoresearch/eval.mjs --verbose  # + per-screen offender lists
node autoresearch/eval.mjs --no-build --shots   # screenshots → autoresearch/shots/
```
One-time deps (not in package.json on purpose): `npm install && npm install --no-save axe-core playwright-core && npm run setup-backend && (cd backend && ./pocketbase superuser upsert admin@test.local testpass12345)`.
Needs PocketBase running: `cd backend && ./pocketbase serve --http 127.0.0.1:8090`
(superuser admin@test.local / testpass12345 is local-only test data).
Per-screen details land in `autoresearch/last_eval.json`.

## Metric
`SCORE` = total UX debt points, **LOWER IS BETTER**. Baseline **734.05** (after the .card.stack fix; was 728.05)
(3 identical runs → fully deterministic). Per screen:
| signal | weight |
|---|---|
| axe WCAG 2.2 AA + best-practice violations | critical 10 / serious 5 / moderate 2 / minor 1 per node |
| hit box < 44×44 (inline links in prose exempt; label box counts for wrapped inputs) | 1 each |
| adjacent targets < 8px apart | 0.5 per pair |
| horizontal page overflow | 25 |
| inputs with font-size < 16px (iOS zoom) | 2 each |
| clipped placeholder | 1 each |
| visible text element < 14px | 0.25 each |
| Tab stop (first 20) without ≥2px outline or box-shadow ring | 2 each |
| AAA 7:1 contrast failures | 0.1 per node |
| page JS error | 50 |

**Min-delta:** 0.05 (was 0.1; lowered at #19 because the smallest signal weight is 0.1) (eval is deterministic; any real drop counts).

## Guards (a violation = `guard_fail`, discard even if SCORE improved)
1. Eval prints `GUARD: PASS` — no screen loses visible controls, loses >3% of
   visible text, or shrinks median body font vs `guard_baseline.json`
   (stops "fix" by hiding or shrinking things).
2. `npm run build` passes (run it on every KEEP before committing).
3. Design constitution (check by reading your diff; screenshot every 10th keep
   with `--shots` and LOOK at 3–4 of them):
   - `--paper` stays cool gray `#f2f3f6`; cards/chips stay `#ffffff`; never warm cream.
   - `.join-code` stays straight (no rotation); rips only at the ends.
   - Every animation/transition stays under `prefers-reduced-motion` guards.
   - `@media print` rules keep working (don't delete/override print blocks).
   - The glow-tape brand look (h2 tick, highlighter swipe, lime accent) stays.
   - Big tap targets and plain layout for all ages — no cramming.

## Strategy (roughly in order)
Phase A — quick wins
1. Global `a:focus-visible, summary:focus-visible, [role=button]:focus-visible`
   ring (outline 3px solid var(--ctrl) + offset) — biggest single bucket.
2. `a.link` / back links ("← All productions") get the 44px inline-flex box.
3. `.muted`/hint/meta tokens → ≥14px.
Phase B — main optimization
4. Stacked link lists ("Needs you", "Getting settled"): 44px rows + ≥8px gap.
5. Event-card meta links (📍 map, + Google Calendar, Apple): 44px hit boxes
   without bloating visual height (padding + negative margin, or min-height).
6. Chip rows / JumpNav: gap ≥ 8px.
7. Manage-tab inline table inputs (153×24) and bare checkboxes: min-height 44px
   or a padded label.
8. Clipped placeholders: let `.row` inputs wrap to full width on phones.
Phase C — experimental
9. AAA contrast: darken `--muted`-style tokens a step at a time.
10. Consolidate duplicate rules the earlier changes made redundant (score must hold).

One idea per iteration. Small, reversible diffs.

## Do NOT
- Edit any file other than `src/styles.css`.
- Hide elements, set opacity 0, `display:none` things the eval counts, or
  shrink text/placeholders to dodge a check.
- Remove print or reduced-motion blocks, or reintroduce warm cream / rotation.
- Push to `main`. Commits go on the current `claude/*` branch only.

## Loop mechanics
- **Commit everything else before running `iter.mjs`** — a discard restores all of `src/` to HEAD.
- Revert a discard: `git checkout -- src/styles.css`
- Keep: `npm run build && git commit -am "ux: <what> (autoresearch #N, <old>→<new>)"`
- Log every iteration to `autoresearch/autoresearch.jsonl` and regenerate
  `autoresearch/autoresearch_dashboard.md`.
