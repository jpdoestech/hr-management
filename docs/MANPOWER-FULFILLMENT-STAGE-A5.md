# Manpower Fulfillment: Stage A5 Submission Foundation

Date: 2026-10-09. Latest `origin/main` inspected at `378b530`, matching local HEAD. This is a backend proposal and validation slice, not a production submission release. Stage A remains incomplete.

## Delivered

- Deployment-gated proposal `supabase/proposals/0036_manpower_submission.sql`, requiring the cross-model PRF registry and enabled guards from proposal 0035. Existing requests are not submitted, converted or backfilled.
- `submit_manpower_request(id, expected_revision)` submits an already saved draft atomically. It uses the same advisory lock and row/revision checks as draft saves, existing `manpower.update` permission and scope checks. It introduces no extra approval stage.
- Required PRF number, active client, branch, requested-by, request/target dates and at least one complete line. Submission reuses the authoritative draft RPC to revalidate current department/position/site catalogs, quantities, dates, scope and duplicate numbers. Stale catalog selections are not grandfathered into submission.
- Original requested quantities are captured once, per line. Current authorization remains separate; cancelled-unfilled stays zero until the later controlled cancellation implementation. A single critical submission audit event is referenced by typed, append-only quantity-baseline facts.
- Submitted header/line mutation and line replacement/deletion are blocked, including attempts through the old draft-save RPC. Original quantities/history cannot be rewritten. Future amendments must deliberately extend these guards with capacity-safe transactions; they are not enabled here.
- History is read-only to authenticated clients, tenant/scoped using the existing request-read function. Unauthorized direct mutations and anonymous access are denied.
- Read-only post-deployment verification checks missing baselines, mismatched audit ownership and invalid draft/submission/history relationships.

## Compatibility and Release Risks

No Supabase configuration, production data, attachments, app files, styles, RBAC catalog or existing migration history changed. Proposal numbering must be checked before promotion; proposals are outside automatic deployment.

The new model has no reservations/deployments yet. Submitting captures demand, not employment or deployment. It creates one baseline fact per actual requisition line, not one empty worker record per requested headcount. Existing legacy manpower records remain separate and untouched.

The existing Quantity Drafts list/editor is not yet a submitted-request workspace. Do not expose this RPC to users or promote the proposal in isolation. Before production release:

1. Complete the A4 live schema/duplicate baseline and registry gate; verify backups and rehearse against a representative restored database.
2. Prepare the consistent submitted-request UI, confirmation flow, draft/submitted list separation, original/current quantity display and history navigation. Maintain server paging/search and responsive behavior.
3. Implement controlled amendments and capacity accounting before enabling quantity changes, cancellation/reopening or worker reservations. Submitted records are intentionally locked against ordinary edits in this slice.
4. Verify actual production policies and independent concurrent save/submit/duplicate writers, including retry behavior. Fixtures exercise permission and scope plumbing but are not a substitute for production RBAC/RLS tests.
5. Coordinate proposal promotion, backend deployment and UI enablement. Deployment locks quantity tables briefly, with a five-second lock wait and two-minute statement timeout; failure rolls back all schema changes.
6. Run `supabase/verification/manpower_submission_integrity.sql`; its three exception queries should return zero rows. Also recheck the A4 registry baseline and old/new writer behavior.

The proposal aborts on an unexpected pre-existing submitted quantity model rather than rewriting it. Standard draft saves remain available. Once submitted, ordinary updates/deletes are blocked even for privileged SQL writers unless the reviewed guard architecture is deliberately changed; coordinate maintenance/reset procedures before release. Do not work around safeguards by dropping data or disabling triggers.

## Actual Validation

- `npm run lint`: passed.
- `npm test`: 219 passed, zero failures.
- `npm run build`: passed.
- Actual proposal execution in isolated PostgreSQL/PGlite: passed. Tested prerequisite failure and transaction rollback, required header/line fields, stale revisions, permission/scope/tenant denial, inactive clients/positions, line-date validation, submission of 100000/1000 quantities, shared audit linkage, repeat-submission rejection, post-submit draft replacement rejection, direct mutation guards, scoped/anonymous history access and complete audit-failure rollback. Legacy attachment remained unchanged.
- The actual integrity-verification SQL executed against the rehearsal database and returned zero exception rows.
- No live database changes, production deployment, independent multi-connection concurrency tests or new browser checks were performed. No UI/layout files changed.

Reproduce with PGlite installed outside the repository:

```powershell
$env:HRIS_PGLITE_MODULE='file:///absolute/path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-submission-rehearsal.mjs
```

## Next

Continue the Stage A UI: desktop inline requisition rows/mobile expandable details, consistent submitted-request view/history, and controlled quantity amendments with reasons. Complete capacity and cancellation/reopening guards before Stage B reservations/deployments. Stage C monitoring, scoped exports and reconciliation remain outstanding.

## Commit Remarks

Prepare atomic saved-draft submission with immutable original quantities, scoped append-only baseline facts linked to existing audit events, and guards against post-submission draft replacement. Keep deployment/UI enablement gated; validate actual SQL and source preservation without touching production.
