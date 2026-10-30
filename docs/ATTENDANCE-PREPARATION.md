# Attendance preparation

## Scope and architecture

Attendance & KPIs opens directly into the attendance matrix: month, 1-15 / 16-End / full-month / custom cutoff controls, employee search, assignment location, department and position filters. Present, Absent, Leave, Day-off, AWOL/P and Late/UT are visible one-click transaction buttons. Weekday/date headers, frozen employee names and right-side totals keep encoding compact. Secondary controls and saved/custom cutoffs are under More; there is no mandatory create/open cutoff screen. The existing paginated record list, KPI reporting, supporting-document workflow and exports remain available through Records & KPIs.

The implementation adapts the read-only `coop-sys` attendance interactions into this application's vanilla JavaScript modules. The employee-first roster follows [AMS](https://github.com/jpdoestech/ams): employee records supply the grid; dated schedules refine individual days. It does not import another application's framework, payroll permissions or database model.

- `js/core/attendance-matrix.js`: transactions, duty/time validation, rectangle selection and draft undo/redo.
- `js/core/attendance-preparation.js`: inline workspace, scoped RPC calls, configuration and time editors.
- `js/core/attendance-wage-rules.js`: independently testable basic daily-rate and entitlement building blocks; not payroll certification.
- `css/attendance.css`: scoped responsive layout using existing controls and tokens.
- `supabase/migrations/0062_attendance_preparation.sql`: additive configuration, cutoff, preference, review and guarded-write boundaries.
- `supabase/migrations/0063_attendance_direct_matrix.sql`: scoped all-location reads and one transactional wrapper around the existing canonical writer. Migration 0062 is unchanged.
- `supabase/migrations/0064_attendance_employee_roster.sql`: employee-first roster and atomic ordinary-attendance saves without per-employee schedule setup. Earlier migrations remain unchanged.

Attendance is still stored once in `hr_records`, module `attendance`, for each tenant/employee/work date. Overlapping cutoffs read and update that same record. Cutoffs do not copy attendance into a separate ledger. Existing records and attachments are not backfilled or deleted.

## Rollout and setup

1. Review migrations through 0064 with the existing ordered migrations and `docs/DEPLOYMENT.md`. Apply pending migrations first to an authorized development/staging Supabase project, then deploy the frontend. No production migration was executed during implementation.
2. Test authenticated HR and restricted accounts in staging. Preparation needs both `attendance.view` and `employees.view`; writes separately require attendance Create/Update, and approval/configuration require Manage. Wage configuration additionally requires `settings.manage`; statutory review requires the tenant's superadministrator.
3. Ordinary attendance works immediately from Employee Information for accounts with applicable employee scope and unrestricted client access. Select a period and paint Present, Absent, paid/unpaid Leave, Day-off or AWOL/P. Late/UT accepts reported scheduled, late and undertime minutes for one or multiple selected days. Scheduled minutes default to the existing record's value, or 480 for a new record. Confirm the DTR/reference and save; no separate attendance schedule or calendar setup is required for these records.
4. For verified duty and holiday/pay classification, ensure the existing Settings Client Accounts catalog contains the relevant active client. In Holidays & schedules, add reviewed employee schedules with client, dated branch/department/position, worksite and region/province/city scope codes. Use consistent PSGC codes for calendar matching, and explicit `N/A` for an inapplicable province. The form supports weekly split/overnight duties and unpaid breaks. An effective end is the first day no longer assigned.
5. Record reviewed calendar coverage for the period and official holiday declarations/references for all applicable national and local scopes. Coverage means HR has checked the calendar; it does not automatically import official declarations. Deduplicated holiday identities prevent overlapping declarations from creating a double holiday. Two distinct regular holidays resolve as a double regular holiday. Unsupported/mixed classifications require review.
6. Add one-day reviewed rest overrides when necessary. Sunday is not automatically a rest day. A special working holiday remains an ordinary working-day classification.
7. If wage building blocks will be consumed by a future integration, have the superadministrator review a statutory version for employer/date applicability, then create a reviewed effective-dated client policy. The seeded handbook register is deliberately unreviewed, not a runtime fallback. Reviewed wage versions are immutable: create a new identity/version for changes.
8. Select a month and cutoff directly in the matrix. All assignment locations is scoped server-side to accessible employees and dated assignments. Choose a specific client/branch location when needed; employee-only branches are labeled Employees. Client-specific filters require a corresponding dated assignment. Custom dates support cross-month/year cutoffs up to 31 inclusive days; saving named cutoff metadata with an optional payout remains available under More.
9. Select a transaction, then paint cells or a rectangle. Shift+arrow keys select a keyboard rectangle; Enter/Space stages it. One gesture is one undo operation. On touch layouts, switch between Paint and Scroll modes.
10. Review staged changes and supply a DTR/reference before Save. A conflict leaves drafts intact for review; reload only after deciding whether to discard them. No batch is partially committed, including a batch spanning multiple clients/branches. Right-side totals count actual saved/staged records only, never assumed blanks. Export retrieves all filtered roster pages and exports saved daily attendance; save or discard drafts first. There is no attendance spreadsheet-import engine or inert Import button in this revision.

