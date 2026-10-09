# Stage A9: Read-Only Amendment History

Status: locally validated. Production schema/integration and amendment entry remain gated.

## Changes

- Submitted request sections now distinguish Requisition Lines, Submission History (the immutable initial facts) and Amendments (subsequent audited quantity increases).
- Amendment queries run only when selected, filter through the request-linked requisition relation, select explicit fields and use database counts/ranges with the existing 10/25/50 pagination. Page and size are stored separately per request and section.
- Each amendment shows its line, previous/revised quantities, revision and escaped reason in a keyboard-accessible disclosure. Existing shared styles, focusable table scrolling and navigation are preserved; no new visual theme or CSS is introduced.
- Missing amendment storage produces an accessible unavailable message with Retry. Request metadata, Back and other sections remain usable. A failed read never masquerades as an empty audit history.

## Files

`js/manpower/submitted-workspace.js`, `js/app.js`, `index.html`, the submitted workspace unit tests and synthetic browser fixture, Stage A8/A9 reports and `ROADMAP.md`.

## Validation

- `npm run lint`: passed.
- `npm test`: 237 passed, including bounded amendment queries, escaping/disclosure semantics, missing-storage messaging and existing permission/session/stale-response coverage.
- `npm run build`, `node scripts/validate.mjs` and `git diff --check`: passed.
- Synthetic browser fixture: desktop 1280x800, tablet 768x1024, mobile 390x844; document width equals viewport at all three sizes. Tables retain their own overflow. Keyboard Enter opens a long reason without page overflow.
- Pagination: selecting 25 yields 25 rows; Next yields six of 31; switching to Lines and back preserves page 2 and size 25. Missing-schema mode shows the error; switching back loads ten lines successfully.

No real employee data, Supabase credentials or production calls were used. The UI/UX Pro Max skill was consulted for consistency, keyboard access, progressive disclosure and responsive containment. There is no project `design-system/` directory, so existing shared components/styles remain authoritative.

## Release Boundaries

No schema, RLS/RBAC, attachment or configuration changes. Proposal 0037 must be verified and deployed before amendments can be read; earlier environments receive the explicit fallback. Submission/amendment mutation buttons remain disabled/not exposed. Decreases, lifecycle operations, Stage B and Stage C remain outstanding as listed in the roadmap.

Commit remarks: connect audited quantity amendments to a bounded, responsive, read-only request section while preserving initial submission history and safe missing-schema behavior.
