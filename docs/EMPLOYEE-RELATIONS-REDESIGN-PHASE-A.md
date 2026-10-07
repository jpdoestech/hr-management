# Employee Relations Redesign: Phase A Audit and Mapping

## Repository Baseline

- Audited local `main` after fetching `origin/main` on 2026-10-07.
- Local and remote commit: `da46fcc3885e3df9343fe59e0a3d50ad68df7e2e`.
- The worktree was clean before implementation.
- `supabase-config.js` uses `SUPABASE_PUBLISHABLE_KEY`; this configuration remains unchanged.

## Current Implementation

### Application

- `js/app.js` contains the Employee Relations navigation, generic record forms, Incident and CVR forms, TDA integration, HR Case list/workspace, case linking, case activity, audit calls, and dashboards.
- Incident, CVR, NTE, Memorandum, NOD, and Disciplinary Action data are persisted as `hr_records` modules.
- HR Cases use dedicated `hr_cases`, `hr_case_links`, and `hr_case_activity` tables.
- Attachments are retained either as managed Supabase Storage references or Google Drive references. HR Cases store a primary attachment in `attachment_name` and `attachment_ref`.
- `js/core/access-control.js` and `supabase/phase20-access-control.sql` provide effective permissions and direct grants/denies.

### Database and Security

- `supabase/phase3b-case-workflow.sql` introduced the original case and link tables.
- `supabase/phase9-case-intelligence.sql` added priority, deadlines, and append-only case activity.
- `supabase/phase10-self-service.sql` restricted case visibility to HR roles, legacy viewers, and assigned managers.
- `supabase/phase19-tenant-scale-foundation.sql` added tenant identifiers, restrictive tenant RLS, and tenant-write triggers.
- `supabase/phase20-access-control.sql` added permission-aware `hr_records` policies and tenant-aware effective access.
- `supabase/phase22-hr-case-attachments.sql` added primary case attachment fields.

## Current Relationships

- `hr_cases.employee_record_id` links a case to the stable Employee Master record while retaining an employee-name snapshot.
- `hr_case_links` links cases to generic HR records and TDA catalog rows without moving or duplicating source records.
- `hr_case_activity` records case notes, status changes, assignments, deadlines, priorities, policies, and links.
- TDA selections are stored as snapshots on generic records; an HR Case currently links one catalog row through `hr_case_links`.

## Retained Working Functionality

- Existing Incident, CVR, NTE, Memorandum, NOD, Disciplinary Action, TDA, HR Case, and attachment records.
- Existing case numbers (`CASE-YYYY-####`).
- Existing report-to-case links and activity history.
- Search, filters, table layout behavior, responsive modals, uploads, audit logging, effective permissions, tenant isolation, and RLS architecture.

## Gaps and Redundant Logic

| Specification requirement | Current behavior | Incremental correction |
| --- | --- | --- |
| HR Case is the central workflow | Cases exist, but generic records can operate independently | Keep source records and make the case workspace the workflow coordinator |
| Case-oriented stages | `Open -> NTE Issued -> Memo Issued -> For Decision -> Resolved -> Closed` | Add controlled case stages and terminal outcomes while accepting legacy values |
| Allegations and findings | No normalized allegation entity | Add tenant-scoped `hr_case_allegations` with finding fields |
| Reports are allegations | Incident/CVR are linked, but the readiness tracker also accepts Disciplinary Action | Accept Incident/CVR or normalized allegations; exclude disciplinary history |
| Memo is optional correspondence | Linking a memo automatically changes the case to `Memo Issued` | Preserve memo records and links but stop status advancement |
| Progressive occurrence | CVR and disciplinary rows are counted by employee name plus offense text | Introduce stable-ID qualifying-history logic; never count raw CVRs |
| Controlled transitions | Status is an unrestricted dropdown | Centralize transition rules and validate prerequisites |
| Confidential records | Case policies predate effective permission scopes | Layer employee-relations permission and scope checks over tenant RLS |

## Schema Changes Needed

1. Expand the case status constraint without rewriting existing status values.
2. Add case type, outcome, triage metadata, and legacy workflow metadata to `hr_cases`.
3. Add normalized `hr_case_allegations` with stable case, report, employee, and TDA references/snapshots.
4. Add tenant indexes, updated-at and tenant-write triggers, and permission-aware RLS for the new table.
5. Tighten current case/link/activity policies through the existing effective-access and scope functions.

## Migration and Compatibility Risks

- Existing legacy statuses must remain valid until records are explicitly reviewed; they must not be silently remapped.
- Legacy disciplinary rows cannot be assumed substantiated. Later migration must mark them `legacy_unverified` unless safely verified.
- Existing memo attachments and text must remain accessible as correspondence.
- Name-only relationships are ambiguous. New links use stable Employee Master IDs; legacy links are not guessed from duplicate names.
- Deployment must run the new migration before relying on new stages. The UI retains a legacy-compatible fallback if the table is unavailable.
- RLS changes must preserve assigned-manager access while preventing ordinary/self-service accounts from querying confidential cases.

## Planned Files by Phase

### Phase B

- `js/core/employee-relations.js`
- `js/app.js`
- `css/professional.css`
- `supabase/phase23-employee-relations-case-foundation.sql`
- `database/migrations/phase23-employee-relations-case-foundation.sql`
- `tests/core/employee-relations-domain.test.mjs`
- `tests/core/employee-relations-modal.test.mjs`
- `tests/core/tda-workflow.test.mjs`
- `scripts/validate.mjs`

### Phase C

- `supabase/phase24-employee-relations-due-process.sql`
- `database/migrations/phase24-employee-relations-due-process.sql`
- `docs/EMPLOYEE-RELATIONS-PHASE-C.md`
- `tests/core/employee-relations-due-process.test.mjs`
- Separate response, optional hearing/conference, decision approval, and explicit NOD-finalization records are now implemented without rewriting legacy NTE/NOD data.

### Later Phases

- Add implementation and disciplinary-history entities through separately versioned migrations.
- Reclassify legacy memos and disciplinary rows without deleting source data or attachments.
- Update analytics only after finalized findings and implementation records are authoritative.
