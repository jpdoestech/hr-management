# Genuine deployment ending foundation (MP-B12)

Proposal 0051 adds `end_manpower_deployments(token, items)` for individual and
all-or-nothing bulk endings. It closes existing primary deployment intervals;
it is not separation, reversal, replacement creation or an atomic transfer.

## Behavior

- Only an active confirmed deployment can end. Each selection supplies the saved
  reservation, confirmation audit ID, actual start, first unassigned date and
  mandatory reason. Changed confirmation/start facts are rejected as stale.
- The approved interval rule is `[actual_date, ended_date)`. The first unassigned
  day must follow the start and cannot be future. A same-day empty assignment is
  not a genuine ending; false deployments require controlled reversal instead.
- The same assignment becomes Ended. Original worker, request/line, actual date,
  confirmation evidence and historical fulfillment credit remain intact. Active
  deployed decreases; fulfilled and available quantities do not change.
- Closed/cancelled demand does not prevent ending a real deployment. No outstanding
  quantity is restored or replacement line created automatically.
- Employee/applicant data and employment status remain unchanged. No payroll,
  attendance, lifecycle or Auth account mutation is performed.
- Employee view, applicant view, manpower view/update and current request/both
  source scopes are checked at the trusted boundary. Legacy or on-call conflicts
  require reconciliation rather than silently changing a parallel ledger.
- Existing tenant source interlock, sorted request/identity/worker locks, interval
  exclusion and exact assignment intents protect the transaction. One material
  batch audit and immutable per-worker ending history record actor, business date,
  recording timestamp, confirmation and reason separately.
- Audit, history or later worker failure rolls back the entire batch. Private
  actor/tenant-scoped retry evidence accepts reordered identical selections,
  rejects altered facts and rechecks access without ending twice.
- Read-only history is RLS-protected by current source/request access. Browsers
  cannot read private batch payloads or modify ending evidence.

## Verification

Synthetic isolated and combined PostgreSQL rehearsals cover two real confirmed
deployments, individual date validation, stale start/confirmation, duplicate and
unavailable selections, role/scope/tenant/anonymous denial, ending after request
closure, audit and second-history-row rollback, original source preservation,
unchanged fulfillment/capacity, order-independent retries, revoked retry access,
scoped history and immutable evidence. Owner integrity queries return zero rows.
An explicit new-demand redeployment starts exactly on the prior first unassigned
day, then ends through the individual API without altering the earlier credit.
These separate transactions are not claimed as an atomic transfer.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending
```

Read-only checks: `supabase/verification/manpower_ending_integrity.sql`.
These synthetic checks are not live RBAC/RLS or independent-session concurrency
acceptance, and do not benchmark large ending batches.

Verified locally: lint, all 247 tests, production build, repository validation,
diff checks and isolated/combined PostgreSQL rehearsals passed. No browser UI or
production deployment was exercised by this backend-only slice.

## Release gates and remaining scope

Proposal 0051 requires the source interlock, confirmation/interval baseline and
existing accounting/intent guards. It stays outside automatic migrations; no
production database, configuration, source records or historical migration changed.

Still required: coordinated UI and retry/conflict handling, independent concurrency,
atomic credited/non-credited transfers, controlled reversals with downstream
dependency checks, on-call integration, legacy baseline reconciliation, reporting
and live authorization/acceptance. No deployment or full Stage B completion claim.
