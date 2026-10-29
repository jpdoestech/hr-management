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
  The desktop topbar and sidebar logo share a 96px header band and aligned
  dividers. The phone header is 84px; supporting text does not add extra rows.
- Dashboard: charcoal hero with white text and violet actions, roomy metric
  cards, and white panels. On phones, cards use two columns and the final odd
  metric fills the row at 420px and below.
- Tables: readable sentence-case headers, compact body rows, soft borders,
  clear badges and existing search/filter/pagination controls. Wide tables
  scroll within their container. Record values use 13px text, headers 12px,
  and cells 6px vertical padding. Single-line employee rows are approximately
  41px on desktop. Touch row controls are 44px, so touch rows grow to fit.
  Employees keeps the toolbar and pagination visible while its table scrolls.
  Employee columns size to headers and displayed records, without fixed pixel
  widths or name ellipses. Keep wide records in the horizontal table scroller;
  do not fetch additional pages to calculate column widths.
- Forms: visible 13px labels, 44px desktop / 48px phone inputs, consistent help/validation states, and
  explicit readonly/disabled styling. Native checkbox/radio sizing is preserved.
  Labels must reference their controls. Required-field errors remain beside
  shared record/employee fields, with linked error summaries and focus recovery.
  Searches retain focus only when they owned it before their delayed render.
  Filter controls reserve room for their text and dropdown arrow. Groups wrap
  rather than shrink labels. Oversized selected values have a full, wrapping
  text note. On phones the employee filter panel overlays the table and closes
  on outside click or Escape, preserving the record area.
  The employee toolbar stays a single row above 720px. At 1500px and wider,
  its four inline filters have equal 176px widths. Laptop/tablet widths use
  the Filters disclosure and a compact two-column popover; phone filters keep
  their single-column panel. Closing a focused panel restores trigger focus.
- Dialogs: rounded surfaces, distinct headers/footers and scrollable bodies.
  Existing employee action navigation, focus handling and confirmation logic
  remain in place. Long names and addresses wrap.
  Overview group pencils require employee update permission. They open only
  the chosen group's fields and save a field-scoped patch through the shared
  employee persistence/audit/rollback path. Keep the full Edit view available.
  Missing record values display "Not recorded" in dark red (`#991B1B`);
  recorded zero amounts retain their normal value styling.
- Attendance: retain its own compact grid, sticky headers/employee column,
  transaction colors and editing behavior. Do not apply directory row padding
  or large input heights to matrix checkboxes.
- Sign-in: existing campus image and navy/gold identity, large people-focused
  copy, rounded image frame and clear form. At 720px the image and form stack.
- Accessibility: skip-to-workspace link, visible focus, keyboard controls,
  mobile form text at 16px, and reduced-motion support. Do not remove labels or
  use color alone to convey state.
- Icons: use the existing outlined SVG family with visible action labels.
  Ellipsis opens an action menu; document opens a record; pencil edits; check
  saves/approves; cross cancels/rejects; trash deletes; arrows navigate back.
  Decorative SVGs are hidden from assistive technology. Icon-only controls
  need an accessible name. Do not add icons to ordinary record values.

## Control sizing system — 2026-10-30

The actual `index.html` order is `app.css` → `professional.css` →
`attendance.css` → `workspace.css`. `app.css :root` owns the semantic sizing
values. `professional.css` consumes them for feature components; it no longer
declares a competing toolbar token set. `attendance.css` owns matrix geometry
and schedule inputs. `workspace.css` owns shared presentation and responsive
token changes. Do not restore a second form-height system in dialog typography.

| Role / token | Desktop | Phone ≤720px |
| --- | --- | --- |
| `--form-control-height` | 44px | `--touch-control-height`: 48px |
| `--form-control-font` | 14px | 16px |
| `--workspace-control-height` (toolbars/search/filters) | 42px | 44px |
| `--workspace-control-font` | 13px | 16px |
| `--workspace-compact-height` (pagination/compact actions) | 34px | 44px |
| `--workspace-compact-font` | 12px | 16px |
| `--table-action-size` | 28px | 44px |
| `--selection-target-size` (labels, clear/header/permission controls) | 24px | 44px |
| `--control-target-size` (preferred minimum touch action) | 44px | 44px |
| `--workspace-control-radius` | 8px | 8px |
| `--control-padding-inline` | 12px | 12px |

Coarse pointers also receive 44px compact, table and selection targets, retaining
desktop text sizes when the viewport is wide. The 42px toolbar token and 44px
form token describe separate roles; forms must consume the form token.

Use `--form-label-size:13px`, `--form-label-gap:8px`,
`--form-field-gap:16px` and `--form-section-gap:24px`. Grid children do not add
another bottom field margin. Textareas use automatic height, existing HTML
rows, vertical resizing and `--form-textarea-min-height:96px`, with 10px vertical
padding. Helper/error text stays 12px (13px summaries), spaced 6px from fields.
Record detail values retain their separate 14.3px display scale.

Picker and currency wrappers own their height; their inner text inputs fit the
wrapper rather than receiving another 44px box. Native selects retain browser
appearance and arrow behavior. Multiselect/listboxes, hidden/file/range/color
inputs and checkbox/radio glyphs are excluded from single-line sizing. Native
uploads retain intrinsic browser height. Checkbox labels provide targets;
permission checkboxes without a wrapping label use the selection target token.
There is no separate custom switch implementation: automation uses labeled
native checkboxes. No radio workflow or new product control was introduced.

Attendance matrix cells, 16px selection checkboxes, frozen identity and date
headers remain specialized. Ordinary record row rules never apply to that
matrix. Its schedule data-entry inputs use form metrics; toolbar/footer fields
use toolbar metrics. Compact pagination and 28px desktop row actions remain
intentional density differences. Mobile request cards retain automatic height.

Visible focus stays on inputs and buttons; pagination/table focus outlines use
an inset offset to stay inside scrollers. Readonly fields remain tinted and
selectable; disabled fields are tinted, faded and noninteractive. Existing
labels, validation associations, keyboard handlers and reduced-motion rules
remain intact. For WCAG 2.2 AA, use the web 24 CSS px target requirement and its
applicable spacing/native-control exceptions; prefer 44px for touch. Do not
resize the Attendance checkbox glyph to achieve an unrelated generic target.

See `docs/UI-CONSISTENCY.md` for the measured before/after table, selector
coverage, fixture checks and limits. This work is verified locally; publication status and the implementation commit
are recorded in ROADMAP.md.

## Shared table contract — 2026-10-29

Every ordinary table under `#content` or `#modal` uses content width and native
automatic layout, including settings, access control, previews and summaries.
Do not add viewport-filling widths or arbitrary whole-table minimum widths.
Use 12px headers, 13px values, 40px minimum ordinary rows and 6px/12px cell
padding. Long prose wraps within 36rem; the employee directory keeps complete
single-line values in its scroller. Form controls/multiline content can grow
rows. Keep table action targets 28px desktop and 44px touch. Shared pagination
and toolbar metrics apply throughout; desktop searches cap at 480px. Content
gutters align with the header. Preserve the daily Attendance grid and mobile
request cards; request descriptions use automatic height. See the family
inventory and current validation in `docs/UI-CONSISTENCY.md`.

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
were used for this visual change. After publication, the live index at
`https://strellas-hr.vercel.app/` and the versioned workspace stylesheet both
returned HTTP 200; the CSS exactly matched the tested source after CRLF
normalization. Authenticated production acceptance remains separate.
