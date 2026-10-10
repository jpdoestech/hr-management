# Shared primary interval prerequisite (MP-B13)

## Transfer architecture audit

Current `openTransferForEmployee`/`saveEmployeeTransfer` in `js/app.js` records a
department/position change in `DB.transfers`, updates the existing employee master
and adds history through generic persistence. It has no typed primary-deployment
interval, client destination, requisition credit or atomic old/new deployment
link. These organization changes are not automatically client deployments.

The quantity-based ledger represents PRF-backed actual deployments as existing
reservations. Its exclusion constraint cannot alone prevent overlap with a
non-credited operational transfer stored elsewhere. Giving every operational
transfer a requisition line would incorrectly consume or generate demand.

Proposal 0052 therefore prepares a **shared derived interval index**, plus guarded
storage for non-credited operational deployments. It is not a second capacity
engine, employee master, audit service, public transfer API or legacy migration.

## Prepared behavior

- Existing Deployed/Ended reservation intervals are copied unchanged into the
  private derived index under a source-table lock. No historical rows are rewritten.
- Reservation and operational source triggers keep that index transactionally
  synchronized. Its single GiST exclusion constraint covers all effective
  historical/active intervals per tenant and employee, using `[start, end)`.
- The reservation's original constraint remains in place. A rejected derived
  update rolls back the source write and restores the previous index entry.
- Non-credited rows have no requisition line or capacity credit. Source deployment,
  worker, client/branch/department/position, actual dates and audit references are
  explicit. Origin links preserve the worker and start on the prior first
  unassigned day; configured active destination values are validated.
- Only exact owner-private transaction intents permit inserts and genuine ending
  updates. Deletion and changes to original destination/identity facts are blocked.
  No browser mutation grant or public creation/ending RPC is introduced here.
- Shared interval protection rejects both current and historical cross-ledger
  overlaps. Adjacent operational chains are permitted. Active operational workers
  cannot also acquire a Reserved/Scheduled employee assignment.
- Additional source guards preserve active operational identity references and
  reject conflicting legacy slot/on-call writes, including name-based matches and
  module-shift updates. Existing source locks and guards remain intact.
- Private index/intents are inaccessible to browsers. Read-only operational rows
  require employee/manpower view plus both employee and destination scopes.

## Validation

Synthetic owner fixtures rehearse unchanged backfill, exact-intent enforcement,
destination/origin errors, cross-ledger overlap in both directions, rollback of
failed index synchronization, historical overlap rejection, adjacent operational
chains, private/RLS/browser-mutation denial, source/legacy/reservation conflicts
and unchanged PRF capacity. Owner integrity checks return zero rows.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending --shared-intervals
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending --shared-intervals
```

Read-only checks: `supabase/verification/manpower_primary_intervals.sql`.
Owner fixtures are not a verified public transfer transaction, production RBAC/RLS,
independent concurrency or large-history performance test.

Verified locally: lint, all 247 tests, production build, repository validation,
diff checks and isolated/combined PostgreSQL rehearsals passed. No app UI or
production database was changed or exercised by this prerequisite.

## Release risks and next work

Proposal 0052 stays outside automatic migrations. Verify the live extension,
confirmation/source/interval baseline, compatible history, lock behavior and
backfill size before promotion. Existing ambiguous legacy transfers/deployments
must be explicitly reconciled; do not invent client dates, worker links or credits.

The source tables retain history; the private index is a derived constraint
projection, not an audit ledger. Future controlled PRF reversal may remove a voided
interval from that projection without deleting the original source history.
Operational reversal is deliberately not supported by this proposal.

Next: one authorized atomic transfer transaction must close the prior deployment
and create its linked PRF-backed or non-credited destination, with reasons, stale
preview checks, audit/idempotency and rollback across both steps. Operational
ending, reversal/downstream blocking, on-call integration, existing department
transfer compatibility/UI and live acceptance remain required. No Stage B or
production completion claim.
