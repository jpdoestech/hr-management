# Employee Relations Redesign: Phase F

Phase F adds monitoring, implementation tracking, lifecycle work queues, and management analytics without rewriting existing cases, attachments, disciplinary history, or legacy records.

## Required setup

1. Deploy the application files from this release.
2. Confirm migrations through `0023_employee_relations_legacy_migration.sql` are applied.
3. Allow **Deploy Supabase migrations** to apply `0024_employee_relations_monitoring.sql`.
4. Confirm the GitHub Actions run succeeds.
5. Reload the HRIS and open **Employee Relations > HR Cases**.
6. Open a case to verify **Safeguards & Implementation** is available.

## What changed

- `hr_case_interim_measures` stores temporary operational safeguards separately from findings and sanctions.
- `hr_case_implementations` tracks execution, acknowledgement, payroll/schedule handling, completion evidence, and final dates for approved action.
- Completed implementation records are protected from silent material changes unless the user has Employee Relations approval permission.
- Linked implementation status is synchronized to finalized disciplinary history without changing its source finding, occurrence, or decision.
- Case advancement to **Implemented** and **Closed** now checks normalized implementation work.
- Workflow tasks describe the actual controlled lifecycle step, including triage, investigation, NTE service, response, findings, decision, NOD service, implementation, and closure.
- HR Cases now support priority, outcome, owner, overdue, and 30-day aging filters.
- Management Analytics includes an Employee Relations view that distinguishes reported allegations from confirmed violations.

## Data safety

The migration is additive. It does not truncate, delete, or rewrite existing HR cases, links, attachments, responses, decisions, history, or legacy records. Both new tables use tenant isolation, Employee Relations permissions, employee scope checks, audit-user fields, and existing update timestamps.

## Reset behavior

The operational reset script deletes implementation and interim-measure rows before their parent cases. Authentication users, profiles, settings, and user preferences remain excluded from reset.
