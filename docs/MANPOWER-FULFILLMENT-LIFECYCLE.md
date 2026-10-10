# Manpower Lifecycle Foundation - MP-A11

Status: locally rehearsed proposal. Production deployment and mutation UI remain gated.

Application follow-up: [MP-A14 lifecycle UI](MANPOWER-FULFILLMENT-LIFECYCLE-TRANSACTIONS-UI.md)
connects the existing RPC with reasoned confirmation and retained context.
Production database release and live acceptance remain gated; the historical
rehearsal results below are not a claim that the proposal has been deployed.

## Controlled Operations

`supabase/proposals/0042_manpower_lifecycle.sql` follows verified proposals 0035-0041 and remains outside automatic migrations. It introduces `change_manpower_lifecycle(request, revision, operation, reason, line?, cancelledQuantity?)`:

| Operation | Prerequisite | Effect |
| --- | --- | --- |
| CancelLine | Open request; positive outstanding quantity; no reservations on the affected line | Increases cancelled outstanding demand on that line; request stays Open |
| Close | Open request; reservations on all lines released/reassigned | Cancels all remaining unfilled demand and marks request Closed |
| Cancel | Open request; reservations on all lines released/reassigned | Cancels all remaining unfilled demand and marks request Cancelled |
| Reopen | Closed/Cancelled request | Marks request Open without restoring cancelled demand |

All operations require a current revision, a reason of 1-1000 trimmed characters, authenticated same-tenant profile, existing manpower update/view permissions and request scope. Affected lines use authoritative capacity, including scheduled reservations and historical ended fulfillment. Draft requests must use existing draft operations.

Original requested and current authorized quantities, submissions, reservations and fulfillment records are never deleted or rewritten. Closure is administrative, not an attrition/replacement credit adjustment. A reopened request can obtain additional capacity only through separately authorized quantity changes; reopening itself has no capacity side effects.

## Persistence and Protection

The existing request advisory/row lock is shared with reservation, release and quantity amendments. Lines lock in stable order. Existing exact-row private transaction intents protect submitted changes. Line changes, header revision/state, critical audit and append-only lifecycle history commit atomically. The lifecycle history contains cancellation deltas and references the existing audit event, not a separate competing timeline.

The follow-on expands existing request state and submission-metadata constraints without changing historical rows. Exact expected constraint definitions are checked before replacement; unexpected schemas fail closed. No production backfill, source record merge, automatic applicant release, configuration change or UI enablement occurs.

## Local Validation

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle
```

The external PGlite validation dependency is not committed. Use an isolated dependency environment and adjust the URL as necessary. `--lifecycle` also runs the reservation and amendment prerequisites.

Synthetic rehearsal covers line cancellation, full request cancellation, multi-line closure, retained historical fulfillment, reopen without restored capacity, explicit new quantity authorization, invalid/stale requests, mandatory reasons, permission/scope/tenant/anonymous denials, protected append-only RLS history and direct-write guards. A reservation on the second line rolls back attempted first-line cancellation; an audit failure rolls back both lines, header and history.

`supabase/verification/manpower_lifecycle_integrity.sql` verifies audit/tenant/revision references, valid state transitions, state history continuity, cancellation chains, original quantities and absence of reservations under closed/cancelled requests. It returns no violations in the isolated rehearsal. Historical fulfillment fixtures remain owner-seeded accounting facts, not proof of a deployment API.

Project validation: lint, 241 tests, production build and whitespace checks passed. No UI files changed; no new browser validation is claimed.

## Remaining Work

Live schema/legacy reconciliation, independent concurrent PostgreSQL sessions and live authorization verification remain release gates. Coordinated submission/lifecycle UI, searchable reservation preview, identity corrections/conversion, actual deployment/ending/reversal, replacement/transfer intervals, on-call eligibility, reporting/exports and complete end-to-end acceptance are unfinished. Partially Filled/Filled remain derived progress, not duplicated administrative states. This proposal does not complete Stage A or the overall specification.
