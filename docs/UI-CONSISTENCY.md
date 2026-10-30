# UI consistency

## Compact enterprise desktop revision — 2026-10-30 (current)

This section supersedes the earlier 42px toolbar / 44px form specifications and
measurements below. The current request explicitly targets denser desktop use.
The working tree was clean on main. Baseline: 422 Node tests and 78 existing
browser checks passed before editing. All review data is synthetic.

### Findings and implementation

Browser baseline at 1440px: directory search/filter/action 42px high, search
480px wide, form inputs/selects/dates 44px high, ordinary employee rows 40px,
pagination 34px, header 96px. Employee date and rate fields measured about 467px
wide, the same as a name field. Source inspection found padding-driven button
height, Attendance's later 38–40px minimums, equal 176px desktop filters, duplicate
employee grid declarations and an Access toolbar that squeezed labels instead
of wrapping. Source findings were checked against representative fixtures.

The actual stylesheet order is app → professional → attendance → workspace.
app.css owns semantic sizing. Existing feature rules in professional.css consume
it, including picker/currency/catalog widgets and manpower editors. workspace.css
owns shared layout, responsive tokens and ordinary tables. Attendance geometry
remains owned by attendance.css and its existing workspace adaptation.

| Role | Desktop | Phone/coarse pointer |
| --- | --- | --- |
| Toolbar/search/filter | 36px; 13px text | 44px; 16px text |
| Form/select/date | 40px; 14px text | 48px; 16px text |
| Compact action/pagination | 34px; 12px text | 44px |
| Dense table editor | 36px | 44px |
| Table icon action | 28px | 44px |
| Form label / gap | 13px / 6px | Same label sizing |
| Field / section gap | 14px / 24px | Same grouping |
| Input padding / radius | 12px / 8px | Same |
| Textarea | Automatic height; ≥96px; vertical resizing | Same |

`--workspace-control-height` and `--form-control-height` also respect their text
line box through `max()` expressions. Default heights remain 36/40px; enlarged
control text can increase the box. `--workspace-search-width` is 320px with a
360px maximum; `--workspace-toolbar-padding` is 10px and panel padding is 20px.
Buttons use 12–14px horizontal padding and 16px outlined icons.

Employee forms use proportional six-track layouts on roomy desktops, two-track
normal fields, narrow date/status/identifier fields and full-row prose. Government
IDs use four tracks when space permits. At intermediate widths the existing two
columns remain, and phones use one. Generic short numeric/date/currency fields
have deliberate bounds while long names, organization choices and prose retain
space. Grid placement never reorders DOM or keyboard navigation.

The single-row employee toolbar and Filters disclosure at 721–1499px remain.
At ≥1500px filters have different minimum widths by purpose (department 150px,
branch 130px, status 112px, employment type 178px). Long selected text retains
the existing full-value note. Access toolbar items now wrap rather than squeeze
button labels. Search focus uses the existing visible wrapper ring.

Ordinary rows remain 40px with 13px data / 12px headers and 6px/12px cell padding;
multiline rows can grow. Table editors use 36px desktop controls, with short
quantities bounded. Intrinsic column sizing, full employee names, sticky headers,
internal horizontal scrolling and mobile request cards remain unchanged.

The shell header is 80px desktop with the logo divider aligned. Phones retain
the existing 84px band. Panel/toolbar/dialog padding and oversized hero spacing
were reduced without changing navigation. Sign-in retains its navy/gold theme;
the existing violet/charcoal operational theme and fonts are preserved. No new
palette, gradient, dependency or animation was introduced.

