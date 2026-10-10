# Submitted header amendments - MP-A15

Specification: sections 4.1 and 5.2. Inspected latest `origin/main` at
`04f7841`, matching the local branch. This is a locally validated implementation
slice, not a completed manpower release or approval to deploy SQL.

## Workflow

- Authorized users with current manpower view/update access can edit PRF
  number, Requested By, Date Requested, overall Target Deployment Date,
  Priority and General Remarks on Open submitted requests.
- A bounded inline editor reuses existing form tokens, shared confirmation and
  Save/Discard/Keep navigation. Mandatory fields and a reason of 1-1000 trimmed
  characters are validated; only changed allowed fields are sent.
- Client and reporting branch are deliberately unchanged by this transaction.
  Changing those attribution fields of committed demand needs a separate
  controlled correction workflow; this feature does not reinterpret deployed
  history or silently move request scope.
- Submitted dates must remain valid and ordered. The database checks all line
  target dates under locks, including lines outside the visible page. Overall
  target changes never reschedule reservations or rewrite actual deployment dates.
- Save confirms critical fields, rechecks session/permissions/revision/input,
  then calls `amend_manpower_header` only. Inputs/actions lock during confirmation
  and write; busy guards continue through refresh. Original submission metadata,
  immutable request/line IDs, quantities, cancellation and worker links remain.
- Success restores the same request/section/page and updated PRF breadcrumb.
  Discard does not leave the request. Duplicate PRF, stale revision, missing
  backend and validation errors retain input with focused linked error messages.
  Ambiguous results require inspecting saved state/history before retrying.
- Header History lazily reads request-scoped before/after facts and reasons in
  10/25/50 pages. Escaped keyboard-accessible disclosures show changed fields
  only. Missing storage is an error, not an empty-history claim; sibling sections
  remain navigable. Unified critical-event timeline work is still outstanding.

## Persistence and security

[Proposal 0058](../supabase/proposals/0058_manpower_header_amendments.sql) adds an
append-only, scoped RLS header-amendment table and one reasoned transaction API.
It reuses the current request advisory/row locks, private exact-row intents,
cross-model PRF registry and existing actor audit. It does not replace any
historical migration or submitted-record guard. The existing registry audit
continues to record normalized number changes; the typed header event links its
reason/before/after values to the central audit architecture.

Unknown patch fields, non-text values, invalid dates, invalid/unchanged values,
stale revisions and unauthorized/other-tenant/scoped-out callers are rejected.
Header, registry ownership, audit and typed history roll back together. History
is not writable by browser roles and cannot be updated/deleted through ordinary
owner SQL either. Existing legacy records/attachments are never rewritten.

No production SQL, configuration or publishable-key changes occurred. No server
was installed or started. Tests use the already available in-memory PGlite
engine outside application dependencies, with synthetic data only.

## Applicable SQL and rollout

1. Follow [deployment procedures](DEPLOYMENT.md), verify actual live schema,
   migration baseline/legacy conflicts and reviewed 0035-0042 prerequisites.
   Proposal 0058 also passed a combined rehearsal with proposals 0043-0057;
   this is compatibility evidence, not permission to deploy that whole chain.
2. Review/rehearse the authoritative
   [0058 SQL](../supabase/proposals/0058_manpower_header_amendments.sql) against
   the approved target baseline and verify backup/recovery before release.
   It stays in `supabase/proposals/`, outside automatic migrations. Do not replay
   existing proposals or bypass their guards. No data backfill is included.
3. With the existing human approval/release gates satisfied, use the repository's
   migration deployment process. Keep RLS/RBAC/audit and public configuration
   unchanged. This document does not authorize live execution.
4. The following diagnostic is **read-only** and does not change HR data:

```sql
select
  to_regprocedure('public.amend_manpower_header(text,bigint,jsonb,text)')
    as header_amendment_rpc,
  to_regclass('public.hr_manpower_header_amendments') as header_history;
```

NULL means the corresponding reviewed backend is not installed. Presence alone
does not verify function contents, grants or authorization. Use the
[RPC/EXECUTE diagnostic](MANPOWER-FULFILLMENT-QUANTITY-UI.md#sql-setup-and-verification)
and [header integrity SQL](../supabase/verification/manpower_header_amendments_integrity.sql)
after their prerequisites are verified. Every header integrity result should
be empty; do not reset/delete history to hide violations. Keep diagnostic
identifiers private. Test application authorization using authenticated synthetic
accounts, not owner SQL Editor privileges.

## Validation

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-header-rehearsal.mjs
$env:HRIS_REHEARSAL_DATABASE_URL=$null
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending --shared-intervals --transfers --operational-ending --replacement-sources --reversal-preview --credit-reversal --header-amendments
```

These are optional synthetic test commands, not production deployment commands.
Adjust the existing external module path to your test environment; do not install
or start a server as part of this workflow. The standalone header rehearsal
uses an in-memory engine only. The combined command above explicitly clears the
native database URL and does not use `--native-races`.

Standalone and combined rehearsals passed, including incomplete setup refusal,
normalized legacy/current duplicates, stale/state/type/date/reason denials,
scope/tenant/RLS/anonymous denial, registry/audit failure rollback, old-number
reuse, immutable original quantities/submission metadata, quantity/lifecycle
coexistence and zero header integrity violations. Active reservation/source
links and authoritative capacity stayed unchanged in the combined rehearsal.

Pure/handler tests cover validation, labels/escaping, read-only/state controls,
bounded history queries, verified response facts, duplicate saves, retained
errors, changed session/access/inputs, field locking and unsaved/pending navigation.
Synthetic browser checks passed for page-two Save/Discard, changed-field history,
duplicate errors, missing API/storage and sibling navigation. 390x844, 768x1024
and 1440x900 had no document horizontal overflow; forms use one mobile column,
two larger-screen columns, a 760px maximum and 44px mobile/tablet controls.
Full project validation/publication results are in ROADMAP.

## Remaining

Line target/site/purpose amendments; authoritative onboarding reservation and
deployment UI; identity/on-call eligibility; worker lists and unified timeline;
reporting/exports; legacy reconciliation and coordinated live database/RLS/
concurrency/end-to-end release acceptance remain incomplete.

Commit remarks: add controlled submitted PRF/header/date amendments with strict
field/revision/scope validation, atomic existing registry/audit integration,
append-only before/after history and responsive retained-context inline entry.
