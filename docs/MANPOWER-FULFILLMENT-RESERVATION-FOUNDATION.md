# Stage B3: Atomic Reservation And Capacity Foundation

Date: 2026-10-10. Status: locally rehearsed proposal; NOT production enabled or a completed Stage B workflow.

## Implemented

Proposal 0040 adds database-authoritative applicant reservations, supporting individual and multi-line bulk selections through one RPC. Existing applicants remain the source; no employee/slot placeholders are created for requested quantities. A 1000-headcount request with 75 selected applicants stores 75 assignments, not 1000 empty rows.

- Existing Onboarding view/update and Manpower view permissions, tenant and applicant/request scopes are checked inside the transaction.
- Header, applicant-identity and resolved-worker locks are ordered consistently. Unique indexes prevent multiple effective reservations for one applicant or resolved worker.
- Entire batches roll back if a row is ineligible, outside scope, duplicates another selection/worker, needs identity review, references unreconciled legacy assignments or exceeds capacity. No valid subset is committed.
- Actor/tenant/token/payload retry evidence is immutable. Reordered identical selections replay their original reservation IDs; different selections cannot reuse the token. Replay rechecks current access and does not recreate released reservations.
- Name normalization mirrors existing sorted-token, case/accent/punctuation handling. PostgreSQL's `fuzzystrmatch` supplies the proven Levenshtein implementation; similarity thresholds match the existing employee duplicate warning. Matches require current, explicit HR identity decisions. Names never create links automatically. Existing reviewed employee links are followed even when names differ.
- Hiring category is stored separately from demand type. Rehire/transfer without a reviewed employee identity is rejected; a Hired applicant without resolved employee identity cannot be treated as a new unlinked person.
- Capacity derives Reserved/Scheduled/Fulfilled/ActiveDeployed from assignment states and uses the specification's single Available formula. Scheduled remains reserved; Ended retains historical credit; Reversed does not. No scheduling, confirmation, ending or reversal API is enabled by this proposal. Legacy references or overcommitted counts produce reconciliation errors rather than fabricated zero/clamped capacity.
- Explicit release requires a reason and scoped access, writes critical audit and retained history atomically, and restores capacity. Same-reason retries do not create a second release event. Private exact-row intents authorize the update; callers cannot bypass it with a session flag. Assignments and batch evidence cannot be directly mutated/deleted.
- Existing generic source writers cannot delete effective assignment sources, silently alter identity/conversion links or withdraw/reject a reserved applicant before release. Legacy slots cannot write quantity-request assignments.

## Compatibility And Release Risks

No automatic migrations, legacy backfill, configuration changes or frontend enablement. The proposal requires verified 0035-0039 foundations. Verify the live `fuzzystrmatch` namespace before promotion; an existing installation outside `extensions` is rejected rather than moved silently. Name keys outside the library's supported 1-255 character range require reconciliation; they are never truncated.

Existing legacy slots referencing request/applicant/employee IDs must be reconciled before new reservation use. Stage B2 conservatively blocks re-review when a reservation ledger exists; dependency-aware review refresh and effective-person resolution must be integrated before exposing this workflow. Current fingerprints include whole source records, so normal applicant updates can make evidence stale; this must be handled by a controlled refresh process, not ignored.

Still required before production: applicant-to-applicant duplicate/alias review, full active-primary/history checks and hiring-category eligibility, paginated preview/eligible-line search, Onboarding UI and PRF shortcuts, controlled conversion preserving worker identity, withdrawal/release integration, scheduling and confirmed deployments, downstream dependency-aware transitions, source reconciliation and real independent-concurrency/RLS validation. Prepared future assignment states do not prove those APIs exist.

## Actual Validation

Run with the external PGlite runtime:

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs
```

Passed: 75-worker commit; ineligible row/insufficient capacity whole-batch rollback; duplicate selections; module/scope/tenant denials; token replay with reordered input; different-payload rejection; repeat worker rejection; 1000-demand capacity (75 Reserved, 925 Available); immutable batch/assignment guards; audit failure rollback; required/idempotent release and restored capacity; release-audit rollback; source deletion/withdrawal/link-change guards; accent normalization; unresolved employee-match blocking and explicit reviewed link; clean operator integrity results; anonymous denial. Synthetic fixtures only. PGlite is single-connection and does not establish production behavior or independent concurrency.

Repository lint, 241 tests, production build and diff checks passed. No UI/style changes were made.

Commit remarks: prepare atomic applicant reservation/release and canonical capacity accounting, preserving history and rejecting legacy/source bypasses without enabling incomplete production workflows.