Source-derived contrast calculations identified the auth placeholder (~2.43:1 on white),
muted metadata (~4.3:1 on a pale surface), and validation red (~3.91:1 on error
pink). Darker neutral and red tokens now exceed 4.5:1 in the checked states.
Browser assertions check rendered labels, placeholders, field errors, summary
links and pagination labels using unrounded luminance ratios. This is scoped
verification, not an assertion of complete WCAG conformance. Reference:
[contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
and [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
Desktop 28px table actions exceed the 24px web minimum; touch targets are enlarged.
Native picker affordances and the specialized Attendance grid retain their
existing interaction alternatives and spacing. No focus or label was removed.

JavaScript changes are limited to missing label associations in the existing
Movement and Transfer dialogs, including IDs on previously unnamed disabled
display inputs. Field IDs/names, handlers, validation, persistence, authorization,
queries, calculations and task sequences are unchanged. No database migration.

### Files changed

- css/app.css: canonical semantic sizing, width and spacing defaults.
- css/professional.css: existing composite/feature control rules, employee spans,
  Access wrapping and contrast tokens; no new layer or important declarations.
- css/workspace.css: shared toolbar/table/dialog/shell proportions and touch rules.
- js/app.js: Movement/Transfer label associations only. index.html: asset cache
  versions, retaining the verified stylesheet order.
- tests/browser/regression-suite.mjs and the ui-consistency, modal-typography and
  workspace-redesign fixtures: updated dimension expectations and expanded
  source-renderer/state coverage. scripts/test-browser.mjs permits the manpower
  presentation modules required by those fixtures and reports seven widths.
- tests/core/browser-regression.test.mjs: contrast-ratio calibration regression.
- design-system/MASTER.md, README.md, ROADMAP.md, this file and
  docs/BROWSER-REGRESSIONS.md: current standards, measurements and limitations.

### Measured controls (1440px desktop)

| Control | Before | After |
| --- | ---: | ---: |
| Employee text/select/date input | 44px | 40px |
| Employee search/filter/add | 42px | 36px |
| Employee search width | 480px | 320px |
| Employee date field width | ≈467px | ≈147px |
| Employee rate field width | ≈467px | ≈225px |
| Employee name field width | ≈467px | ≈307px |
| Employee footer action | 42px | 40px |
| Sign-in input / submit / password action | 44px | 40px |
| Pagination / page-size selector | 34px | 34px |
| Ordinary employee row | 40px | 40px |
| Shell header | 96px | 80px |
| Textarea minimum | 96px | 96px |

### Final validation and limits

Final result: 423 Node tests and 175 browser checks passed. `npm run lint`,
`npm test`, `npm run build`, `node scripts/validate.mjs` and final diff checks
passed. Browser fixtures covered all seven requested document widths, actual
employee form/navigation/section-save markup, native control variants,
sign-in/registration, Attendance, requests/cards, shared table families, settings,
shared workflow/quality/analytics/access toolbar patterns and real manpower
renderers. Functional search/filter/pagination, validation, duplicate-ID messages,
failed-save retry, unsaved-edit guards and Attendance staging checks still pass.

Two additional cases verified doubled semantic control text at desktop/phone
widths. A 320×568 dialog retained 48px fields, 16px text and reachable footer
actions. The 960×540 case checks zoom-equivalent reflow; actual browser zoom
controls were not driven. Short numeric/date fields, native affordances and long
filter notes were reviewed. The 721–900px drawer header intentionally retains
its existing 94px band; desktop above 900px is 80px and phones are 84px.

The expanded suite exposed missing Movement/Transfer label associations (fixed),
Access toolbar wrapping (fixed), and test assumptions about hidden controls,
wrapper focus rings and scrollbar width (corrected without removing functional
checks). The fixture shell now uses production's `.on` class rather than forcing
an inline desktop grid, which had distorted a 960px layout. No application
breakpoint or navigation behavior was changed to accommodate the fixture.

Screenshots and computed measurements were captured before/after at 1440px,
with a separate 320×568 view. The full suite uses offline fallback fonts;
standalone screenshots load production font links. Source review covers shared
selectors across existing modules, but fixtures are not complete authenticated
screens. Real backend workflows, screen readers, physical coarse-pointer devices,
native browser zoom, hover rendering and every feature-specific dialog were not
exercised. Source hover/disabled/loading rules and coarse-pointer overrides were
inspected; no full WCAG certification is claimed. No production records used.

No database, authentication, permission, query or business-rule change. No new
dependency. Publication status and verified implementation references are recorded in ROADMAP.md.

---


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
