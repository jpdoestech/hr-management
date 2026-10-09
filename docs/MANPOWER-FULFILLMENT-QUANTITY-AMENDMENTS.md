# Manpower Quantity Amendments - MP-A10

Status: locally rehearsed database proposal; production deployment and mutation UI remain gated.

## Scope

- `supabase/proposals/0041_manpower_quantity_amendments.sql` follows verified proposals 0035-0040. It is deliberately outside automatic migrations.
- `amend_manpower_quantity` supports reasoned positive quantity increases/decreases for Open submitted requests. The existing `increase_manpower_quantity` stays strictly increase-only, checked under the same locks.
- Each amendment checks the saved request revision and authoritative line capacity. New authorization minus cancelled demand must cover reserved (including scheduled) plus valid historical fulfilled credit (including ended deployments).
- Release/reassignment is required before reducing below commitments. Original requested quantity and cancelled demand do not change. Critical audit, append-only amendment fact, line quantity and request revision commit or roll back together.
- A private shared implementation is unavailable to authenticated/anonymous clients. Existing tenant, permission and request-scope enforcement stays in place; submitted-row guards still require exact private transaction intents.
- The historical increase-only amendment constraint becomes positive-and-changed. The draft-era zero-only cancellation constraint becomes nonnegative and bounded by authorization. This prepares accounting only: no cancellation RPC, cancellation UI or implicit restoration of demand is added.
- Expected constraint definitions are checked before replacement. Unexpected live schemas fail closed and require reconciliation. No original source data, prior facts, attachments, credentials or applied migration files are rewritten.

## Validation

Isolated PostgreSQL-compatible rehearsal with synthetic records:

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --amendments
```

The dependency is external to the repository. Alternatively install PGlite in an isolated validation environment and set the module URL accordingly.

Verified cases: 75 commitments block a reduction to 74; 75 is accepted with zero availability; releasing one allows 74. Increase-only compatibility, generic increases, stale revisions, invalid reasons/quantities, wrong request-line identity, permission/scope/tenant/anonymous denials, private-helper denial, direct submitted-row changes, immutable original quantity and history, and audit-failure rollback are exercised.

Owner-seeded synthetic accounting facts additionally verify that scheduled assignments remain reserved, ended deployments retain fulfillment credit, and cancelled demand raises the minimum allowed authorization. These fixtures are NOT evidence of working scheduling, deployment, ending or cancellation APIs. Existing read-only amendment-chain integrity queries return no violations.

Project checks: lint, 241 automated tests, production build and diff whitespace validation passed. No UI files changed, so this slice does not claim new browser validation.

## Remaining Gates

Verify the live migration baseline, legacy references, existing constraints and role grants before promoting this proposal. Capacity accounting rejects unreconciled legacy assignments instead of assuming zero commitments. Reservation, release, quantity changes and future lifecycle writers must retain the shared request lock order.

Independent concurrent transactions, live RLS/RBAC, legacy reconciliation, full identity integration and mutation UI/end-to-end acceptance remain outstanding. Cancellation, close/reopen and other Stage A/B/C requirements remain unfinished. This slice is not a complete fulfillment release.
