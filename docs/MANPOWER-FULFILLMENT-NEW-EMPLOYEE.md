# Atomic new-hire employee foundation (MP-B11)

Proposal 0050 adds `create_manpower_employee(token, candidate,
candidate_fingerprint, details, reason)`. It builds a genuinely new employee in
the existing employee master and reuses proposal 0048's controlled handoff in one
transaction. This is a backend proposal, not a released conversion UI.

## Supported workflow

- One unresolved **New Hire** reservation, with no earlier assignment history.
  Existing employee/rehire links require the separate existing-master handoff.
- Current scoped applicant preview, HR identity-review permission, applicant
  update/view, employee create/view and manpower view. New employee and request
  scopes are checked even though the RPC runs with trusted database privileges.
- Existing readiness checks remain mandatory: Ready to Hire, Hire recommendation,
  checklist completion, valid start/birth dates and recorded gender. Split last
  and first names must be present; no automatic parsing of an ambiguous full name.
- Active matching department/position, configured reporting branch and a canonical
  contract type. Rate and configured allowance amounts are optional/non-negative,
  bounded and limited to two decimal places. Government IDs stay optional, with
  digit-length validation and canonical formatting. Both addresses use proposal
  0049's authoritative backend validator.
- Employee IDs and numbers are database-generated. Number allocation follows the
  existing **global** six-digit employee-number uniqueness rule from migration
  0030, not the caller's visible employee list. Exhaustion fails without changes.
  No client-supplied employee number, identity or audit metadata is accepted.
- The current conversion's Active/Normal master fields and contract choice are
  retained. Date Hired and Status Effective Date remain independent; statusDate
  is blank. No Auth account, payroll, attendance or actual deployment is created.
- Applicant attachments/source fields remain untouched except the controlled
  hiring/link/updater transition. Duplicate-name matches need current scoped HR
  SeparatePersons evidence; unknown matches roll back the new employee too.
- The original reservation remains Reserved/Scheduled with the same capacity.
  Explicit later actual confirmation is still required for fulfillment.
- Creator/updater metadata, employee history, handoff audit and creation audit
  are recorded. Audit or final evidence-write failure rolls back **all** changes.
  Private immutable actor/tenant-scoped retry evidence prevents duplicate creation
  and rejects changed payloads. Retries recheck current permissions and scopes.

## Validation

Synthetic isolated and combined PostgreSQL rehearsals exercise creation, strict
details/catalog/contract/rate/allowance/address/government-ID checks, missing
readiness, invalid dates, stale fingerprint, duplicate-name rollback, global
number allocation/exhaustion, role/scope/tenant/anonymous denial, audit and final
row rollback, unchanged attachments, metadata, reserved-not-fulfilled accounting,
private storage, immutable evidence and idempotent/changed-payload retries.

Verified locally: lint, all 247 tests, production build, repository validation,
diff checks and isolated/combined PostgreSQL rehearsals passed. No production
database, browser UI or live deployment was exercised by this backend-only slice.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --handoff --addresses --new-employee
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee
```

Read-only owner checks: `supabase/verification/manpower_new_employee_integrity.sql`.
The synthetic harness provides a unique employee-number index matching the
production migration's existing rule; it does not replay migration 0030 against
production or verify actual tenant RBAC/RLS.

## Release gates

Requires the verified canonical-number baseline, source interlock, handoff and
reviewed address-reference setup. Proposal 0050 remains outside automatic
migrations. No historical migration, production data or configuration changed.

Independent-session concurrency, generic import/direct-create collisions, lock
order/deadlock and retry handling must be verified before release. The allocation
lock coordinates this API; existing writers may not share it, so the unique index
is the final protection and a collision rolls back rather than overwrites.

Still required: coordinated conversion UI and error/retry UX, rehire/lifecycle,
historical/alias reconciliation, transfers/ending/reversal, on-call integration,
live baseline/authorization and full acceptance. Stage B is not complete.
