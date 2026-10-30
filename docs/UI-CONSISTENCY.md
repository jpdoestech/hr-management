# UI consistency

## Automated workflow coverage — 2026-10-30

`npm run test:browser` now runs the existing synthetic fixtures together. See
[BROWSER-REGRESSIONS.md](BROWSER-REGRESSIONS.md) for coverage, commands,
performance methodology and limitations. The separate UI regression workflow
adds repeatable checks without changing deployment behavior. Shared sizing
standards below remain unchanged. Attendance refresh accessibility and the
post-confirmation submission guard are the only production behavior changes
in this follow-up.

## Control sizing audit and implementation — 2026-10-30

Implemented and verified locally. Publication status is recorded in ROADMAP.md.
No production deployment was performed as part of this workflow.
This specification supersedes the older form sizing/type descriptions below.
No production JavaScript, business rules, database, configuration, permissions,
validation semantics, labels, IDs, names, ARIA attributes or handlers changed.

### Findings and ownership

Reviewed AGENTS.md, README, this document, MASTER, the UI/UX Pro Max skill,
index, all four CSS layers, generated markup across app/core/address/manpower,
package scripts, CSS tests, browser fixtures and validation/build scripts.
A focused local skill search informed target-size and label decisions.

The actual stylesheet order is app → professional → attendance → workspace.
Professional declared 38px toolbar controls; workspace redeclared 42px. Forms
were documented as 44px but mixed 38px component boxes, 44px minima, padding
sizing and 14.3px modal input text. Employee labels were 12.35px; textareas
measured about 76px desktop / 83px phone. Sign-in fields/buttons measured 50px
while the password toggle measured about 27px. Picker/currency wrappers and
inner inputs had separate dimensions and !important resets. Settings and some
other grids combined their gap with each field's bottom margin. Broad input
sizing also included non-text controls. Readonly text also inherited a muted color measuring about 4.38:1 contrast;
readonly fields now retain primary text on their tinted background.
Older search/filter/pagination rules
still declared inconsistent values, even when later layers masked them.

Sizing defaults now have one owner in app.css. Feature components consume
those tokens in professional.css and attendance.css. Existing responsive rules
in workspace.css adapt them for phones and coarse pointers. Removed 25
!important declarations from professional.css (98 → 73); none were added.
Remaining declarations include existing presentation and specialized controls,
not a new blanket sizing override. No new framework or dependency.

### Standards and coverage

| Component / actual selectors | Implemented rule |
| --- | --- |
| Shared `.field`, `.formgrid`, `.employee-form-grid`, address/settings/manpower grids | 44px entry controls; 48px on phones; 14/16px input text; 13px labels; 8px label gap; 16px field gap; 24px section gap; 8px radius; 12px horizontal padding |
| Auth `.auth-field`, `.auth-submit`, `.auth-password button` | Same form metrics; 44px password action target; registration preserves its grid |
| Employee creation/edit/scoped forms and Overview | Shared form metrics; record values retain their own display type; scoped pencils keep 28px/44px targets |
| `.toolbar`, `.data-toolbar`, workflow/quality/analytics/access controls | 42px desktop / 44px phone controls; readable 13/16px text; existing employee disclosure at 721–1499px and equal inline filters at ≥1500px retained |
| `.employee-picker-input`, `.tda-picker-input`, `.money-input`, catalog controls | Wrapper owns form height; inner inputs fit it; existing keyboard, selection, clear and catalog handlers retained |
| Leave, requests, approvals, disciplinary/document and compensation forms | Shared fields and entry-modal styles; text/date/time/datetime/number/email inputs; automatic 96px-minimum textareas |
| Attendance | 42/44px toolbar and footer; 44/48px schedule entry; matrix geometry and 16px checkboxes unchanged |
| Manpower header/draft/lifecycle/quantity editors | Form tokens and consistent field gaps; dense administrative table layout retained |
| Access/settings, labeled checkboxes and automation checkbox switches | Native glyphs; 24px desktop label/control targets and 44px touch targets; permission controls without labels get direct targets |
| Tables, pagination and column menus | Existing 13px body/12px headers/40px minimum rows; 34px desktop pagination; 44px touch; 28px/44px row actions; column-menu targets at least 24px |

The token names/defaults and responsive roles are listed in MASTER. Textareas
have no fixed height; native file controls, hidden inputs, range/color inputs,
multiselects and native checkbox/radio glyphs are excluded from text-field
height rules. No standalone payroll or radio workflow/custom switch was added.
Automation switches remain native checkbox labels. Attendance, compact
pagination, contextual row actions, multiline option rows and mobile request
cards are intentional density/geometry exceptions.

