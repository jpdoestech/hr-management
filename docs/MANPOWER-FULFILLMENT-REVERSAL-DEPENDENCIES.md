# Reversal dependency review prerequisite (MP-B17)

Proposal 0056 adds the read-only `preview_manpower_reversal(kind, id)`. It does
**not** execute or authorize reversal: `reversal_enabled` is always false and
`requires_fresh_transaction_check` always true. A clear preview is not permission
to void a deployment. No application form, production data or applied migration
changes. The proposal stays outside automatic migrations.

## Verified repository mapping

- PRF reservation states already include `Reversed`; capacity counts only valid
  `Deployed`/`Ended` credits. Shared intervals exclude reversed credits. There is
  no public controlled reversal API yet.
- Operational rows support only Deployed/Ended and carry a linked origin. Their
  exact private guard permits genuine endings, not reversals. Coordinated origin/
  transfer correction must be designed before reversing these rows.
- Transfer history and operational origins link old/new primary assignments;
  replacement-source references link genuine outgoing deployments to new demand.
- `js/app.js` attendance records use `employeeId`, `workDate`, status and lost-time
  factors. They are not linked to typed deployment IDs. Migration 0031 validates
  attendance and provides tenant/employee/date indices.
- ATD records use employee identity, `atdDate` and nested payments with month,
  cutoff and `dateRecorded`. Those dates do not establish payroll coverage. The
  current repository has no authoritative payroll ledger to reconcile.
- Legacy manpower slots use employee/candidate/request IDs; legacy on-call also
  has free-text names. The existing source lock guards these and master records,
  **not attendance/ATD writes**. Preview cannot prove mutation concurrency safety.

## Detection and privacy

The trusted preview requires current primary-deployment access plus existing
`manpower.approve`. It returns the existing minimal source preview and diagnostic
categories, never employee private fields, attachment contents, dependency record
IDs, financial amounts, document titles or free-text notes.

| Code | Required follow-up |
| --- | --- |
| `transfer_chain` | Review the linked incoming/outgoing transfer transaction before coordinated correction. |
| `operational_descendants` | Resolve linked operational descendants; never orphan them. |
| `linked_operational_origin` | Current operational rows require coordinated origin/transfer reversal. |
| `replacement_references` | Resolve replacement outgoing references through an audited correction path. |
| `explicit_record_references` | Review exact source UUID occurrences in downstream record JSON, including nested links. |
| `attendance_interval` | Review attendance within the full half-open deployment interval or an unknown/invalid date. |
| `financial_review` | Authorized payroll/ATD review must determine actual coverage; payment recording date alone is insufficient. |
| `legacy_assignment_review` | Reconcile legacy slot/on-call worker/request/name references. |
| `restricted_dependency_review` | An authorized reviewer must inspect dependencies outside the caller's permissions/scopes. No category/count is disclosed. |

Each visible category supplies a count only when the caller can view **all** rows
in that category. Restricted categories collapse into one generic review marker.
Categories may overlap and must not be summed as a distinct-record total.

Attendance uses exact linked employee IDs (including recognized snake-case aliases)
or exact normalized legacy names only when no explicit ID is present. The first
unassigned day is excluded; malformed/missing dates require review. ATD/recognized
payroll JSON records conservatively require review regardless of recording date.
Payroll-shaped records require `payroll.view`, not a fallback employee grant.
Exact source UUID occurrences are conservative references, not proof of a valid
foreign-key relation; a reviewer must resolve their meaning. Tenant isolation is
applied to every lookup. Private scanners/helpers are not browser-executable.

## Validation and remaining work

Synthetic rehearsals cover attendance boundaries/invalid dates/legacy names,
financial/nested references, transfer/origin/replacement/legacy blockers, source
authorization, private helper denial, redacted module/scope diagnostics and no
mutation of source facts. Production permissions/RLS are not replaced; synthetic
test adapters model the relevant permission/scope contract only.

Verified locally: isolated and combined rehearsals exited zero, including nested
payroll redaction and exclusion of another tenant's dependency records. Lint, 247
automated tests, build, explicit repository validation and diff checks passed.
This backend-only proposal does not change rendered UI. No live policies, external
payroll coverage or independent-session concurrency acceptance is claimed.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending --shared-intervals --transfers --operational-ending --replacement-sources --reversal-preview
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending --shared-intervals --transfers --operational-ending --replacement-sources --reversal-preview
```

Before a mutation: coordinate concurrent attendance/financial/reference writes,
recheck dependencies under locks, require fresh source evidence/mandatory reason/
current approve+update authorization, retain immutable reversal audit/evidence and
original actual dates, void credit exactly once and reconcile capacity atomically.
Block unresolved descendants/replacements/financial use; never rewrite payroll.
Independent-session race/deadlock tests and actual deployed-schema dependency audit
are mandatory before promotion. External payroll or unrecognized typed tables are
not proven covered by this scanner. UI, correction workflows, exports/analytics and
live acceptance remain required. Full controlled reversal and Stage B are incomplete.
