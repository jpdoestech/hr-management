# Employee Relations Redesign: Phase G

Phase G completes the specification with validation and regression coverage. It preserves existing production rows and adds guards only to future inserts and updates.

## Required setup

1. Deploy the application files from this release.
2. Confirm migrations through `0024_employee_relations_monitoring.sql` have already been applied.
3. Allow **Deploy Supabase migrations** to apply `0025_employee_relations_validation.sql`.
4. Confirm the GitHub Actions run succeeds, then reload the HRIS.
5. Open **Documents & Governance > Data Quality** and run the scan.

## Validation added

- Employee responses cannot predate a linked NTE issue date.
- NOD finalization requires an approved decision and valid issue/service chronology.
- Implementation dates cannot predate the approved decision or finalized history source.
- Closed cases with mandatory implementation still open are reported as errors.
- Missing stable employee IDs, incomplete findings, missing TDA links, invalid history metadata, and duplicate generated history are surfaced for review.
- Legacy exceptions are reported by Data Quality & Governance instead of being deleted or rewritten.

## Automated coverage

The test suite covers controlled status transitions, close validation, response/NOD/implementation chronology, TDA matching, progressive occurrence, unsubstantiated report exclusion, history idempotency, migration parity/safety, RBAC/RLS, legacy preservation, search/filter/pagination, responsive modal contracts, and unrelated HR module regressions.
