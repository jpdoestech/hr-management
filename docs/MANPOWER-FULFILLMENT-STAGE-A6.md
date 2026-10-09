# Manpower Fulfillment: Stage A6 Compact Requisition Editor

Date: 2026-10-09. Latest `origin/main` inspected at `38f2999`, matching local HEAD. Uses the project's ui-ux-pro-max guidance for progressive disclosure, accessible labels, focus continuity and responsive touch controls. Existing fonts, tokens and form/button styles are retained.

## Delivered

- Aligned desktop inline rows for department, position, headcount, demand type and actions. Optional date, site and purpose fields expand under Details rather than making every line a large form.
- Tablet/mobile responsive fieldsets with visible field labels, wrapping actions and expandable optional details. Mobile inputs use 16px text; tablet/mobile inputs and line buttons use 44px height. Container-aware fallback also accounts for restricted content width beside the sidebar.
- Unique labels and line-specific action names, keyboard-operable Details buttons, synchronized `aria-expanded`/`aria-controls`, and visible focus indicators. Form rows remain semantic fieldsets, not an interactive grid requiring custom keyboard navigation.
- Department changes update only their dependent position options and clear the incompatible selection. They no longer repaint every line or move focus away from the department control.
- Add/duplicate focuses the new line; removal focuses the next/previous line or Add Line when empty. Expanded details are preserved by stable line ID across structural changes.
- Collapsed fields remain in the same DOM and validation/save payload. Duplication and spreadsheet paste retain optional details; no separate desktop/mobile copies or duplicate inputs are introduced.

## Compatibility

No SQL, Supabase configuration, source records, attachments, permissions, or backend transactions changed. Submission and controlled amendments remain gated. Existing draft saves, paste confirmation/validation, view-only restrictions and unsaved line-identity tracking are retained.

This slice changes draft entry only. It does not claim the submitted-request/history workspace, row-level validation display, amendments or fulfillment capacity workflows are complete. Existing server-side validation still rejects invalid draft values.

## Actual Validation

- `npm run lint`: passed.
- `npm test`: 224 passed, zero failures. Added regressions for unique accessible row controls, dependent catalog options, no-repaint department updates, synchronized disclosure state and preservation of collapsed field values.
- `npm run build`: passed.
- Browser fixture uses the actual editor, app handlers, shared paste confirmation and project CSS, without contacting Supabase. Verified department changes retain focus and other rows; duplication preserves optional details; expanded surviving lines remain expanded after removing an earlier line; empty-state removal focuses Add Line.
- Clipboard preview plus shared Add Rows confirmation appended one distinct-ID 1000-headcount line with its hidden purpose intact, retaining the original line.
- Responsive browser checks at 1280x800, 768x1024, 390x844 and 844x390: no document/main horizontal overflow. Tablet line buttons measured 44px; mobile inputs measured 16px text. Keyboard Enter expanded optional details. Desktop screenshot inspected.
- No authenticated production save, live database or screen-reader session was performed. The reusable fixture is `tests/browser/manpower-paste-fixture.mjs`; it is local-only and its save button performs no database write.

## Remaining

Stage A: submitted-request/history UI, controlled quantity amendments and cancellation/reopening/capacity safeguards, followed by verified coordinated backend/UI release. Stages B/C reservations, deployments, identity/on-call workflows, monitoring and scoped exports remain outstanding.

## Commit Remarks

Compact quantity-draft entry into aligned desktop rows and responsive expandable details. Preserve hidden data, paste, read-only behavior and unsaved changes; avoid full-line repaint on department changes and maintain focus/expanded state through add, duplicate and remove actions.
