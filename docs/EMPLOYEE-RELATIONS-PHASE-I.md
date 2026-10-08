# Employee Relations Hardening: Phase I Reports and Intake

Phase I adds a generalized Reports & Intake queue for Employee Relations matters that are not Incident Reports or CVRs. Existing Incident and CVR modules and their attachments remain unchanged.

## Required setup

1. Deploy the application files from this release.
2. Confirm migrations through `0026_employee_relations_evidence.sql` have already been applied.
3. Allow **Deploy Supabase migrations** to apply `0027_employee_relations_intake.sql`.
4. Confirm the GitHub Actions run succeeds, then reload the HRIS.
5. Open **Employee Relations > HR Cases > Reports & Intake**.

## Supported intake

- Supervisor Referral
- Employee Complaint
- Attendance Exception
- Audit Finding
- Security Report
- Client Referral
- Other Referral

Each record uses an employee selected from Employee Information, automatically derives the employee's department, and records the matter, dates, source, confidentiality, triage status, notes, and optional managed attachment.

An intake can be linked to an existing case for the same employee or converted into a new case. Either path creates a source allegation, but never a confirmed violation. Findings and disciplinary history continue to require the controlled case decision workflow.

## Data safety

The migration is additive and transaction-wrapped. Existing Incident, CVR, case, link, allegation, and attachment rows are not rewritten. The migration only expands the existing case-link and allegation source constraints to recognize `intake`.
