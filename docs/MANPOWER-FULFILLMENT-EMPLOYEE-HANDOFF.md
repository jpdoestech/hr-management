# Existing employee handoff foundation (MP-B09)

Proposal 0048 adds `handoff_manpower_employee(token, candidate, employee,
candidate_fingerprint, employee_fingerprint, reason, expected_review_revision)` for an applicant with one
unconfirmed reservation and an **existing employee master**. This is not atomic
new-employee creation, a rehire activation, or a complete conversion UI.

## Behavior

- Scoped HR identity-review permission, onboarding update, manpower view and
  both source-view permissions are required. Current source fingerprints, the
  saved identity-review revision and
  an explicit identity rationale prevent silent linking or stale review.
- Existing hiring readiness is enforced: Ready to Hire, Hire recommendation,
  privacy/interview/offer/contract/standards checklist, start date, birth date
  and gender. Dates must be valid and birth must not be future or after start.
- The same reservation is retained. Its unresolved worker key can become the
  selected employee key; an already resolved reservation can only retain that
  same employee. Competing assignments, different identity pointers, legacy
  dependencies and earlier assignment history require reconciliation first.
- The applicant becomes Hired and receives its employee link, hired timestamp
  and updater metadata. Source identifiers, names, attachments and other fields
  are preserved. Physical `updated_at`/`updated_by` are updated too.
- The existing employee is not changed or duplicated. Original applicant links,
  employment history, status, contract, salary and addresses remain untouched.
- A SamePerson review and current pointer are recorded with fresh fingerprints.
  Current scoped SeparatePersons evidence for additional potential matches is
  carried forward into append-only revisions; unknown/stale matches block handoff.
- Private exact source/assignment intents permit this transition without allowing
  ordinary clients to change protected links. Intents are removed before commit.
- Source interlock, request/identity/worker locks, critical audit, immutable retry
  evidence and actor/tenant-scoped tokens protect the transaction. Identical retries
  reauthorize source and request access without changing history or capacity.

Handoff leaves capacity **Reserved**, not Fulfilled. Actual reporting still needs
the separate explicit confirmation transaction. No employee activation, payroll,
attendance or deployment date is inferred from this identity handoff.

## Validation results

Isolated and combined synthetic PostgreSQL rehearsals passed. They cover scoped
permission/tenant/anonymous denial, stale previews, missing reasons, readiness and
date errors, unknown duplicate names, preserved separate-person evidence, unchanged
employee/prior source reference, stable reservation and capacity, idempotent retry,
private storage denial and audit/final-row rollback. Explicit subsequent actual
confirmation succeeds and consumes the reserved capacity exactly once.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --handoff
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff
```

Lint, 245 tests, build and repository validation passed. Read-only checks:
`supabase/verification/manpower_handoff_integrity.sql`. Fixtures include persisted
updater columns; they do not represent production employee records or live RLS.

## Release gates and remaining scope

No production data or configuration changed; the proposal remains outside
automatic migrations. Verify the live baseline, source triggers and private schema,
physical updater columns, independent concurrency and retry UX before promotion.

Still required: atomic creation of a genuinely new employee with canonical number
allocation and full input/address validation, rehire/lifecycle coordination,
historical identity and candidate-alias corrections, UI integration, transfers,
ending/reversal, on-call rules and live acceptance. Stage B remains incomplete.
