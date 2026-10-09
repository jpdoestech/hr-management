# Manpower Fulfillment: Stage A4 PRF Number Safety Foundation

Date: 2026-10-09. Latest `origin/main` inspected at `2b32adb`; local HEAD matched it before this slice. Stage A remains incomplete.

## Delivered

- A private, tenant-scoped normalized PRF registry proposal guards both legacy `hr_records` manpower headers and quantity requests. It does not restrict employee PRF references or historical worker PRF records, which legitimately share request numbers.
- Existing duplicate header numbers are seeded with their existing owners, not silently renamed or deleted. Those owners can edit unchanged numbers; new owners cannot join an existing conflict. Renaming or deleting releases only that record's claim.
- Shared unique-row ownership checks protect direct legacy upserts and draft RPC writes together. AFTER ROW triggers avoid phantom claims from upserts or `ON CONFLICT DO NOTHING`. Source writes, registry changes and number-change audit entries commit or roll back together.
- Registry RLS is enabled with no client policies, and client roles cannot read/write it or directly execute its trigger helper. Existing source RLS/RBAC is unchanged.
- Draft backend errors now remain in the form. Duplicate errors describe and focus the PRF field; other errors focus an accessible error summary. Failed saves retain entries and dirty state, cancel pending navigation, and re-enable Save.
- A read-only baseline script lists cross-model duplicate owners, numbered/blank counts and source fingerprints for pre/post-deployment comparison.

## Deployment Gate and Risks

`supabase/proposals/0035_manpower_prf_registry.sql` is deliberately NOT in the automatically deployed migrations directory. No live database changes were made. Submission remains disabled.

Before promoting it into the next available migration number:

1. Verify the target project's tenant/access-control schema and migrations 0033/0034 are applied. Confirm backup/recovery readiness.
2. Run `supabase/verification/manpower_prf_registry_baseline.sql` against the target and retain its output. It requires 0034. Review duplicate owners with HR; this proposal preserves them, but does not decide which conflicting historical request is authoritative.
3. Rehearse against a representative restored database, with actual production RLS policies and independent concurrent connections. Include simultaneous legacy/new-model inserts, conflicting renames, deletions, retryable serialization/deadlock errors, and unauthorized tenants.
4. Review the new legacy-writer behavior: a newly duplicated header number now fails the entire transaction. Existing blank numbers remain allowed. Existing duplicate owners remain editable.
5. Promote only after approval and confirmed migration numbering. Deployment briefly locks both source tables against writes; it aborts after a five-second lock wait or two-minute statement timeout. A failure rolls back the entire proposal; do not bypass the lock or manually remove source data.
6. Repeat the baseline fingerprints, check trigger/registry installation and authorized saves, and then consider the separate submission release gate.

Identity changes to request IDs/tenants are rejected. Existing quantity foreign keys may reject linked-ID changes before the new guard. No source tables, records, attachments, keys or Supabase configuration are rewritten.

## Actual Validation

- `npm run lint`: passed.
- `npm test`: 217 passed, zero failures. Includes executed save-handler tests for duplicate/revision errors, retained draft/dirty state, focus and re-enabled controls.
- `npm run build`: passed.
- Isolated PostgreSQL/PGlite rehearsal executed actual migrations 0033/0034 and the proposal: passed. Verified unchanged source snapshots/attachments, seeded duplicates, both write directions, tenant isolation, blank numbers, claim release/reuse, upsert/do-nothing behavior, whole-batch rollback, stable IDs, authenticated draft RPC integration, audit-failure rollback and private registry privileges. The read-only baseline also executed successfully.
- No live Supabase migration, actual production-policy test, independent multi-connection concurrency test, or new browser/screen-reader test was performed. Form layout/styles are unchanged; accessibility behavior was exercised through the real save handler with a DOM fixture.

Optional isolated rehearsal (requires PGlite installed outside the project):

```powershell
$env:HRIS_PGLITE_MODULE='file:///absolute/path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-prf-registry-rehearsal.mjs
```

## Remaining

Stage A: verified registry deployment, submission/original-current quantity history, desktop inline rows/mobile details, reasoned amendments and close/cancel/reopen capacity rules. Stages B/C: worker reservations and links, scheduled/actual deployments and intervals, transfers/replacements/reversals, conservative on-call eligibility, monitoring/timeline, scoped exports and reconciliation/performance/security validation.

## Commit Remarks

Prepare cross-model tenant-scoped PRF ownership safeguards without rewriting historical records; keep SQL deployment gated pending live baseline verification. Retain draft entries and provide accessible inline backend-save errors, with executable PostgreSQL and save-handler regression tests.
