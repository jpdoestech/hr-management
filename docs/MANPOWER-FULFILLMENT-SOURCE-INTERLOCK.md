# Source-writer interlock foundation (MP-B08)

## Problem and boundary

Row locks on existing employees do not serialize a new employee insert against
the duplicate scan in a reservation or deployment transaction. Legacy on-call
and slot writes also need to participate in the same ordering. Proposal 0047
adds a **tenant-scoped transaction advisory lock**, not a global cross-tenant lock.

- Employee, applicant, on-call and legacy slot inserts/updates/deletes acquire it.
  Other record modules and ordinary reads do not acquire it.
- Reservation, release, scheduling, actual confirmation and both identity-review
  entry points acquire it before the existing request/identity/worker locks.
- Existing verified transaction bodies move to a new private schema. Public
  signatures, arguments, results, RBAC checks, RLS and audit behavior remain intact;
  wrappers call the original bodies rather than duplicating their implementations.
- The private namespace and helper/body execution are revoked from browser roles.
  An unexpected pre-existing private namespace stops installation, not overwrites it.
- The source trigger sorts tenant keys for tenant moves and runs before the
  existing source guard, so that guard reads committed assignment state after a wait.
- Conflicting new legacy slots and on-call records for a current primary deployment
  fail closed. The employee being replaced is not confused with the on-call worker.
  This is a compatibility guard, not the finished on-call eligibility/timing model.

READ COMMITTED and SERIALIZABLE are supported. REPEATABLE READ is rejected for
these writes/transactions because a transaction could retain a stale source
snapshot after waiting. No current employment or assignment facts are rewritten.

## Validation

Single-session synthetic PGlite rehearsals passed in isolation and combined with
quantity amendments, lifecycle, identity refresh, scheduling, interval constraints
and actual confirmation (including 75-worker atomic batches).

Verified private helper/body denial, transaction lock acquisition on source-only
writes, distinct keys for different tenants, no lock for an unrelated leave record,
repeatable-read rejection, serializable acceptance, legacy review-wrapper revision
protection, legacy slot/on-call conflicts, and the replaced-person distinction. Catalog checks are
in `supabase/verification/manpower_source_interlock.sql`.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock
```

Lint, 245 unit tests, build and repository validation passed. There was no local
`psql` or Docker command available; no live database was accessed. These checks
are not independent PostgreSQL-session concurrency acceptance.

## Required release checks

Proposal remains outside automatic migrations. Verify the live baseline and
function dependencies/owners/grants, private namespace, API schema cache and
transaction isolation before promotion. Unknown SQL callers bound to old function
identities require review; do not assume every caller is PostgREST.

Independent session tests must exercise both ordering directions for employee
insertion, source updates, legacy on-call/slot insertion, reservations and actual
confirmation, as well as unrelated tenants. Measure lock contention and timeouts.
Existing generic updates may lock a row before their row trigger waits: PostgreSQL
can detect a deadlock and abort a transaction. SERIALIZABLE can also abort a stale
transaction. Application retry/reload UX for `40P01`/`40001` must be verified before
release; do not retry a valid subset of a failed bulk operation.

Conversion handoff, candidate aliases, transfers/ending/reversal, full on-call
rules, coordinated UI and live acceptance remain required. This foundation does
not complete Stage B or claim production concurrency/performance readiness.
