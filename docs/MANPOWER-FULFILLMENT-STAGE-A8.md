# Stage A8: Quantity-Increase Amendment Foundation

Status: prepared, deployment gated; the overall specification is not complete.

## Scope

`supabase/proposals/0037_manpower_quantity_increases.sql` adds an authenticated, permission- and scope-checked quantity increase RPC for Open requests. Each transaction requires the current revision and a nonblank reason, preserves the original headcount and submission facts, increments the request revision, and stores typed before/after quantities linked to the existing audit event. Repeat calls with an old revision are rejected.

Submitted rows remain protected against direct mutation. Private exact-row transaction intents permit only the RPC's intended header/line update, not a client-settable bypass flag. Intent rows are removed on success; failures roll back quantities, revisions, audit/history and intents together. Amendment facts are append-only, tenant scoped and readable only with request access.

## Compatibility And Risks

- No automatic migration, backfill, legacy-record mutation or UI enablement. Supabase configuration, production attachments and existing RBAC architecture are unchanged.
- Requires verified registry/submission proposals 0035/0036. It replaces their submitted-record trigger function; inspect the live function and any additional triggers before promoting this proposal. Unexpected live customizations must be reconciled, not overwritten.
- Separate additive amendment facts preserve the initial submission history schema. At Stage A8, the read-only history UI displayed submission facts only. Stage A9 subsequently adds a separate read-only Amendments tab; amendment entry still requires a coordinated database/application release.
- Only increases are supported. Decreases, cancellations, close/reopen and full capacity accounting remain outstanding. Do not assume reserved/fulfilled counts are zero. This is a safe subset, not satisfaction of the specification's increase/decrease acceptance criterion.
- Do not promote based solely on local rehearsal: verify the production baseline, real RLS helpers, independent concurrent connections and complete live integration first.

## Validation

Run the isolated PostgreSQL rehearsal with an external PGlite dependency:

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-submission-rehearsal.mjs --amendments
```

Passed: initial submission safeguards; mandatory/oversized reasons; same/decreased quantity rejection; stale/repeated revisions; unauthorized, out-of-scope and cross-tenant access; two successive increases; immutable originals; distinct audit references; private-intent access denial; direct tampering and append-only facts; simulated audit failure with atomic rollback; session-flag spoof rejection; empty integrity-check results. PGlite is isolated and single-connection, not production or independent-concurrency validation.

Repository validation: `npm run lint`, `npm test` (234 passed), `npm run build` and `git diff --check` passed. No frontend changes were made; responsive/UI behavior is unchanged.

Commit remarks: document specification release gates and add deployment-gated, audited quantity increases without enabling unsafe decreases or altering existing UI.
