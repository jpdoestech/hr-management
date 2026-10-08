# Employee Relations Redesign: Phase D Disciplinary History

Phase D makes finalized, substantiated HR Case outcomes the authoritative source for disciplinary history and progressive occurrences. Existing JSON-era disciplinary records remain available in a separate **Legacy Review** view and are not rewritten.

## Deployment

1. Confirm `0021_employee_relations_due_process.sql` has been applied.
2. Allow **Deploy Supabase migrations** to apply `0022_disciplinary_history.sql`.
3. Confirm the GitHub Actions run succeeds, then reload the deployed application.
4. Open **Employee Relations > Disciplinary History** and verify the **Verified History** and **Legacy Review** tabs.

The migration safely backfills any qualifying Phase 24 decisions that were already approved and had a finalized, issued, or served NOD. Oldest decisions are processed first. Re-running the generator preserves existing occurrence numbers and does not duplicate history rows.

## Authoritative History

`hr_disciplinary_history` stores the stable employee, case, decision, allegation, NOD, TDA snapshot, final finding, confirmed occurrence, approved action, effective/finalization dates, implementation placeholders, source, verification, and audit metadata.

A history row is generated only when all of the following are true:

- the decision is **Approved**;
- the overall outcome is **Substantiated** or **Partially Substantiated**;
- the NOD is **Finalized**, **Issued**, or **Served**;
- the allegation finding is **Substantiated** or **Partially Substantiated**; and
- the case has a stable employee record ID.

## Progressive Occurrence

Confirmed occurrence is calculated from active, verified, finalized history sharing the same stable employee ID and TDA rule ID. Incident reports, CVRs, free-text names, pending allegations, unsubstantiated findings, legacy records, reversed rows, and void rows are excluded.

The same case/decision/allegation source is unique. Saving an issued NOD again updates its reference metadata but preserves the already assigned occurrence.

## Security and Integrity

- Restrictive tenant RLS and the existing effective permission/scope checks protect reads and updates.
- Case-generated source and outcome fields are immutable.
- Reversing or voiding history requires `employee_relations.approve`.
- An allegation cannot be silently changed after it has generated history.
- The browser never receives a service-role key and the existing `SUPABASE_PUBLISHABLE_KEY` configuration is unchanged.

## Legacy Records

Legacy disciplinary entries remain in `hr_records` and are shown as **Legacy / Unverified**. Manual legacy maintenance requires Employee Relations management permission plus an explicit source type and reason. Phase E will provide the controlled review/migration path; Phase D does not guess relationships or silently count legacy rows.
