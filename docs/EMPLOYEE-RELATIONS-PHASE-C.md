# Employee Relations Redesign: Phase C Due Process

Phase C extends the Phase 23 HR Case foundation without replacing existing Employee Relations records.

## Deployment

1. Confirm migrations through `0020_employee_relations_case_foundation.sql` have been applied.
2. Allow **Deploy Supabase migrations** to apply `0021_employee_relations_due_process.sql`.
3. Confirm the GitHub Actions run succeeds, then reload the deployed application.
4. Open **Employee Relations > HR Cases** and verify the **Response, Hearing & Decision** workspace is available.

## New Records

- `hr_case_responses` stores received explanations, documented no-response outcomes, employee evidence, witnesses, hearing requests, HR notes, and a managed attachment reference.
- `hr_case_hearings` stores optional conferences/hearings, schedules, attendance, minutes, outcomes, attachments, or an explicit reason why no hearing was required.
- `hr_case_decisions` separates TDA recommendations, proposed action, final action, decision outcome, approval, and NOD finalization metadata.

## Controls

- Decision submission requires completed findings for every allegation.
- Decision approval/return requires `employee_relations.approve` and is enforced in the database, not only hidden in the interface.
- Approved decision content is immutable. NOD issue/service metadata can still be attached to the approved decision.
- A draft NOD does not satisfy the `NOD Issued` transition. The NOD must have an issue date and a state of **Finalized**, **Issued**, or **Served**.
- Existing NTE/NOD records, legacy inline explanations, links, audit entries, and file references are preserved.

## Rollout Note

No universal statutory response period is hard-coded. HR records the response deadline on each NTE according to the applicable policy and matter, preserving human review for serious cases.
