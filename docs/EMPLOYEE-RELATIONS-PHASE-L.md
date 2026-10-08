# Employee Relations Phase L: Case Command Center and Confidential Access

## Purpose

Phase L completes the current Employee Relations hardening pass without rebuilding the working module or changing existing record and attachment identities. It replaces the long case-detail page with a stable-height command center, adds process progress and blockers, and moves sensitive access enforcement into PostgreSQL as well as the interface.

## Process model

The command center groups the existing controlled stages into seven operational phases:

1. Intake and triage
2. Investigation
3. Notice and employee response
4. Hearing or conference, when required
5. Findings
6. Decision and Notice of Decision
7. Implementation and closure

This grouping follows the application's Philippine due-process workflow. The Department of Labor and Employment describes notice, opportunity to respond, hearing or conference when requested or necessary, and written decision as the procedural sequence for just-cause termination. The ACAS investigation, hearing, outcome, and appeal structure was used only as an additional case-management design reference, not as Philippine legal authority.

References:

- https://blr.dole.gov.ph/2014/12/11/termination-of-employment/
- https://dole.gov.ph/book-6-post-employment/
- https://www.acas.org.uk/acas-code-of-practice-on-disciplinary-and-grievance-procedures/html

The progress indicator is operational guidance. It does not automatically decide liability, select a sanction, or replace HR and legal review.

## Deploy

1. Confirm Phases 23 through 31 were already applied.
2. Open **Supabase Dashboard > SQL Editor**.
3. Run the complete `supabase/phase32-employee-relations-confidentiality.sql` file once.
4. Run `supabase/verify-phase32-employee-relations-security.sql`. This verification file is read-only.
5. Confirm the verification result shows 18 Employee Relations capability rows, the confidentiality policies, and the permission triggers.
6. Reload the deployed application.
7. Open **Documents & Governance > Access Control** and review custom roles. Administrator and HR Staff receive all new capabilities automatically; custom roles receive none unless explicitly granted.
8. Test with separate users for case creator/investigator, decision maker, approver, implementation owner, and read-only access.

## Required role checks

- A user without `employee_relations.view_confidential` cannot list another user's confidential case, child records, history, or case attachment.
- An assigned owner or original creator can continue the confidential case within their granted stage capabilities.
- Direct denies override role grants in **View Effective Access**.
- A report creator cannot approve a decision unless separately granted `employee_relations.approve_decision`.
- TDA deviation requires `employee_relations.override_tda_recommendation` and a written reason.
- Closed or approved records remain subject to the existing controlled-revision and material-record protections.

## Compatibility

- Existing cases default to confidential when Phase 32 is applied.
- Existing case IDs, links, child records, history, and attachment references are unchanged.
- Before Phase 32 is installed, the frontend continues to use broad legacy Employee Relations permissions and omits the new case flag from writes.
- `SUPABASE_PUBLISHABLE_KEY` is unchanged.

## UI behavior

- Progress, current stage, owner, deadline, next action, and blockers remain visible above the workspace tabs.
- Six tabs separate overview, allegations/findings, investigation, notice/response, decision/action, and records/activity.
- The modal keeps one stable height when switching tabs.
- Tablet and desktop show the full command center; narrow screens use horizontally scrollable tabs and progress steps.
