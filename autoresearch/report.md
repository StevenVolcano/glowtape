# Autoresearch report — Glow Tape UI/UX

**63 experiments** · 48 kept on score · 7 kept as visual fixes (found by
looking at screenshots; score held) · 8 discarded · 0 crashes · 0 guard
failures. Stopped at a plateau, not at 100 — see "Why not 100".

## Score by round (UX debt, lower is better)
| Round | Harness | Start → end |
|---|---|---|
| 1 | 19 screens, `styles.css` only | 734 → 20 |
| 1b | +17 screens (320px, print, check-in, operator, opened editors) + forced-colors + WCAG text-spacing | 136 → 51 |
| 2 | placeholder copy + audition heading unfrozen (`.tsx`) | 51 → 1 |
| 3 | richer seed (open auditions, slots, breakdown, potluck, reactions…) | 25.5 → 2 |
| 4 | script room, show report, sign-up-sheet form, poster, tablet 768px | 6 → 2 |
| 4b | + "active tab is on screen" check | 67 → 2 |

## What worked (biggest wins first)
1. **Focus rings on links** (#1, −504): links, summaries and role=button had no visible keyboard focus.
2. **Active tab scrolled into view** (#63, −65): on phones — and on desktop Manage — the current tab started off-screen, so nothing said where you were.
3. **Tab/calendar-link spacing** (#8, #9): targets sat 4px apart.
4. **44px targets** for topbar back links, map links, card links, checkbox labels, `button.link` width.
5. **AAA contrast tokens**: `--muted` #6b6478→#544e63, `--error` →#962c25, `--ok` →#205d3b (all ≥7:1 on paper and white).
6. **Windows High Contrast**: borderless buttons got a system-colored edge.
7. **Taken sign-up slots** used `opacity: 0.6` (failed AA) → dashed muted chip.
8. **Long free-text fields → 2-row textareas** (casting notes, event types, playwright credit) so the example is readable; ~20 placeholders shortened on the "— for example:" convention.

## Visual fixes the metric couldn't see
- `.card.stack` layout (dashboard "Act 1 blockingMon, Oct 5" — the requested fix; affected 18 cards).
- Typed text was bold inside `<label>`-wrapped fields.
- "Pinned" pill glued to the announcement title; "all theaters" pill wrapping.
- Setup checklist ⬜/✅ dropped onto its own line.
- Manage checkbox rows stretched after #6 (fixed in #7); #4's list-link rule was
  scoped to link-only lists after it spaced out Home's "More" list.
- `hyphens: auto` on narrow table cells ("Drift-wood", not "Driftwoo d") — works on
  real phones; headless Linux Chromium has no hyphenation dictionary.

## What didn't work
- Less input padding (#16) — no placeholder flipped.
- A flex-basis on row inputs (#26, #28) — squeezed inputs that had a button beside them.

## Left over (2 points + things outside the metric)
- Sign-in "Code" hint is cut off at 320px; the shorter wordings lose "organizer".
- "Print a blank form" is a 17px link inside a sentence (WCAG exception; left alone).
- Script room: "Page →" wraps onto its own line on phones (row too wide) — a small
  ScriptRoom.tsx layout change.
- Contact sheet is cramped at phone width (5 columns); a scroll-or-cards layout is a design call.
- Poster repeats "Scan with your phone…" twice.

## Why not 100
Every signal the harness can measure is at or near zero. I widened the harness four
times to find real debt; after that, further "experiments" would be taste-driven
changes with no metric to accept or reject them, which isn't what this loop is for.
Next step: a human pass on the leftovers above, or new signals (e.g. dark mode, which
CLAUDE.md lists as a deliberate gap).

## Re-running
See `instructions.md`. `node autoresearch/iter.mjs "<idea>"` runs one experiment
(eval → keep+commit or revert → log). All test data is local-only seed data.