### Measured before and after

Computed browser dimensions, CSS px, using the same synthetic fixtures.
Desktop values below are from 1440px (Attendance baseline: 1280px); phone values from 390px. Approximate
values account for native rendering/pixel rounding.

| Representative control | Desktop before → after | Phone before → after |
| --- | --- | --- |
| Employee text input | 44 → 44 | 44 → 48 |
| Employee select | 44 → 44 | 44 → 48 |
| Employee date input | 44 → 44 | 44 → 48 |
| Employee textarea | ≈75.6 → 96 minimum | ≈82.8 → 96 minimum |
| Sign-in input | 50 → 44 | 50 → 48 |
| Sign-in primary button | 50 → 44 | 50 → 48 |
| Password visibility button | ≈27.2 → 44 | ≈27.2 → 44 |
| Employee search/filter/action button | 42 → 42 | 44 → 44 |
| Pagination button / page-size select | 34 → 34 | 44 → 44 |
| Employee table action | 28 → 28 | 44 → 44 |
| Attendance footer field | 40 → 42 | 44 → 44 |
| Attendance checkbox | 16×16 → 16×16 | 16×16 → 16×16 |

Employee form input text changes from 14.3px to 14px desktop and stays 16px on
phones. Labels change from 12.35px to 13px. Ordinary table density remains
approximately 41px desktop / 57px phone for single-line employee records.

### Verification and limits

Checked at 1440, 1280, 768, 390 and 320px with computed-style assertions:
employee Edit, shared Controls and entry-modal compositions; sign-in and
registration; directory filters/actions/pagination; table families, leave
records and request cards; actual manpower header markup and Attendance.
No page-level horizontal overflow on these reviewed surfaces. The employee
fixture retains its toolbar alignment, full-name, bounded-row, footer and
filter-text checks. Attendance retains sticky headers/identity and measured
42px desktop / approximately 61.6px phone cell heights in the synthetic dataset.
Its 16px checkboxes and successful day staging remain unchanged.

The modal fixture's `?view=Controls` uses actual employee-picker functions plus
representative native input types, currency/catalog wrappers, readonly/disabled
states, native upload/hidden fields, checkbox settings and schedule inputs.
Checks cover heights, fonts, textarea minima, wrapper alignment and line boxes.
Native select `line-height:normal` is checked with a conservative font-based
allowance and visual review rather than parsed as a numeric line height.
Keyboard Arrow Down/Enter selection and Escape closure, native checkbox
selection, linked error text/ARIA and visible focus were checked. Table focus
outlines remain inside their scrolling viewport. Native date/time field
geometry is checked; OS/browser popup rendering remains platform-owned.

An optional manpower fixture initially failed with a pre-existing missing
`iArrowLeft` helper. It now reuses the actual SVG helper functions, enabling
inspection of the actual amendment form; production code was not altered.

`npm run lint`, `npm test` (407 passing), `npm run build`,
`node scripts/validate.mjs` and `git diff --check` passed after implementation.
Synthetic fixtures never connected to Supabase or used production records.
This is not exhaustive authenticated workflow, physical-device, cross-browser,
OS calendar/file-dialog or assistive-technology certification. Native controls
and Attendance retain the applicable target-size/spacing exceptions; 44px is
preferred touch sizing rather than a claim that WCAG always requires 44px.


## Employee History return navigation — 2026-10-29

Overview originally rendered disabled without a click handler. Switching to
History enabled that button but left it without an action. The shared navigation
renderer now retains handlers on active buttons; native disabled state still
prevents activating the current destination. No routing, save or data behavior
changed. A regression test reproduces the History-to-Overview transition for
editors and viewers. The modal fixture now uses the actual tab switcher, and a
browser click through History then Overview restored Personal Information.
Lint, 407 tests, build, structural validation and diff checks passed. Synthetic
records only; authenticated production history retrieval was not exercised.


## Shared table responsiveness and uniformity — 2026-10-29

Investigated every application table declaration in `js/app.js`, core modules
and manpower modules (excluding the spreadsheet vendor). Compared the read-only
`employee-information-movement-tracker` table-sizing and scroll-region patterns.
The root cause of wide-screen stretching was the combination of shared
`width:100%`, employee `min-width:100%`, and feature-specific minimum widths.

The final shared cascade covers these families:

