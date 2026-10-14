# Attendance preparation

## Scope and architecture

Attendance & KPIs > Preparation opens an inline cutoff workspace. The existing paginated record list, KPI reporting, supporting-document workflow and exports remain available through Records & KPIs.

The implementation adapts the read-only `coop-sys` attendance interactions into this application's vanilla JavaScript modules. It does not import its framework, payroll permissions or database model.

- `js/core/attendance-matrix.js`: transactions, duty/time validation, rectangle selection and draft undo/redo.
- `js/core/attendance-preparation.js`: inline workspace, scoped RPC calls, configuration and time editors.
- `js/core/attendance-wage-rules.js`: independently testable basic daily-rate and entitlement building blocks; not payroll certification.
- `css/attendance.css`: scoped responsive layout using existing controls and tokens.
- `supabase/migrations/0062_attendance_preparation.sql`: additive configuration, cutoff, preference, review and guarded-write boundaries.

Attendance is still stored once in `hr_records`, module `attendance`, for each tenant/employee/work date. Overlapping cutoffs read and update that same record. Cutoffs do not copy attendance into a separate ledger. Existing records and attachments are not backfilled or deleted.

## Rollout and setup

1. Review migration 0062 with the existing ordered migrations and `docs/DEPLOYMENT.md`. Apply it first to an authorized development/staging Supabase project. No production migration was executed during implementation.
2. Test authenticated HR and restricted accounts in staging. Preparation needs both `attendance.view` and `employees.view`; writes separately require attendance Create/Update, and approval/configuration require Manage. Wage configuration additionally requires `settings.manage`; statutory review requires the tenant's superadministrator.
3. Ensure the existing Settings Client Accounts catalog contains the relevant client. The client must be active to create a cutoff.
4. In Preparation > Configuration, add reviewed employee schedules with client, dated branch/department/position, worksite and region/province/city scope codes. Use consistent PSGC codes for calendar matching, and explicit `N/A` for an inapplicable province. The form supports weekly split/overnight duties and unpaid breaks. An effective end is the first day no longer assigned.
5. Record reviewed calendar coverage for the period and official holiday declarations/references for all applicable national and local scopes. Coverage means HR has checked the calendar; it does not automatically import official declarations. Deduplicated holiday identities prevent overlapping declarations from creating a double holiday. Two distinct regular holidays resolve as a double regular holiday. Unsupported/mixed classifications require review.
6. Add one-day reviewed rest overrides when necessary. Sunday is not automatically a rest day. A special working holiday remains an ordinary working-day classification.
7. If wage building blocks will be consumed by a future integration, have the superadministrator review a statutory version for employer/date applicability, then create a reviewed effective-dated client policy. The seeded handbook register is deliberately unreviewed, not a runtime fallback. Reviewed wage versions are immutable: create a new identity/version for changes.
8. Create a cutoff with inclusive start/end (maximum 31 calendar days), branch, client and optional payout date. Cross-month/year cutoffs are supported. Open it to fetch the scoped roster and only that period's attendance.
9. Select a transaction, then paint cells or a rectangle. Shift+arrow keys select a keyboard rectangle; Enter/Space stages it. One gesture is one undo operation. On touch layouts, switch between Paint and Scroll modes.
10. Review staged changes and supply a DTR/reference before Save. A conflict leaves drafts intact for review; reload only after deciding whether to discard them. No batch is partially committed.

Client restrictions reuse Access Control resource assignments: resource type `attendance_client`, resource ID the Client Account UUID, and access level `view`, `edit` or `manage`. These are optional narrowing restrictions on existing tenant/employee/branch scopes, never additional grants. An account with any such assignments cannot access unassigned clients, including legacy attendance without a client. No new payroll permission namespace is introduced.

If promoted manpower deployment tables exist, the dated schedule must match the canonical primary deployment interval and assignment. The adapter fails closed if deployment tables are only partially promoted. It does not activate SQL proposals. Existing source-snapshot locks and record dependency triggers remain in the write path.

## Actual records versus assumptions

Each account stores its own exception-only (assumed Present) or present-required (assumed Absent) preference in Supabase. A dotted blank is not attendance and never contributes to KPIs. Selected/page defaults require confirmation and merely stage eligible blank cells. They preserve existing exceptions and never infer holiday work.

Paid Leave and Unpaid Leave both retain the canonical `Approved Leave` status with separate `leaveTreatment`. AWOL/AWOP is an attendance absence, not an automatic employee separation or disciplinary finding. Day-off and Holiday (Unworked) retain `Rest Day / Holiday`; worked holiday/rest duty retains `Present` with its separate resolved classification. Late/Undertime calculates loss from actual segments against the dated duty, not another employee's current schedule.

Approval is stored in a protected review registry. Old arbitrary JSON review flags are not treated as authoritative approval. Edits retain genuine approval but remain auditable. Approval alone never locks attendance.

## Persistence and security

