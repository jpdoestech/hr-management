# SLSC people workspace

The UI takes its generous spacing, rounded surfaces and clear hierarchy from
Sprout's public website. SLSC's established colors, fonts, logo and existing
workflows remain the source of truth. No framework or dependency was added.

## Stylesheet ownership

Load `app.css`, `professional.css`, `attendance.css`, then `workspace.css`.
`professional.css` owns the existing palette and feature-specific structure.
`workspace.css` provides the shared presentation and responsive refinements.
Reuse these classes for new views; keep authorization and state in the runtime.

| Role | Existing value |
| --- | --- |
| Workspace accent | `--accent: #6246E5` |
| Accent hover | `--brass-dk: #4D34C8` |
| Selected surface | `--accent-soft: #F0EDFF` |
| Main text | `--text: #28252F` |
| Dark hero | `--navy-deep: #25212D` |
| Page / card | `--page: #F7F7FA` / `--surface: #FFFFFF` |
| Gold detail | `--gold-soft: #FFD86B` |
| Sign-in primary | `#123D70` |

Keep the existing success, warning, error and attendance-status colors. Status
text accompanies color. Plus Jakarta Sans remains the interface font, with IBM
Plex Mono for identifiers. Use tabular figures for numeric comparisons.

## Shared components

- Navigation: white sidebar, full readable group labels, violet selected state,
  and the existing keyboard-operable group popovers. At 900px it becomes the
  existing drawer. Preserve permission-based visibility.
- Headers: workspace context above the page title; one clear action hierarchy.
- Dashboard: charcoal hero with white text and violet actions, roomy metric
  cards, and white panels. On phones, cards use two columns and the final odd
  metric fills the row at 420px and below.
- Tables: readable sentence-case headers, generous body rows, soft borders,
  clear badges and existing search/filter/pagination controls. Wide tables
  scroll within their container.
- Forms: visible labels, 44px inputs, consistent help/validation states, and
  explicit readonly/disabled styling. Native checkbox/radio sizing is preserved.
- Dialogs: rounded surfaces, distinct headers/footers and scrollable bodies.
  Existing employee action navigation, focus handling and confirmation logic
  remain in place. Long names and addresses wrap.
- Attendance: retain its own compact grid, sticky headers/employee column,
  transaction colors and editing behavior. Do not apply directory row padding
  or large input heights to matrix checkboxes.
- Sign-in: existing campus image and navy/gold identity, large people-focused
  copy, rounded image frame and clear form. At 720px the image and form stack.
- Accessibility: skip-to-workspace link, visible focus, keyboard controls,
  mobile form text at 16px, and reduced-motion support. Do not remove labels or
  use color alone to convey state.

## Verification — 2026-10-22

`npm run lint`, `npm test` (389 tests), `npm run build` and
`node scripts/validate.mjs` passed. The browser fixtures load the same shared
stylesheet as production. `workspace-redesign-fixture.mjs` checks its generated
script syntax before serving; it strips production scripts and uses synthetic
records without connecting to Supabase.

Browser review covered desktop dashboard, directory, settings and dialog;
desktop/phone sign-in; registration layout; tablet attendance/sign-in; phone
dashboard, drawer/popover navigation and attendance; and the actual employee
overview/edit markup using the existing modal fixture. Tested at 1280px,
768px and 390px. Checked attendance staging, 16px matrix checkboxes, wrapped
long employee details and absence of document-level horizontal overflow on the
reviewed phone/tablet views. A separate 320px check covers the smallest layout.

Run `node tests/browser/workspace-redesign-fixture.mjs` and open
`http://127.0.0.1:4190/` (`?view=auth` for sign-in). The fixture's non-attendance
pages are representative component compositions, not complete runtime flows.
Use `node tests/browser/modal-typography-fixture.mjs` for actual employee
workspace markup with synthetic data. No production employee records, live
authentication, database mutations or exhaustive role-specific runtime flows
were used for this visual change. Deployment requires separate verification.
