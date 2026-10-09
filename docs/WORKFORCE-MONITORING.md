# Workforce monitoring

## Dashboard and Management Analytics

Dashboard > Records & Mix contains an age-band table with Male, Female, Other / Unknown, and Total counts. Age uses complete birthdays at the reporting date. The six requested bands use inclusive lower bounds and exclusive upper bounds; under-18 and unknown birth dates are separate rows.

Management Analytics > Workforce uses its existing branch, department, and date controls. Age is calculated at the reporting end date. Leaving-factor and classification summaries include Resigned, AWOL, Separated, and Returned to Agency records with a status effective date in the selected period. Legacy records without leaving details remain Unknown / Not Disclosed.

The Fill Rate KPI counts deployed slots divided by required positions for requests received within the reporting period, scoped to branch and department. Cancelled requests and cancelled slots are excluded from demand. No demand produces an unavailable percentage, rather than a misleading zero.

## Attendance

People & Records > Attendance & KPIs records one employee per work date. Select the actual employee, attendance status, scheduled minutes, late minutes, undertime minutes, absence classification, contributing factor, optional remarks, and supporting document. Department and branch come from the selected employee. Uploaded files follow the existing configured storage destination.

- Attendance rate: present employee-days / recorded scheduled employee-days.
- Absence rate: absent employee-days / recorded scheduled employee-days.
- Late and undertime rates: affected present employee-days / present employee-days.
- Lost-time rate: absence minutes plus late and undertime minutes / scheduled minutes.
- Approved leave is tracked separately but remains in recorded scheduled days. Rest days and holidays are excluded.
- Missing records are unknown and never inferred as absences.

Search, date, department, branch and status filters apply to both records and KPIs. PostgreSQL calculates the full filtered summary and returns at most 100 records per page. Export explicitly retrieves every filtered page. Duplicate employee/date entries and invalid minute totals are checked in the browser and PostgreSQL.

The Attendance permission matrix supports View, Create, Update, Delete, Export and Manage. Administrator and HR Staff system roles receive these permissions; Viewer receives View only. Custom roles require explicit grants. Existing tenant isolation, record scopes, reset markers, file management and audit logs apply.

## Reasons for leaving

Employee editing, Employment Status and Lifecycle Event forms capture Leaving Classification, Primary Leaving Factor and Reason for Leaving. A new separation requires these details. AWOL pending review is Inactive, not a departure or automatic disciplinary finding. Status history preserves the submitted details. Employee imports and exports include the same fields. See [Employment Model](EMPLOYMENT-MODEL.md) for the separate contract type, operational status and dependent reason.

## Deployment

Apply `0031_workforce_attendance.sql` through the existing Supabase migration workflow. It adds attendance permissions, indexes, validation and a read-only paginated reporting RPC. It does not alter existing employees, cases or attachments. Reload the application after the migration to refresh effective permissions.
