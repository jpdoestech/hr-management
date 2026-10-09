# Manpower Fulfillment: Stage A2 Draft Workspace

Date: 2026-10-09. Latest `main` inspected at `d0ffd71`. Implements the next bounded slice of the approved specification, not the complete Stage A gate.

## Delivered

- Manpower Fulfillment > Quantity Drafts, alongside Requests and Legacy PRF. Server-paged list (10/25/50) and PRF search; only results refresh while typing.
- Full-width draft editor: PRF header, catalog-backed Client Account, reporting branch, request/target dates, requester, priority, remarks and editable requisition lines. Add, Duplicate and Remove preserve independent stable line IDs. Department changes clear incompatible positions. Mobile uses a single column; tablet uses two; desktop uses four. View-only users can inspect existing drafts without mutation controls.
- Shared save confirmation and page Save/Discard/Keep Editing navigation. Dirty tracking includes line IDs, so replacing a row with visually identical values remains a change. Successful saves honor pending navigation; failures retain entries. Navigation is blocked while a save is pending.
- Migration `0034_manpower_draft_transactions.sql`: tenant-scoped header/line tables, draft-only constraints, manual normalized draft number uniqueness, checked atomic RPC, revision protection, scoped reads/writes and transactional audit. No anonymous/direct REST mutations. Catalogs are validated on the server; client/catalog rows are share-locked during validation. Entire draft visibility is required to edit, avoiding accidental removal of hidden lines.
- Incomplete drafts can omit fields/headcount. Entered quantities must be positive integers in the PostgreSQL integer range. A request for 100,000 workers remains one quantity line, not 100,000 empty slots. Original submitted quantities remain NULL because no submission has occurred.

## Compatibility and Rollout Gate

Deploy migrations 0033 and 0034 before using this workspace. Existing GitHub migration automation remains unchanged; this session cannot confirm its baseline gate/secrets or production applied versions. The application reports unavailable setup rather than creating fake records.

Legacy requests, requirements, worker slots, PRFs, attachments, employee histories, analytics, RBAC/RLS helpers and Supabase configuration remain intact. No legacy backfill, implicit client matching or source-row conversion occurred. Drafts are excluded from existing fulfillment totals and recruitment workflows.

**Submission is deliberately unavailable.** New-model uniqueness is enforced between drafts, and draft saves reject currently matching legacy request numbers. These provisional draft numbers are NOT a cross-model concurrency-safe allocation: legacy writers can still change numbers after a draft save. Before opening a request, implement an atomic registry/guard covering both models, diagnose existing duplicates, and protect old writers. Draft saves do not claim completion of that requirement.

Reservations, deployment credits, capacity reductions/cancellations, submission, original quantity history, outgoing-worker links, clipboard paste and attachments in the new editor remain subsequent slices. No workers can be reserved/deployed through this draft RPC, and database constraints prevent changing draft state or submitted quantities even through the ordinary write API.

The current site/branch list is reused; no separate site or client-under-branch master is inferred. Department-scoped users need every draft line within their allowed scope, unless the header's branch/resource scope already permits the whole request. Configured inactive/unknown values on an existing draft remain visible, but validation requires explicit correction rather than silently dropping them.

## Actual Validation

- `npm run lint`: passed, including structural and repository checks.
- `npm test`: 200 passed, zero failures; eight new draft/dirty-tracking/read-only tests.
- `npm run build`: passed, including new JS modules in ignored `dist/`.
- `git diff --check`: passed.
- Isolated PostgreSQL/PGlite rehearsal of migrations 0033/0034 with prerequisite/auth fixtures: atomic incomplete/two-line draft saves, 100,000 quantity without slots, current legacy and normalized draft duplicate rejection, stale revisions, catalog/position/site/date validation, invalid quantities/overflow, blocked submission/direct writes, tenant and department-scope denials, and audit failure rolling back both header and lines. Legacy attachment reference remained unchanged. No live Supabase schema/data was queried or changed; real concurrent connections and PostgREST relationship discovery remain unverified.
- Browser fixture using actual editor/orchestration code and repository CSS at 1280x800, 768x1024 and 390x844: no document horizontal overflow; department-position dependency, 1000-headcount row duplication, Save, reopen with two stable IDs, Remove and Cancel return verified. Shared confirmation and real authentication were not tested end-to-end against live Supabase.

Optional PostgreSQL rehearsal is preserved in `tests/database/manpower-draft-rehearsal.mjs`. It creates disposable in-memory fixtures only. Install `@electric-sql/pglite` in a temporary directory, set `HRIS_PGLITE_MODULE` to the file URL of that installation's `dist/index.js`, and run:

```powershell
node tests/database/manpower-draft-rehearsal.mjs
```

The default test suite has no new runtime dependency and does not require PGlite.

## Commit Remarks

Add an isolated full-width quantity draft workspace with atomic tenant-scoped persistence, catalog validation, revision checks and transactional audit. Preserve legacy fulfillment and gate submission pending cross-model uniqueness/capacity protection.
