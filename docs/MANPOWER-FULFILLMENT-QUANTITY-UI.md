# Submitted request inline quantity amendments

Specification: sections 4.3 and 5.2. Inspected latest `origin/main` at
`b22d8bc`, matching the local branch. This is one application workflow slice,
not completion of the specification or approval of a database release.

## Workflow

- Authorized users see Amend beside a line's authorized headcount on Open
  submitted requests. View-only, Closed and Cancelled views remain read-only.
- Edit one line at a time in place, with a positive integer quantity and a
  mandatory reason of 1-1000 characters. Original requested headcount and
  cancelled demand are never editable in this form.
- Save explicitly confirms the amendment and calls only
  `amend_manpower_quantity`, passing stable request/line IDs and the saved
  request revision. The existing database transaction authorizes tenant/scope,
  validates capacity under locks and records the amendment/audit atomically.
- Reserved (including scheduled) and valid historical fulfillment commitments
  are checked by the database, not approximated using the visible page.
- Discard retains the saved row and selected request/page. Switching lines,
  sections or pagination offers Save, Discard or Keep editing for dirty input.
  Ordinary workspace navigation reuses the existing page unsaved-change flow.
- Save restores the same request and pagination, focuses the line action and
  makes its audited change available in Amendments. Pending workspace
  navigation runs only after a successful commit.
- Busy guards cover confirmation, write and refresh. Duplicate clicks or
  navigation cannot reopen an editor using the just-superseded revision.
- Errors retain quantity/reason. Field errors have linked messages and a
  focused alert; missing RPC, authorization, revision and capacity failures
  do not silently become success or dismiss the form. Ambiguous network results
  require inspecting saved state/history before another attempt.

## Compatibility and security

No schema, historical migration, legacy request, attachment, Supabase public
configuration or production record changed during development. Proposal 0041
remains outside automatic migrations. The UI does not deploy or substitute for
that RPC; its existing baseline/registry/capacity/RLS release gates still apply.
No database server was installed or started. No new package was installed.

UI checks complement, not replace, server authorization. The full database
capacity is never inferred from a paginated worker list. Read queries stay
projected, scoped by RLS, and bounded to existing 10/25/50 page sizes.

## SQL setup and verification

These steps document the existing SQL requirements; they are not approval to
deploy proposals. No SQL is executed by this document or the frontend. Do not
install/start PostgreSQL for these steps. Supabase remains the current backend;
PostgreSQL compatibility does not require changing it.

1. Read [deployment procedures](DEPLOYMENT.md), inspect the target database's
   actual schema/migration history, and reconcile existing PRFs and historical
   commitments. Take a verified backup before an approved schema deployment.
2. Review/rehearse the existing proposal dependency sequence in a safe test
   environment: `0035_manpower_prf_registry.sql`,
   `0036_manpower_submission.sql`, `0037_manpower_quantity_increases.sql`,
   `0038_manpower_identity_reviews.sql`,
   `0039_manpower_identity_review_revisions.sql`,
   `0040_manpower_reservations.sql`, then
   [0041_manpower_quantity_amendments.sql](../supabase/proposals/0041_manpower_quantity_amendments.sql).
   These files live in `supabase/proposals/`, not automatic migrations. Do not
   replay already-applied SQL or bypass a proposal's schema/constraint guards.
   Unexpected baseline/legacy data requires reconciliation before proceeding.
3. Only after human approval and the existing release gates, follow the
   repository's ordered migration/release process for the reviewed changes.
   Do not copy proposal files into automatic migrations merely to enable a UI.
   Preserve RLS/RBAC, audit history and `SUPABASE_PUBLISHABLE_KEY` configuration.
4. Run the following **read-only** diagnostic in the target Supabase SQL Editor.
   It does not expose employee records or invoke a mutation RPC.

