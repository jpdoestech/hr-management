# Lifecycle History UI - MP-A12

Status: locally validated read-only slice. Overall fulfillment release remains incomplete.

Later mutation controls are documented separately in
[MP-A14 lifecycle transactions UI](MANPOWER-FULFILLMENT-LIFECYCLE-TRANSACTIONS-UI.md).
The results below describe the earlier read-only history slice, not the current
mutation workflow or a production release.

## Changes

- Submitted request browsing now includes Open, Closed and Cancelled records, with an optional database-filtered state selector. Drafts remain excluded and retain their separate editor.
- Closed/cancelled details use the existing read-only request workspace. No mutation buttons, client-side database writes or migration/configuration changes are introduced.
- Lifecycle History adds independently paginated revision, operation, previous/current state and reason records from proposal 0042. Queries are request-filtered, explicitly projected and limited to 10/25/50 records.
- Bulk line-change JSON and audit payloads are not downloaded with the history table. Detailed historical cancellation deltas and a unified cross-transaction timeline remain future work.
- Reasons use escaped native details/summary disclosure with keyboard access. Existing typography, spacing, sticky table headers, internal horizontal scrolling and responsive navigation are reused.
- Missing lifecycle storage produces an explicit error and retry, not an empty-history claim; sibling tabs and the Back action remain available.
- Existing response/session/permission guards and per-tab page state remain intact. Application/module cache versions were updated.

## Validation

UI/UX Pro Max was used for the targeted responsive-table concern; verified guidance recommends a contained horizontal-scroll wrapper rather than page overflow. Existing design conventions were retained.

- `npm run lint`: passed.
- `npm test`: 245 passed, including state filtering, lifecycle query projection/pagination, escaped disclosure, missing storage and unchanged read-only boundaries.
- `npm run build` and `git diff --check`: passed.
- Synthetic browser fixture at 1280x800, 768x1024 and 390x844: document width matches viewport width; no page-level horizontal overflow.
- Closed request opened successfully. Lifecycle size 25 and Next showed records 26-31 of 31; switching to Lines and back retained that page.
- Enter expanded a reason disclosure. Mobile/tablet screenshots confirmed wrapped reason text inside the scrollable table.
- Cancelled state filter returned one matching synthetic request. Missing lifecycle storage showed the error; returning to Requisition Lines still worked.

Fixture contains only synthetic records and no real database credentials. Browser viewport was reset and the fixture server stopped after validation. Browser checks do not establish live Supabase deployment or production authorization.

## Release Gates

Lifecycle reads require verified proposal 0042 storage. Existing databases without that storage retain the explicit fallback; submitted lists continue to work against the earlier Open-only schema. No automatic proposal promotion occurs.

Coordinated mutation UI, identity/reservation/conversion/deployment integration, unified timeline/reporting, legacy reconciliation, independent concurrent transactions and live RLS/RBAC/end-to-end acceptance remain unfinished.