| Tables | Shared behavior |
| --- | --- |
| Employees; generic HR records, attendance records and workflows | Intrinsic columns, readable compact cells, contained scrolling |
| Cases, offense/TDA, correspondence, leave, transfers and lifecycle | Same table metrics; long descriptions wrap |
| Onboarding, manpower lines, workers, review/history and import previews | Same widths/spacing; existing workflows and paging retained |
| Settings, access users, permission matrices and overrides | Same typography/spacing; inputs and sticky identity cells retained |
| Dashboard summaries and analytics | Same readable metrics without expanding short columns |
| Dialog tables and editable configuration tables | Same sizing/typography; controls can grow their rows |

All ordinary tables use automatic layout and content width rather than filling
spare viewport space. Long prose wraps within 36rem cells; employee directory
values retain their complete single-line display inside the horizontal scroller.
Headers use 12px type, values 13px, ordinary rows a 40px minimum, and cells
6px by 12px spacing. Long descriptions, multiline identities and form controls
can grow rows. Table action icons use 28px desktop / 44px touch targets.
Pagination, toolbar controls, search icons and content gutters share metrics;
desktop search containers stop growing at 480px. No text measuring loops,
additional records, dependencies, data queries or JavaScript runtime changes.

Attendance's daily editing matrix retains its specialized grid, transaction
colors, sticky headers and employee identity. Mobile self-service requests
retain their labeled cards, 13px values, 12px labels, automatic description
height and 44px action targets. These purposeful layouts are exceptions to
ordinary row geometry, rather than separate typography systems.

`ui-consistency-fixture.mjs?view=tables` provides 11 table-class compositions
plus an editable table. Assertions check the final cascade: fonts, spacing,
non-stretching wide-screen columns, wrapped prose, sticky headers and contained
scrolling. `?view=portal` checks mobile request cards. These are synthetic
compositions, while default Employees and `?view=leaves` use actual renderers.

Browser checks passed at 320, 390, 768, 1366, 1920, 2560 and 3440px, plus
812x375 landscape. The same employee dataset stayed about 1170px wide at
768–3440px, with full names and approximately 41px desktop / 57px phone rows.
Employee footer/header checks pass. Modal Edit and scoped Emergency Information
checks pass on phone/tablet/wide desktop. Attendance checks at 320, 768 and
2560px confirm no document overflow, sticky headers/identity, 16px checkboxes,
and successful synthetic day staging without a database write.

Validation: lint, 406 tests, production build, structural validation and diff
checks passed. No SQL, security-policy, persistence or production data changes.
Authenticated production workflows and physical-device/browser exhaustiveness
remain outside this synthetic review.


## Desktop filter layout refinement — 2026-10-29

The employee filter group previously allowed controls to grow and wrap into
uneven blocks beside the search. Desktop toolbars now keep search, filters and
actions aligned in a single approximately 61px row. At 1500px and wider, the
four inline selects have equal 176px widths. At 721–1499px, a Filters button
opens a 440px two-column popover instead of stretching inline controls. Phone
filters retain their existing one-column panel. Full-label notes remain for
unusually long selected values, and closing a focused panel returns keyboard
focus to its trigger.

The synthetic fixture's `?admin=1` variant includes Add Employee, and its browser
assertions check toolbar height, action alignment and equal inline widths.
Browser checks passed at 1280px, 1366px, 1500px and 1920px, including active
filters with Clear and Add Employee. A 390px phone check confirmed the existing
responsive bounds. Lint, 406 tests, build, structural validation and diff checks
pass. No data queries, permissions or persistence behavior changed.

## Visibility and section-edit follow-up — 2026-10-29

Fixed filter widths left over from the smaller type scale could clip labels
such as Department and Employment Type. Shared toolbar selects now size to
content, reserve arrow space and wrap as a group. When a selected value is
longer than the available screen width, its complete text appears in a wrapping
note. Phone employee filters overlay the table and close on outside click or
Escape. No extra data fetches or per-row measurements are used for filters.

Employee columns now use native automatic table layout, with no fixed column
widths or employee-name ellipses. Width follows headers and the current page's
data; wide tables remain horizontally scrollable. Other record-table secondary
text and attachment names no longer use the identified clipping rules. Frozen
column offsets refresh after fonts load. The employee search SVG is 16px,
vertically centered and fully opaque.

Displayed "Not recorded" values use dark red in employee details, government
IDs, employee-relations summaries and manpower worker dates. Zero amounts keep
their normal recorded-value styling. Missing employee date values shown as a
dash are normalized to the same explicit missing-value treatment in Overview.