`save_attendance_matrix` validates the batch server-side, including current permissions, client/record scope, dated schedule/calendar hashes and existing-record hashes. It acquires the existing manpower source lock when installed, then attendance and employee locks in a consistent order. Changes, before/after snapshots and audit entries share one transaction. Existing canonical validation and downstream write/dependency triggers still run.

Prepared status/time fields must be corrected through Preparation. The existing record editor can still maintain supporting files, remarks, factors and absence classification without overwriting the prepared duty snapshot. Those changes are audited. Direct browser changes cannot forge review, preparation or posting metadata.

`register_attendance_posting_lock` is executable only by the trusted `service_role` backend, never the authenticated browser. Its caller must supply an authoritative posting reference and the attendance must have genuine approval. Locked records reject ordinary update/delete operations. There is intentionally no browser posted flag, unlock button or service-role secret in frontend code.

## KPI compatibility

Existing KPI definitions and paginated reporting remain unchanged. Worked holidays/rest days count as recorded present duty; they are not excluded merely because their calendar classification is non-working. Unworked holidays/rest days remain excluded. Paid/unpaid leave remains separately identifiable but follows the existing approved-leave denominator behavior. Blanks are unknown. Exports include preparation/time/classification/review identifiers alongside the original fields.

## Wage-rule boundary and sources

The register captures worked first-eight-hour baseline percentages as configuration: ordinary 100%, rest 130%, special non-working 130% / rest 150%, regular 200% / rest 260%, double regular 300% / rest 390%. Unworked eligible regular holidays use 100% and double regular holidays 200%, without worked-rest premiums. The resolver selects one compound classification and applies its configured multiplier once.

References reviewed during implementation:

- [DOLE/BWC Workers' Statutory Monetary Benefits Handbook, 2024 edition, hosted by NWPC](https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf): premium table and holiday entitlement, including intervening rest days and successive holidays.
- [DOLE Book III, Conditions of Employment](https://dole.gov.ph/book-3-conditions-of-employment/): rest-day/Sunday treatment, including statutory exceptions requiring employer-specific review.

The pure resolver uses integer centavos and basis points with exact BigInt multiplication, rounding half-up once at the daily-result boundary. It records policy/statutory/calendar/schedule/attendance source versions. Missing, conflicting or unreviewed entitlement evidence returns Needs Review, not an invented zero. The bounded evidence RPC can retrieve preceding days outside a cutoff, subject to the same permissions.

**Not a payroll engine:** no final gross/net pay, deductions, payslips, overtime, night differential, COLA, allowance calculation, monthly conversion, regional minimum-wage-order automation or paid-leave entitlement/balance consumption is implemented. The basic full-eight-hour resolver is not connected to a certified payroll UI. Partial/unreviewed/unsupported cases need review, not guessed premiums. Employer coverage and statutory exceptions require independent review before calculation is used.

## Validation and remaining integrations

- Automated core tests cover painting/undo, blank defaults, paid/unpaid mapping, split duties, compatible schedules, classifications, exact arithmetic, dated policy changes and preceding entitlement evidence.
- `tests/database/attendance-preparation-rehearsal.mjs` applies actual migrations 0031 and 0062 to a synthetic in-memory PGlite fixture. It covers rollback, stale hashes, permissions/client restrictions, preserved approval, posting protection, holiday deduplication/conflicts, dated labels, holiday KPIs and a synthetic promoted-deployment/interlock adapter.
- Run the SQL rehearsal with an already available PGlite module via `HRIS_PGLITE_MODULE`, or a development PGlite dependency. It does not install or start PostgreSQL, contact Supabase or execute production SQL.
- `tests/browser/attendance-preparation-fixture.mjs` serves synthetic rows and mocked RPC responses on port 4189. Browser checks exercised painting, one-gesture drag undo, keyboard rectangle/focus, defaults, split-duty editor, retained drafts on conflict and 390px/mobile, 768px/tablet and desktop layouts. This fixture is not proof of authenticated end-to-end Supabase integration or physical-device touch testing.
- Real PostgreSQL independent-session races, full production migration-chain compatibility, authenticated staging acceptance and enterprise load testing still require an authorized staging database. The synthetic rehearsal does not replace them.
- No authoritative payroll provider or controlled posted-record adjustment workflow is connected. Posted records therefore fail closed until that workflow is built. There is no automatic holiday feed or leave-ledger entitlement integration.
- Historical rehire gaps require reviewed dated assignment evidence; the adapter does not reconstruct every employment-history event. Configuration browsing currently shows the latest 100 accessible entries; employee matrix and cutoff lists use server pagination.
- New tenants created after migration need their own reviewed statutory register version; the migration's unreviewed seed covers existing tenants only.

Commit remarks: add scoped attendance preparation with transactional saves, review/calendar/schedule configuration, responsive matrix controls and tested wage-rule boundaries; preserve canonical attendance, attachments, KPIs and existing authorization.
