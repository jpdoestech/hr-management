# Controlled PRF-credit reversal backend (MP-B18)

Proposal 0057 adds `reverse_manpower_deployment(token, kind, id, fingerprint,
reason)` for incorrect PRF-backed actual deployments. It extends the read-only
dependency prerequisite without modifying prior proposals/applied migrations.
It remains outside automatic migrations; no current application form uses it.

## Transaction and accounting

- Current tenant, primary-source view/scopes, `manpower.update` and
  `manpower.approve` are mandatory, including retries. The token, saved canonical
  source fingerprint and reason are validated at the trusted boundary.
- Source, request and worker locks coordinate the existing assignment workflow.
  Dependencies are rechecked **inside the transaction**, never accepted from the
  browser's prior preview. Blocked operations return redacted diagnostic categories
  with `reversed:false`; they create no audit/batch/history or credit mutation.
- Only `Deployed`/`Ended` reservation credits can transition to `Reversed`.
  Original worker, line, actual/end dates, confirmation evidence and all prior
  history remain unchanged. This is a voided incorrect credit, not a genuine
  departure and not an employee separation.
- One negative `credit_delta=-1` history event and material actor audit commit with
  the controlled state transition. Capacity excludes that credit exactly once;
  shared effective intervals remove it while original confirmation/ending facts
  remain available. Audit or late history failure rolls everything back.
- Closed/cancelled PRFs are not reopened; cancelled quantities are not reinstated.
  Any later reservation still requires an authorized open line. Employee/applicant
  master data, compensation, employment state and attendance/payroll are untouched.
- Immutable actor/tenant retry evidence rejects changed facts. Exact retries
  reauthorize current access and do not issue another negative credit or audit.

Proposal 0057 wraps the prior preview: `reversal_enabled` indicates current backend
eligibility only for an accessible, dependency-clear PRF credit and an authorized
updater. `requires_fresh_transaction_check` remains true. Linked transfers,
operational origins/descendants and replacement references remain blockers until
their coordinated audited correction workflows exist. Operational reversal is not
silently approximated as ending; its blocked result does not change data.

## Downstream write interlock

An additive BEFORE-row guard makes **all `hr_records` writes** take the same
tenant source-snapshot advisory lock. UPDATE locks old/new tenants in sorted order.
This covers indirect attendance/ATD and nested record references, including module
changes/deletes, without taking a whole-table lock that would invert existing RPC
lock order. Other application RLS/validation/audit guards remain intact.

The guard rejects newly added exact UUID-value references to reversed reservations,
including nested/uppercase values. UUID strings are extracted once by the helper's
set query and matched as UUIDs rather than scanning each payload for every historical
reversal. Existing reference values are not erased or rewritten. Preview also checks
case-normalized/master references omitted by the older exact-value scanner.

Standalone employee attendance without a typed voided deployment link remains
permitted: employment without a primary deployment is valid. If written before a
reversal, interval attendance blocks it; subsequent employee-only records do not
retroactively restore a voided credit. External payroll or independent typed tables
are not proven protected by this `hr_records` interlock and require live-schema
review before promotion.

**Performance/concurrency gate:** the tenant-exclusive write lock serializes HR
record writes against primary transactions. Single-connection rehearsal does not
prove race ordering, deadlock handling, throughput or multi-tenant bulk writer behavior.
Independent-session contention/race/retry tests and representative performance
measurements are required before production. No throughput improvement is claimed.

## Validation

Synthetic PostgreSQL rehearsals cover active and ended corrections, negative credit/
capacity exactly once, original facts/master preservation, stale evidence/reasons,
current/revoked authorization, tenant/scopes, existing and newly inserted dependency
blocking, hidden dependency redaction, linked transfer/operational/replacement blocks,
audit/late-history rollback, replay and altered-token facts, private/immutable RLS
history, uppercase/new voided-reference rejection and valid unassigned employment.
The combined lifecycle rehearsal checks that reversal never reopens a closed PRF.

Verified locally: isolated and combined rehearsal commands exited zero. Reversal,
confirmation, genuine-ending and shared-interval integrity queries returned zero
rows. Lint, 247 automated tests, production build, explicit repository validation
and diff checks passed. This backend-only proposal changes no rendered UI and
does not establish independent-session race safety or production performance.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending --shared-intervals --transfers --operational-ending --replacement-sources --reversal-preview --credit-reversal
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending --shared-intervals --transfers --operational-ending --replacement-sources --reversal-preview --credit-reversal
```

Owner integrity queries: `supabase/verification/manpower_reversal_integrity.sql`,
`manpower_primary_intervals.sql`, `manpower_confirmation_integrity.sql` and
`manpower_ending_integrity.sql`.

Still required: independent-session race/performance/live RLS acceptance, audited
replacement-reference correction and linked operational/transfer reversal handling,
actual deployed-schema/external-payroll dependency reconciliation, UI/confirmation/
retry handling and timeline/analytics/export integration. Full Stage B remains
incomplete; no production migration or release is claimed.
