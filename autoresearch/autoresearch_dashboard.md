# Autoresearch Dashboard — UI/UX

**Constrained file:** `src/styles.css` · metric: UX debt (lower is better)
**Baseline:** 734.05 | **Current best:** 146.05 | **Iterations:** 7/100
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

**Kept:** 6 (+1 visual fixes) | **Discarded:** 0 | **Crashed:** 0 | **Guard failures:** 0
