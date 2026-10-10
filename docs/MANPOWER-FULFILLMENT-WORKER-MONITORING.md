# Requisition line worker monitoring

Specification section 5.2; inspected current `origin/main` at `7b78604`, matching
local HEAD. This adds monitoring, not a parallel reservation workflow.

## Usage

Submitted Requests > Requisition Lines > line details > View workers.
Users need both manpower and onboarding view access. The selected line is shown
above the filters. Name/applicant/employee-ID search and assignment-state filters
are evaluated in the database before 10/25/50 pagination; filtered totals cover
permitted matching records, not just the current page. Return to Requisition
Lines preserves the prior line page. Search remains mounted during refresh so
typing focus is not lost; delayed reads are discarded after typing/navigation.

The list shows scoped applicant names, linked employee IDs, hiring category,
assignment state, reservation age for Reserved/Scheduled workers, scheduled date,
actual deployment date and ended date. It does not infer actual deployment from
onboarding or a schedule. Historical entries remain visible when permitted.
Empty matches and unavailable backend are distinct states. Errors retain search,
filters and return navigation. No sensitive source JSON or attachment is fetched.

Counts are **permitted worker counts**, not substitutes for canonical capacity
counters. RLS can hide worker identities while aggregate line capacity remains
available separately. Applicant names reflect the current scoped source record;
this is not a historical identity snapshot. There is no automatic expiry.

## Applicable SQL

Review [0059 SQL](../supabase/proposals/0059_manpower_worker_monitoring.sql) and
its existing submitted-request/reservation prerequisites against the actual
target schema. The function is read-only `security invoker`: current table RLS,
tenant/request/line checks and manpower/onboarding permissions remain enforced.
It returns a limited projection and filtered counts, not entire applicant JSON.
No tables, source records, audit rows or existing guards/policies are changed.

The proposal remains outside automatic migrations. Follow
[deployment procedures](DEPLOYMENT.md), confirm baseline/review and obtain human
approval before the normal release process. No production SQL was executed.

Read-only setup diagnostic:

```sql
select to_regprocedure(
  'public.manpower_line_workers(text,text,integer,integer,text,text)'
) as worker_monitoring_rpc;
```

NULL means setup is absent. Function presence does not prove correct contents,
grants, RLS or live access. Use authenticated synthetic accounts in a reviewed
test environment, not SQL Editor owner privileges, to verify authorization.

## Validation and Limits

Focused tests cover RPC parameters/bounds, invalid response rejection, source
escaping, labelled controls, source-access visibility, date/state/age semantics,
and SQL invoker/scope/pagination contracts. Existing in-memory rehearsal applies
0059 and uses 31 actual synthetic reservations to verify paging, case-insensitive
name search, literal wildcard handling, state filters, invalid input, mismatched
request/line, tenant/scope/permission/anonymous denial and no audit writes from
reads. This does not prove the production schema or large-collection performance.

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-header-rehearsal.mjs
```

This uses an existing external in-memory test engine; no server installation,
native database startup or production connection is involved. Adjust its module
path to the existing test environment.

Synthetic browser checks verified line/page context, page-two workers, off-page
name search, retained typing focus, empty state filter, missing-RPC guidance,
return navigation and mobile/tablet/desktop document containment. Mobile worker
search uses 16px text and a padded touch target; filter controls are 44px.

Still outstanding: source-workflow shortcuts, overdue warnings/configuration,
line metadata amendments, authoritative onboarding reservation/identity/
deployment/on-call transaction UI, request totals/timeline/reports, legacy
reconciliation and live end-to-end release acceptance. Full specification is
not complete. Project check results and publication are recorded in ROADMAP.

Commit remarks: add scoped server-filtered worker monitoring with stable line
context, retained search focus, responsive controls and no production mutations.
