# UI consistency — 2026-10-29

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