```sql
with expected(signature) as (
  values
    ('public.submit_manpower_request(text,bigint)'),
    ('public.amend_manpower_quantity(text,text,bigint,integer,text)'),
    ('public.change_manpower_lifecycle(text,bigint,text,text,text,integer)')
), routines as (
  select signature, to_regprocedure(signature) as oid
  from expected
)
select signature,
       oid is not null as installed,
       case when oid is not null
                 and to_regrole('authenticated') is not null
            then has_function_privilege('authenticated', oid, 'EXECUTE')
       end as authenticated_can_execute,
       case when oid is not null and to_regrole('anon') is not null
            then has_function_privilege('anon', oid, 'EXECUTE')
       end as anon_can_execute
from routines
order by signature;
```

For an approved, installed Supabase release, the public RPCs should report
`installed=true`, `authenticated_can_execute=true`, `anon_can_execute=false`.
Missing functions mean the corresponding workflow is unavailable, not that
permissions should be loosened. NULL privilege results can mean missing
Supabase roles (for example, a homelab compatibility environment). An installed
function or an EXECUTE grant alone does **not** prove tenant/scope authorization,
correct function contents, integrity or release readiness.

5. Run the applicable existing read-only integrity scripts only after their
   prerequisite tables/functions have been verified:
   [PRF registry baseline](../supabase/verification/manpower_prf_registry_baseline.sql),
   [submission](../supabase/verification/manpower_submission_integrity.sql),
   [quantity amendment history](../supabase/verification/manpower_quantity_increases_integrity.sql),
   and [reservation/capacity integrity](../supabase/verification/manpower_reservation_integrity.sql).
   Follow each file's documented expected results. Investigate violations;
   do not delete history or reset data to make a check pass. Keep any diagnostic
   identifiers/results private.
6. Verify authorized and denied actions through authenticated test accounts
   with synthetic data, including tenant/scope isolation, stale revisions,
   capacity limits and atomic audit rollback. SQL Editor owner privileges are
   not evidence of application RLS/RBAC behavior.

Lifecycle additionally requires reviewed proposals through
[0042_manpower_lifecycle.sql](../supabase/proposals/0042_manpower_lifecycle.sql)
and [lifecycle integrity checks](../supabase/verification/manpower_lifecycle_integrity.sql).
See [lifecycle prerequisites](MANPOWER-FULFILLMENT-LIFECYCLE.md). Its presence
in the diagnostic does not mean lifecycle UI or overall specification work is
complete. Later reservation/deployment workflows have their own dependencies
and release gates; this section is not a full-system deployment script.

## Validation evidence

Core/handler tests exercise payload validation, immutable baseline/cancellation,
read-only defaults, errors/accessibility, Save/Discard, revoked session/access,
changed input during confirmation, duplicate clicks, server errors, pending
navigation and busy-refresh protection. Existing submitted-workspace tests
retain bounded read and stale-response checks.

Synthetic browser fixture verified page-two Save retention (11-20 of 31),
Discard restoring the saved quantity, capacity-error input retention, and
missing-RPC errors. At 390x844 the editor is scrolled fully into its table
viewport with focused input and 44px touch controls. Desktop/tablet/mobile
document widths did not overflow; tables scroll within their existing region.
The fixture contains no credentials, employee data or real Supabase calls.

Full repository command results and publication are recorded in ROADMAP.
Live database/RLS/end-to-end acceptance is not claimed by synthetic UI tests.

## Remaining specification work

Reasoned close/cancel/reopen and line cancellation UI; submitted header/date/
numbering amendments; authoritative applicant reservation and deployment
workflows; identity and on-call UI; worker lists, timeline, reporting/exports;
legacy reconciliation and verified production release/security acceptance.

Commit remarks: add scoped inline authorized-headcount amendments with
mandatory reasons, shared confirmation/unsaved navigation, stable revisions,
retained request/page context and responsive accessible errors. Preserve
existing capacity/audit authority and all database release prerequisites.