Client restrictions reuse Access Control resource assignments: resource type `attendance_client`, resource ID the Client Account UUID, and access level `view`, `edit` or `manage`. These are optional narrowing restrictions on existing tenant/employee/branch scopes, never additional grants. An account with any such assignments cannot access unassigned clients, including legacy attendance without a client. No new payroll permission namespace is introduced.

### Employees missing from the matrix

Employees appear automatically from Employee Information without creating attendance schedules. Clear search/location/department/position filters and check employee/client access if someone is missing. Accounts restricted to particular clients still require dated assignment evidence linking the employee to an allowed client; employees with no known client cannot bypass that restriction. Dates before hiring, after effective separation, in the future, or protected by posting locks are not editable. Existing dated schedules continue to own their days, including unreviewed schedules; ordinary attendance cannot bypass their calendar/duty checks.

A failed roster request displays **Employee roster could not be loaded** and **Retry**, rather than a missing-schedule message or a zero employee count. Retry keeps the cutoff and filters. Check the reported access/database error and the rollout prerequisites above; do not invent schedules or loosen access policies to resolve a loading failure. **Records & KPIs** lists saved attendance records, so employees without saved attendance are absent from that view by design.

Employee-only records use the existing canonical attendance statuses and reported-minute KPI definitions. They do not claim verified actual punches, holiday classification, worked minutes or payroll preparation. Blank days stay unrecorded. Existing files, factors and history survive updates. Mixed employee-only and scheduled batches commit atomically; concurrent employee/attendance changes reject stale drafts. Approved employee-only records require review to return them to Draft before correction; posted records remain locked.

Migration 0064 changes functions only and does not backfill employees or schedules. Older frontends keep the scheduled path but will not enable employee-only cells. To roll back functionality, restore the 0063 roster/options definitions and route the public writer to `attendance_private.save_scheduled_attendance_matrix`; keep canonical employee-only attendance records and their audit history. No record deletion or database reset is needed.

If promoted manpower deployment tables exist, the dated schedule must match the canonical primary deployment interval and assignment. The adapter fails closed if deployment tables are only partially promoted. It does not activate SQL proposals. Existing source-snapshot locks and record dependency triggers remain in the write path.

## Actual records versus assumptions

Each account stores its own exception-only (assumed Present) or present-required (assumed Absent) preference in Supabase. A dotted blank is not attendance and never contributes to KPIs. Selected/page defaults require confirmation and merely stage eligible blank cells. They preserve existing exceptions and never infer holiday work.

