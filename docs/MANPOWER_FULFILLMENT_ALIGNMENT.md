# Manpower Fulfillment: Current-System Alignment

## Existing capabilities to reuse

- `hr_records` already provides record-level Supabase persistence, timestamps, RLS, server filtering, and reset protection.
- Employee Information is the employee source of truth and already uses stable employee record IDs.
- Onboarding & Applicants already tracks candidates, onboarding readiness, PRF reference, and conversion to an employee.
- Organization Structure already owns departments and positions. Settings owns branch reporting locations.
- Employment Lifecycle, Department Transfers, and employee `employmentHistory` already retain dated workforce movement.
- Workflow & Approvals, audit logs, confirmation dialogs, employee autocomplete, responsive data tables, pagination, export permissions, and attachment routing are reusable.

## Current conflict

The existing `prf` module is a flat record centered on one employee name. It cannot represent one PRF with multiple requested positions, requested headcount, partial fulfillment, or staggered onboarding and deployment dates. Its `employeeReplaced` value is linked to an employee where possible, but it is not linked to an exit event.

## Additive model

The implementation adds three record modules while preserving existing `prf` rows:

1. `manpowerRequests`: PRF/request header, branch/site, request and target dates, requester, priority, owner, status, notes, and attachment.
2. `manpowerRequirements`: position/department/designation, requested headcount, expansion/replacement type, qualifications, and target-date override.
3. `manpowerSlots`: individual fulfillment position, candidate/employee link, selected/onboarded/deployed dates, replacement employee link, source exit date/reason snapshot, assignment details, and status.

Relationships use stable IDs: requirement to request, slot to requirement/request, and slot to employee/candidate/replacement employee. PRF numbers remain optional and non-unique because one PRF may cover multiple requirements and employees.

## Navigation and consolidation

The existing `People & Records > PRF` navigation entry becomes `Manpower Fulfillment`. It replaces the flat PRF screen as the primary operational workspace. Existing `prf` records remain accessible in a Legacy PRF view for reconciliation and future migration.

## Metrics and lifecycle integration

- Time to Onboard = onboarded date - request date.
- Deployment Lead Time = deployed date - onboarded date.
- Total Fulfillment Time = deployed date - request date.
- Deployment Variance = deployed date - target deployment date.
- Replacement Lead Time = deployed date - replaced employee exit date.
- Request status and SLA risk are derived from requirement and slot state instead of stored as ambiguous editable durations.
- Confirming deployment links the employee to the slot and appends a deployment event to the employee employment history.

## Migration and compatibility risks

- Legacy rows may contain repeated PRF numbers, unmatched employee names, negative date intervals, encoding damage, and Google Sheets-only formulas. Imports must preserve source values and flag these anomalies.
- Existing flat PRF records cannot be deterministically grouped without a preview because repeated PRF numbers can represent either multiple deployments or duplicated source data.
- Replacement exit events are currently represented by employee status/history rather than a dedicated separation table. The slot stores the selected exit date/reason snapshot and employee reference until a dedicated workforce-event phase is introduced.
- No destructive database migration is required for the foundation because the current generic `hr_records` model supports additive modules under existing RLS policies.

## Workbook findings

- `ENCODE` has 183 populated operational rows: 143 expansion slots, 39 replacement slots, and one row without a usable type. Only 80 rows have PRF values, confirming that PRF is optional in the legacy process.
- `DEPLOYED EE MTRG - internal` has 66 populated PRF rows and 37 employee-name rows. It contains 53 unique PRFs; seven PRFs occur more than once, including one PRF with six deployment rows. This confirms that one PRF can produce multiple employee deployments.
- The workbook's `TIME TO HIRE` formula is deployment date minus request date. The application labels this Total Fulfillment Time / Time to Deploy.
- The source includes seven missing request dates, six missing onboarding dates, eight missing deployment dates, 103 missing PRFs, 96 zero-day fulfillment intervals, two negative request-to-deployment intervals, and numerous onboarding dates earlier than request dates. These values must be preserved and flagged during import.
- Workbook formulas are not imported as business logic. Source dates and identifiers are authoritative; formula errors, prefilled formulas on otherwise empty rows, and Google Sheets compatibility issues are treated as legacy data-quality findings.
