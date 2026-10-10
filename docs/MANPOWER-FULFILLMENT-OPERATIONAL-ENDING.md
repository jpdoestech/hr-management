# Operational deployment ending (MP-B15)

Proposal 0054 adds `end_manpower_operational_deployments(token, items)` for genuine
completion of an active non-credited primary deployment. It depends on proposals
0052/0053 and stays outside automatic migrations. No existing form, production
data, frontend configuration or historical migration is changed.

## Behavior and access

Each selected item contains `deployment_id`, `source_fingerprint` from the current
`preview_manpower_transfer('operational', id)`, an ISO `ended_date` and a mandatory
reason. One item is an individual ending; multiple items commit atomically.

The end is the **first unassigned day**, strictly after actual start and not in the
future. Full shared historical interval validation remains in effect. Ending an
operational deployment preserves its original worker, origin, destination and
actual date. Employee/applicant master records and employment status/type remain
unchanged. Previous PRF fulfillment is retained; no demand is reopened or credited.
Incorrect deployments still require the separate controlled reversal workflow.

Current tenant, employee/manpower view, manpower update, employee scopes and
operational resource/destination scopes are checked at the trusted boundary.
Applicant view/update is not required for a non-credited operational ending: no
applicant information is returned or modified. Source identity and legacy/on-call
conflicts fail closed. Reauthorization also applies to exact retries.

The source interlock and sorted worker locks coordinate existing primary APIs.
Exact private intents reuse the operational change guard; date and shared interval
triggers remain authoritative. Fresh fingerprints prevent stale writes. An actor/
tenant token stores canonical sorted selection evidence and rejects altered facts.

An aggregated audit event links immutable scoped per-deployment ending history,
business date, reason, actor and recording timestamp. Browser roles cannot read
private retry payloads or write history. Audit/late history failures roll back
every row, batch, audit and interval change. Transfers keep their separate linked
history; this does not backfill or reinterpret historical operational endings.

## Validation

Synthetic PostgreSQL rehearsals cover individually and bulk-created operational
sources through the actual transfer RPC, individual/bulk ending, order-independent
replay, altered payloads, stale evidence, missing/duplicate selection, invalid/
future/empty interval dates, required reasons, tenant/role/scope/anonymous denial,
revoked retry permissions, private storage and immutable history. Injected audit
and late-second-row failures leave all selected sources active. Employee/applicant
records and original PRF fulfillment remain unchanged.

Verified locally: both rehearsal commands completed with exit code zero; all three
integrity queries returned zero rows. Lint, 247 automated tests, production build,
explicit repository validation and diff checks passed. UI/browser testing does not
apply to this backend-only proposal; live and independent concurrency checks remain
unverified.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending --shared-intervals --transfers --operational-ending
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending --shared-intervals --transfers --operational-ending
```

Read-only owner checks: `supabase/verification/manpower_operational_ending_integrity.sql`,
`manpower_primary_intervals.sql` and `manpower_transfer_integrity.sql`.

## Remaining gates

This backend prerequisite is not a released application workflow. Still required:
live baseline reconciliation and reviewed migration promotion, independent-session
concurrency/authorization/performance acceptance, coordinated UI/master integration,
replacement requirements, controlled reversal with downstream/transfer-descendant
blocking, on-call rules and unified timeline/analytics/exports. Stage B remains
incomplete. No production deployment or live acceptance is claimed.
