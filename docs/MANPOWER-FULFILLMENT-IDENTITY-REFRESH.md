# Dependency-Aware Identity Refresh - MP-B04

Status: locally rehearsed proposal; no production deployment, source merge or mutation UI.

## Problem and Change

Proposal 0039 intentionally blocked all identity re-reviews once reservation storage existed. Proposal 0040 permits ordinary applicant/employee metadata updates while preserving identity fields, making whole-source review fingerprints stale. Together these prevented authorized HR from refreshing otherwise unchanged identity evidence.

`supabase/proposals/0043_manpower_identity_refresh.sql` replaces only the versioned review RPC, retaining the existing narrow review permission, both-source scopes, fingerprint/revision checks, identity advisory lock, source row locks, conversion-link checks, mandatory reasons, audit and append-only supersession history.

- Unassigned candidate pairs can be re-reviewed despite the reservation table's existence.
- An assigned candidate can refresh SamePerson evidence only when its previous decision and current link identify the same employee, and every reservation history row already uses that employee's canonical worker key.
- Initial linking, SeparatePersons changes, alternative employee linking or re-keying beneath candidate assignment history remain blocked for a future explicitly reconciled correction workflow.
- Opaque legacy assignment references and unknown future deployment storage remain fail-closed. Later deployment integration must explicitly revisit that gate.
- No reservation, employee, applicant, attachment, original ID or capacity fact is changed. Historical reviews stay immutable; a new review supersedes the old audit reference and updates only the current pointer revision.

The proposal is outside automatic migrations and requires verified reservation storage/source guards. Existing six-argument callers still use expected revision zero and cannot silently overwrite an existing review.

## Validation

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --identity-refresh
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh
```

PGlite is installed in an external isolated validation environment, not added as an application dependency. Tests use synthetic sources only.

Covered: stale metadata evidence on an assigned resolved identity, unchanged worker keys/capacity, supersession history, stale preview/revision rejection, unresolved assignment identity-change denial, independent unassigned reviews, reviewer/scope/tenant/anonymous denials, audit rollback preserving the current link, and legacy/unknown-ledger blocking. The combined rehearsal also covers quantity/lifecycle foundations and released historical references.

Lint, 245 tests, production build and diff checks passed. No UI changes; no browser-validation claim for this backend slice.

## Remaining Work

This is evidence refresh, not a full identity correction or alias-merging workflow. Candidate-to-candidate aliases, reconciled changes beneath assignments, employee conversion, scheduling/actual deployments, UI, independent concurrency, live schema/RLS verification and complete specification acceptance remain outstanding. No production enablement is implied.
