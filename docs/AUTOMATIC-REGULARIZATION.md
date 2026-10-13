# Automatic Employee Regularization

## Approved Rule

Active or Inactive employees recorded as Probationary become **Regular / Permanent** on the six-calendar-month anniversary of Date Hired. Month ends clamp to the last day of the target month. Separated employees and all other employment types are excluded. Missing or invalid hire dates are not converted. Status, Status Reason, Status Effective Date, department and position remain unchanged.

This is the approved organization's HR rule, not a universal determination for every employment agreement. Philippine probationary employment has exceptions; HR remains responsible for correct hiring dates and contract classifications. Reference: [DOLE Labor Code, Book VI](https://dole.gov.ph/book-6-post-employment/).

## Database Deployment

Migration `0061_automatic_employee_regularization.sql` adds a write-boundary trigger, a tenant/scoped permission-checked catch-up RPC, and an owner-only scheduled function. It does not backfill employees during migration deployment. Catch-up runs after an authorized HR session loads and during notification/automation refresh. New inserts and edits also enforce the rule, including Excel imports. Save responses refresh local employee data from the server.

Each change records its anniversary effective date, processing time, employment history, record history and tenant audit entry. Repeated processing does not duplicate the event. Stale form saves cannot erase the generated history or restore overdue Probationary type. The RPC requires both `employees.view` and `employees.update`; normal tenant and scope policies remain in force. The scheduler cannot be executed by authenticated browser clients.

## Daily Processing Without An Open Browser

1. In the Supabase project, open **Integrations > Cron** and enable the existing `pg_cron` integration.
2. Deploy migration 0061 through the repository's existing Supabase workflow.
3. Verify the job `hris-automatic-regularization` exists, with schedule `5 16 * * *` (00:05 Asia/Manila when the Cron scheduler uses UTC).
4. Check Cron job history for successful runs. The migration registers the job only when `pg_cron` is already enabled; it never installs the extension automatically.
5. If Cron was enabled after the migration, create that job in the Cron UI with SQL `select public.run_scheduled_employee_regularization();`. Run it as the database scheduler owner, not an authenticated browser user. Configure the schedule according to the scheduler's configured timezone.

Without Cron, authorized HR sessions still perform catch-up, but regularization does not run while nobody is using the app. A missing migration or database error does not silently relabel local records; due employees remain flagged.

Supabase configuration reference: [Cron](https://supabase.com/docs/guides/cron). No PostgreSQL server installation, reset or production test is required.

## Notifications

Action Center and the bell show upcoming anniversaries within 14 days, due records not yet processed, and automatic changes processed within the last 14 days. Alerts open the selected employee. Notification read IDs remain stable. Automatic probation preparation tasks are closed after regularization; evaluations themselves are not marked completed.

## Verification

JavaScript tests cover anniversaries, eligibility, alerts, denied/dirty sessions and authoritative save-state updates. The existing PGlite runtime is used only for a synthetic in-memory database rehearsal covering SQL date boundaries, tenant/scope restrictions, audit/history preservation, replay, stale writes, denied callers and the owner-only scheduler. Cron registration and production job execution must be verified after deployment; local tests do not establish production deployment success.

Commit remark: `feat(employees): automate six-month regularization with audited alerts`.