Each editable Overview group has a named pencil shortcut, gated by employee
update permission. Emergency Information opens only its three contact fields.
Section saves validate that group's fields and commit only those fields through
the shared employee save/audit/rollback path. Other sections, historical values
and unresolved addresses are preserved. Personal details retain address and
duplicate-name checks; employment details retain catalog/status validation;
government IDs and monetary sections retain their existing validation rules.
Separation needing leaving details continues through Movement. Full Edit and
the existing unsaved-change navigation guard remain available.

The follow-up adds regressions for scoped markup, permission checks, unrelated
field preservation, failed-save rollback, zero compensation, full-save reuse,
content-sized columns and overflowing filter values. The modal fixture supports
`?section=1` and `?readonly=1`; section saves in that browser fixture update only
synthetic in-memory data. Real persistence and rollback are exercised by the
unit harness with a stubbed save result, not a live production database.

Validation: 405 tests, lint, build, structural validation and diff checks pass.
Browser review used synthetic records, long names and long selected filter
values at phone, tablet and desktop widths. Authenticated production saves
remain outside these checks.

The verification below describes the earlier implementation.

This change resolves the ten findings from the UI audit and the requested
compact employee rows, matching transaction icons and aligned header dividers.
The static HTML/CSS/JavaScript architecture, fonts and authorization model stay
in place. No dependency, database schema or migration changes are required.

## Changes

- Shared field labels reference input, select, textarea and upload IDs. Opening
  a hand-built modal also connects its unassociated field labels when the control
  already has an ID. Single row-action buttons receive accessible names.
- Delayed searches restore their caret only if the search owned focus before
  rendering. Replaced filters recover focus by ID or accessible name. A newer
  focus choice during an asynchronous render takes precedence.
- Record tables share 13px values, 12px headers and compact padding. Employee
  rows measure approximately 41px on desktop and 57px with mobile touch controls.
  Wide tables scroll inside the workspace; the employee footer stays visible.
- Employee directory requests, visible-column projection, 25-row default,
  bounded cache, debounce and stale-response protection remain unchanged.
  No extra requests or runtime libraries were added for presentation.
- Case details, confidentiality markers and access descriptions no longer use
  the audited 7–10px typography. Identifiers inherit readable record text sizing.
- Employee search and filters use the shared control tokens and 16px phone text.
- Dialog headings, labels and values consume the existing dialog tokens.
  Standard form inputs have a 44px minimum height on desktop and phones.
- Shared record and employee required-field errors remain beside their inputs,
  with linked summaries, `aria-invalid`, and `aria-describedby`. Editing clears
  the field's error without removing unrelated help-text associations. Existing
  business and service validation remains enforced.
- Filtered leave empty states distinguish no matches from an empty dataset and
  provide a clear-filters action that cancels pending search work.
- Action menus use ellipsis; employee workspaces use a document icon; edit uses
  pencil. Common transaction buttons reuse the outlined SVG family and retain
  their labels. Decorative icons are hidden from assistive technology.
- Desktop header and logo dividers align at 96px; phone headers use an 84px
  band. This removes the extra header space shown in the reported screenshot.

## Verification

`npm run lint`, `npm test` (395 tests), `npm run build`,
`node scripts/validate.mjs` and `git diff --check` pass.

The six added unit regressions cover label associations, search caret recovery,
focus moved to a filter, focus moved during an asynchronous render, filtered
leave empty states, and accessible names on direct row actions. Existing employee query/cache tests still pass.

Run `node tests/browser/ui-consistency-fixture.mjs` and open
`http://127.0.0.1:4194/`. It renders the real employee and leave renderers with
synthetic records and no database access. `?view=leaves` checks leave search.
The fixture asserts computed record sizes, bounded pagination, viewport bounds
and header alignment after fonts load. Its hidden `#fixture-checks` output
contains the result; failed checks also produce a console assertion.

Run `node tests/browser/modal-typography-fixture.mjs` and open
`http://127.0.0.1:4187/?view=Edit`. It loads the production font and stylesheet
links and asserts computed modal tokens, label associations, control heights and
viewport bounds. The Check required fields button exercises persistent errors.
Address controls remain synthetic and have unique IDs.

Browser checks passed for employee layouts at 320×568, 390×844, 768×1024,
844×390, 1024×768, 1280×720, 1440×900 and 1920×1080. Modal checks verified
14.3px desktop / 16px phone inputs, 44px control heights, 12.35px labels and
19.5px headings. Required-field summary links, error cleanup after input and
filtered leave recovery were exercised.

These checks cover representative responsive sizes, not every physical device.
Authenticated production saves, all role-specific workflows, backend performance
and every feature-specific modal were not exercised. No confidential records,
production mutations or SQL were used.
