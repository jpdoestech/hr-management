# Employment Type and Operational Status

## Fields

- `employmentType`: Regular / Permanent, Probationary, Project-Based, Seasonal, Fixed-Term / Contractual, or Casual. HR selects the actual contract type. Date Hired never automatically regularizes employees.
- `status`: Active, Inactive, or Separated.
- `statusReason`: dependent reason for the selected operational state. AWOL pending review is Inactive, not automatic abandonment or separation. Confirmed termination is a separate HR decision.
- `statusDate`: actual operational status event date. A blank Excel cell stays blank. Hiring events have their own Date Hired in history. Inactive and Separated changes require an effective date.
- `regularizationDate`: recorded when HR performs a Regularization lifecycle event; it does not overwrite the operational status date.

## Existing records

Migration 0032 preserves the original status, override and date in `legacyEmploymentSnapshot` and retains existing history and attachments. Explicit Regular/Probationary overrides become recorded employment types. Auto classifications are marked Unspecified / Review Required, because elapsed service alone is not proof of the contract type. Verify these records through Employee Information or Data Quality.

Legacy AWOL becomes Inactive / AWOL (Pending Review). Resigned becomes Separated / Resigned. Newly Hired and department transfers become Active with Active / Normal as the reason. Legacy Returned to Agency becomes Inactive pending HR clarification, not presumed termination or reinstatement. HR can explicitly select Active / Return to Agency when the return means active duty; the Return to Agency lifecycle event records waiting for an assignment. Existing ambiguous dates are preserved rather than silently deleted. Data Quality flags legacy Active imports whose status date equals their hire date for verification and correction.

## Connected workflows

Employee forms, Excel templates, import validation, exports, directory filters/projection, dashboard composition, management analytics, weekly reports, self-service and attendance use the separated model. Regularization changes contract type only. Resignation and separation require existing leaving details. Transfers do not change legal contract type. Employee Relations records and decisions remain preserved; a report, AWOL record or NTE does not automatically change an employee's legal employment state.

Operational status does not automatically revoke a login or execute payroll: those remain separate Access Control and payroll decisions. Existing RBAC, tenant RLS and audit checks are preserved.

## Deployment and legal references

Deploy 0032 before the new frontend is used to save employees. It updates legacy JSON records and the existing RLS-aware server query functions. Reload to refresh cached records. Download a new Excel template; Employment Type is required and Status Reason must match the operational state.

- DOLE Labor Code, Book VI: https://dole.gov.ph/book-6-post-employment/
- Supreme Court on abandonment and absence: https://lawphil.net/judjuris/juri2025/may2025/gr_259988_2025.html

These fields support HR recording and review, not automatic legal determinations. Six calendar months and 180 days are not interchangeable in every legal context; the configurable day threshold is a reminder, not an automatic status conversion.
