# Employee Relations Redesign: Phase E Legacy Migration

Phase E provides a controlled migration and review path for existing disciplinary and memorandum records. It is additive: the original `hr_records` JSON, case links, timestamps, attachment names, and storage references remain the source of truth and are not rewritten or deleted.

## Deployment

1. Confirm migrations through `0022_disciplinary_history.sql` have been applied successfully.
2. Back up the Supabase database before any production migration.
3. Allow **Deploy Supabase migrations** to apply `0023_employee_relations_legacy_migration.sql`.
4. Confirm the GitHub Actions run succeeds, then reload the application.
5. Open **Employee Relations > Disciplinary History > Legacy Review** and inspect unmatched or ambiguous records.
6. Open **Employee Relations > Legacy Memoranda** and confirm dates, attachments, and case links are present.

The migration is idempotent and can be run again after a failed deployment. The matching and projection functions update the same normalized row by tenant, source module, and source record ID.

## Matching Rules

An employee is linked automatically only when either:

- the source has an employee ID that exists in the same tenant; or
- exactly one employee has the same normalized full name after trimming, lowercasing, and collapsing repeated whitespace.

There is no fuzzy, partial, phonetic, or similarity-based automatic match. Missing and ambiguous matches remain in the review queue.

## Legacy Disciplinary Review

Old disciplinary rows are copied into `hr_disciplinary_history` as `legacy` and `Legacy Unverified`. Historical TDA labels and occurrence text stay inside the source snapshot but do not affect progressive occurrence.

- **Link / retain as unverified** requires `employee_relations.manage`.
- **Verify as a confirmed outcome** requires `employee_relations.approve`, a stable employee, an active TDA rule, a qualifying finding, decision/finalization dates, a final action, and a review reason.
- **Reject from confirmed history** requires `employee_relations.approve` and a review reason.

Verification recalculates the occurrence from active, verified history sharing the same stable employee ID and TDA rule ID. It never copies an old free-text occurrence count. Every review writes to the existing audit log.

## Legacy Memoranda

Old memorandum rows are projected into `hr_case_correspondence` with their employee reference, department, subject, action, memo/receipt dates, remarks, source JSON, attachment name/reference, and reliable case link. The normalized table is read-only to browser clients. Users edit or remove the preserved source memorandum, and database triggers synchronize the projection.

Deleting a source marks its projection as **Source Removed** instead of deleting the normalized history. This preserves migration evidence and avoids losing attachment or case-link context.

## Existing Module Treatment

- Incident and CVR remain report/intake sources and retain their case links.
- NTE and NOD remain their existing source records and attachments.
- Memoranda become legacy correspondence and do not advance case workflow.
- Disciplinary source records become reviewable legacy history and are not automatically substantiated.
- Existing case links are reused only when a source has exactly one linked case. Multiple links are flagged as ambiguous.

## Verification Checklist

- A legacy record with a valid employee ID links to that employee.
- A uniquely matching exact name links; a duplicate name does not.
- A historical occurrence label is shown as not counted.
- Only an approved review creates a verified occurrence.
- A mismatched employee/case combination is rejected.
- Memorandum attachments still open from their original storage provider.
- Editing the original memorandum refreshes its correspondence projection.
- Removing a source retains a **Source Removed** normalized row.
- Tenant RLS, permission checks, scope checks, and the publishable frontend key remain unchanged.
