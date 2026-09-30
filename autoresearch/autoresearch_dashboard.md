# Autoresearch Dashboard — UI/UX

**Constrained file:** `src/styles.css` · metric: UX debt (lower is better)
**Baseline:** 734.05 | **Current best:** 14 | **Iterations:** 40/100
**Guard:** no lost controls/text, no font shrink, build passes

| # | Score | Delta | Guard | Status | Description |
|---|-------|-------|-------|--------|-------------|
| 1 | 230.05 | -504 | PASS | keep | Focus ring on links, summaries and role=button (3px accent outline) |
| 2 | 210.05 | -17 | PASS | keep | Topbar links (← All productions / ← Home) get 44px inline-flex box |
| 3 | 195.05 | -15 | PASS | keep | Event-line map links get 44px inline-flex hit box |
| 4 | 175.05 | -20 | PASS | keep | Plain-list and card-stack standalone links get 44px |
| 5 | 164.05 | -11 | PASS | keep | button.link min-width 2rem -> 44px (Edit, ✕) |
| 6 | 146.05 | -18 | PASS | keep | Checkbox/radio wrapping labels become 44px flex rows |
| 7 | 146.05 | +0 | PASS | keep_visual | Visual fix for #6: checkbox labels nowrap; member-row checkbox no longer stretched |
| 8 | 77.85 | -68.2 | PASS | keep | Tab bar gap 4px -> 8px |
| 9 | 70.35 | -7.5 | PASS | keep | Calendar-link row gap 4px -> 8px |
| 10 | 58.35 | -12 | PASS | keep | Edit-table cell padding 0.2rem -> 0.25rem (8px between stacked inputs) |
| 11 | 57.35 | -1 | PASS | keep | Space between a textarea and the button row under it |
| 12 | 29.75 | -27.6 | PASS | keep | --muted #6b6478 -> #544e63 (5.1:1 -> 7.15:1, AAA on paper and white) |
| 13 | 23.5 | -6.25 | PASS | keep | Pills 0.8rem -> 0.85rem (13.6px -> 14.45px) |
| 14 | 23 | -0.5 | PASS | keep | Chat author line 0.8rem -> 0.85rem |
| 15 | 20 | -3 | PASS | keep | member-row selects/inputs min-width 9rem -> 11rem so role names fit |
| 16 | 20 | +0 | PASS | discard | Input side padding 0.75rem -> 0.65rem |
| 17 | 68.85 | +48.85 | PASS | discard | Forced-colors: borderless buttons get a ButtonText border |
| 18 | 68.85 | -67.5 | PASS | keep | Forced-colors: borderless buttons get a ButtonText border |
| 19 | 68.75 | -0.1 | PASS | discard | --error #b3372f -> #962c25 (5.4:1 -> 7.05:1) |
| 20 | 68.75 | -0.1 | PASS | keep | --error #b3372f -> #962c25 (5.4:1 -> 7.05:1), retry after min-delta fix |
| 21 | 67.75 | -1 | PASS | keep | Paragraph-only links (check-in '→ Tonight's schedule') get 44px |
| 22 | 65.75 | -2 | PASS | keep | Focus ring also on input:focus-within (date/time inner fields) |
| 23 | 61.75 | -4 | PASS | keep | Month grid cells wrap (overflow-wrap:anywhere) instead of clipping |
| 24 | 51 | -10.75 | PASS | keep | Month grid 0.72rem -> 0.85rem on screen (print keeps 0.72rem) |
| 25 | 51 | +0 | PASS | keep_visual | hyphens:auto on month-grid + contact-sheet cells (no mid-word splits on real phones) |
| 26 | 54 | +3 | PASS | discard | Row labels/inputs flex-basis 10rem so fields wrap instead of squeezing |
| 27 | 50 | -1 | PASS | keep | Row labels flex-basis 10rem (labels only) so fields wrap instead of squeezing |
| 28 | 95 | +45 | PASS | discard | Text field + button rows: field flex 1 1 15rem, button wraps under on phones |
| 29 | 50 | +0 | PASS | discard | Phone: single field+button rows give the field the full line |
| 30 | 38 | -12 | PASS | keep | Casting-notes fields become 2-row textareas so the example is readable |
| 31 | 35 | -3 | PASS | keep | Event-types list becomes a 2-row textarea (whole standard list visible) |
| 32 | 33 | -2 | PASS | keep | Playwright/composer credit becomes a 2-row textarea (long credits fit) |
| 33 | 27 | -6 | PASS | keep | Operator ticket-link placeholder shortened to fit (aria-label names the company) |
| 34 | 25 | -2 | PASS | keep | Production ticket-link placeholder shortened to fit phones |
| 35 | 23 | -2 | PASS | keep | Sign-in name placeholder: 'First and last name' (fits phones) |
| 36 | 22 | -1 | PASS | keep | Sign-in code placeholder shortened |
| 37 | 17 | -5 | PASS | keep | Conflict reason placeholder shortened to fit |
| 38 | 17 | +0 | PASS | keep_visual | Conflict reason placeholder back on the 'for example:' convention |
| 39 | 15 | -2 | PASS | keep | To-do placeholder shortened to fit |
| 40 | 14 | -1 | PASS | keep | Home join-code placeholder shortened |

**Kept:** 31 (+3 visual fixes) | **Discarded:** 6 | **Crashed:** 0 | **Guard failures:** 0
