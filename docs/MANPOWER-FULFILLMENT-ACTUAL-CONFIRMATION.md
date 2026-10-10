# Actual deployment confirmation foundation (MP-B07)

## Implemented boundary

Proposal 0046 follows the scheduling and half-open interval foundations. It adds
one `confirm_manpower_deployments(token, items)` RPC for single-worker and
all-or-nothing bulk confirmation of **already resolved employee identities**.

Each item contains `reservation_id`, the saved `schedule_revision`, `actual_date`
and a reason (1-1000 characters). A common date can be repeated across selections;
individual overrides are supported. Actual dates cannot be future dates. Reasons
are retained even for same-day confirmation, not only retroactive entries.

- The existing Reserved/Scheduled row becomes Deployed. No second assignment or
  capacity unit is created; reserved decreases while fulfilled increases once.
- Original planning date/revision stay intact. Actual business date and system
  confirmation timestamp are separate facts.
- Current reviewed identity fingerprints and newly introduced potential employee
  duplicates are checked again. Unresolved conversion and stale evidence fail
  closed; the RPC cannot create, merge or change an employee master.
- Existing `onboarding.view/update`, `manpower.view/update`, `employees.view`,
  tenant and both source scopes are enforced. No role grants or RLS bypasses are
  introduced. Confirmation history is scoped/read-only; retry batches are private.
- Request, identity and worker locks follow the established ordering. The interval
  constraint checks full historical overlaps. Scheduled revision checks prevent
  confirmation of an obsolete plan.
- Actor/tenant-scoped tokens canonicalize item ordering and reasons. Identical
  retries reauthorize access without changing historical facts. Different facts
  with the same token, or a new token for an already confirmed row, are rejected.
- One critical batch audit, immutable per-worker history and the assignment
  changes commit together. A failed late row rolls the entire batch back.

Employment status/type and attendance/payroll are **not** inferred or changed.
HR records an explicit actual reporting event; backdated confirmation is not a
statement about the employee's current employment status.

## Validation results

Isolated and combined synthetic PGlite PostgreSQL rehearsals passed:

- Individual confirmation and bulk date overrides; plan date retained.
- 75 actual confirmations against quantity 1000: exactly 75 assignment rows,
  reserved 0, fulfilled 75, available 925. Retrying does not add credit.
- Invalid/duplicate selections, future dates, missing reasons, stale schedules,
  unresolved conversion, stale identity and new duplicates are rejected.
- Historical overlap through the public confirmation API is rejected; adjoining
  intervals work. Owner-seeded old history is not claimed as a confirmation API result.
- A failure on the final history row of a 75-worker batch rolls back all changes,
  history and audit. Critical audit failure also rolls back.
- Permission/scope/tenant/anonymous denial, history RLS, immutable evidence,
  private intents cleanup and unchanged employee records pass.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --confirmation
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation
```

Lint, 245 unit tests, production build and repository validation passed.
`supabase/verification/manpower_confirmation_integrity.sql` checks facts created
by this API only; it does not certify pre-existing actual deployments.

## Migration and unfinished requirements

No production database was accessed or changed. Proposal 0046 remains outside
automatic migrations, with 0035-0045 and live baseline checks required first.
Referenced legacy slot or on-call records block confirmation pending reconciliation;
free-text on-call names are matched conservatively. This is not the final on-call
timing model. Independent concurrency must include new identity/legacy/on-call
source writers, not just transactions using the typed ledger locks. No production
concurrency or performance claim is made from the single-session rehearsal.

Still required: controlled new-hire/rehire conversion handoff, candidate-alias
review, transfers/ending/replacements/reversal dependencies, on-call eligibility
and timing integration, coordinated transaction UI, live RLS/RBAC and independent
concurrency acceptance. Stage B and the specification remain incomplete.