Paid Leave and Unpaid Leave both retain the canonical `Approved Leave` status with separate `leaveTreatment`. AWOL/AWOP is an attendance absence, not an automatic employee separation or disciplinary finding. Day-off and Holiday (Unworked) retain `Rest Day / Holiday`; worked holiday/rest duty retains `Present` with its separate resolved classification. For reviewed schedules, Late/Undertime calculates loss from actual segments against the dated duty. Employee-only entries retain the reported minutes without inventing a duty schedule.

Approval is stored in a protected review registry. Old arbitrary JSON review flags are not treated as authoritative approval. Edits retain genuine approval but remain auditable. Approval alone never locks attendance.

## Editing and cancelling Late/UT

Both Late/UT editors reopen the current staged entry before the saved entry.
The reported-minute editor defaults to 480 scheduled minutes only for a new
employee-only day. Switching transaction type retains that day's staged
scheduled-minute basis while clearing late/UT for non-Late/UT transactions.
The reviewed-duty editor reuses entered actual segments, including breaks and
next-day flags; a day without actual segments starts from the reviewed schedule.
Bulk edits still require compatible reviewed schedules and apply the first
selected day's displayed values to the selected days when staged.

Cancel and Close discard only changes in the open editor. Existing staged or
saved attendance remains intact. Stage updates the local draft; Save changes
persists the batch with its required reference and existing confirmation.
Restaging identical values does not add an undo frame. Undo/Redo remains
available for staged changes; neither action changes already saved attendance.

## Persistence and security

`save_attendance_matrix` validates the batch server-side, including current permissions, client/record scope, dated schedule/calendar hashes and existing-record hashes. It acquires the existing manpower source lock when installed, then attendance and employee locks in a consistent order. Migration 0063 moves the original scoped writer into the protected private schema and calls it for each trusted assignment group inside one transaction, not browser upsert loops. Changes, before/after snapshots and audit entries share that transaction. Existing canonical validation and downstream write/dependency triggers still run.

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
- `tests/database/attendance-preparation-rehearsal.mjs` applies actual migrations 0031, 0062, 0063 and 0064 to a synthetic in-memory PGlite fixture. It covers employees with no schedules, ordinary recording without fabricated duty/pay evidence, hire boundaries, filters, permissions, tenant/client restrictions, stale hashes, mixed ordinary/scheduled atomic rollback/save, private-writer protection, approval/posting protection, holiday deduplication/conflicts, dated labels, holiday KPIs and a synthetic promoted-deployment/interlock adapter.
- Run the SQL rehearsal with an already available PGlite module via `HRIS_PGLITE_MODULE`, or a development PGlite dependency. It does not install or start PostgreSQL, contact Supabase or execute production SQL.
- `tests/browser/attendance-preparation-fixture.mjs` serves synthetic rows and mocked RPC responses on port 4189. Browser checks exercised painting, one-gesture drag undo, keyboard rectangle/focus, defaults, split-duty editor, retained drafts on conflict and 390px/mobile, 768px/tablet and desktop layouts. This fixture is not proof of authenticated end-to-end Supabase integration or physical-device touch testing.
- Real PostgreSQL independent-session races, full production migration-chain compatibility, authenticated staging acceptance and enterprise load testing still require an authorized staging database. The synthetic rehearsal does not replace them.
- No authoritative payroll provider or controlled posted-record adjustment workflow is connected. Posted records therefore fail closed until that workflow is built. There is no automatic holiday feed or leave-ledger entitlement integration.
- Historical rehire gaps require reviewed dated assignment evidence; the adapter does not reconstruct every employment-history event. Configuration browsing currently shows the latest 100 accessible entries; employee matrix and cutoff lists use server pagination.
- New tenants created after migration need their own reviewed statutory register version; the migration's unreviewed seed covers existing tenants only.

Commit remarks: add scoped attendance preparation with transactional saves, review/calendar/schedule configuration, responsive matrix controls and tested wage-rule boundaries; preserve canonical attendance, attachments, KPIs and existing authorization.
