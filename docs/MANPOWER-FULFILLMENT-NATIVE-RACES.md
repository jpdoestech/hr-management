# Native PostgreSQL race rehearsal (MP-B19)

The reservation rehearsal now supports a test-only native adapter alongside its
existing PGlite mode. `--native-races` exercises independent backend sessions after
the full reversal prerequisite chain. No application dependency/configuration,
production credentials, database migration or deployed data changes are required.

## Safety boundaries

- Use a **new disposable cluster**, synthetic fixtures only, loopback binding and
  a non-default port. Do not use an existing application/production database.
- Native URL must use `127.0.0.1`, an explicit non-5432 port, user `hris_rehearsal`,
  database prefix `hris_rehearsal_`, no password/query options and the explicit
  `HRIS_NATIVE_REHEARSAL_ALLOWED=synthetic-only` opt-in.
- The adapter refuses a nonempty database (relations, functions or custom schemas).
  Initialization never drops/resets objects. Fresh databases in the same dedicated
  test cluster may reuse its synthetic authenticated/anon roles without alteration.
- `pg` is a test runtime dependency resolved through `HRIS_PG_MODULE`; it was
  installed outside the repository, not added to frontend/build dependencies.
  Date/bigint/JSON parameter normalization matches the existing fixture contract.
- Driver sessions have bounded statement/lock timeouts. Race sessions close in
  `finally`; the operator must stop the disposable server after the rehearsal.

Example after initializing a dedicated empty cluster/database:

```powershell
$env:HRIS_REHEARSAL_DATABASE_URL='postgresql://hris_rehearsal@127.0.0.1:65439/hris_rehearsal_test'
$env:HRIS_NATIVE_REHEARSAL_ALLOWED='synthetic-only'
$env:HRIS_PG_MODULE='file:///path/to/external/node_modules/pg/lib/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending --shared-intervals --transfers --operational-ending --replacement-sources --reversal-preview --credit-reversal --native-races
```

For the combined lifecycle/address/new-employee regression rehearsal, additionally
pass `--lifecycle --identity-refresh --scheduling --intervals --confirmation
--handoff --addresses --new-employee`. Use a fresh empty rehearsal database for
each run. Removing the native environment variables restores PGlite mode.

## Verified independent-session scenarios

Tests query `pg_stat_activity.wait_event` and `pg_blocking_pids` to observe the exact
waiting/blocking backend IDs; they do not use elapsed time as proof of exclusion.

1. Writer inserts interval attendance in an open transaction. Reversal waits on
   its advisory lock. After writer commit, reversal detects attendance, returns
   blocked diagnostics and performs no credit mutation. Removing the dependency
   permits the same uncommitted reversal token to succeed.
2. Reversal commits its negative credit only after holding an open transaction.
   A concurrent uppercase nested UUID reference waits, then rejects the committed
   reversed source. No invalid reference row is inserted.
3. A second session retries the same reversal token while the first transaction
   holds the lock. After commit it replays, with one history event and restored
   capacity exactly once.
4. A deliberate lock timeout raises `55P03`, leaves credit/history unchanged and
   succeeds on retry after the blocking transaction rolls back.
5. A separate tenant writes before the first tenant's transaction releases its
   lock, proving that mutex is tenant-specific rather than database-wide.

Reversal, confirmation, genuine-ending and shared-interval integrity queries run
after these scenarios. Permission/scope tests still use synthetic adapters; this
does not prove the deployed Supabase policies or real PostgREST behavior.

Verified on a disposable PostgreSQL 18.3 cluster: isolated and combined native
commands exited zero, as did PGlite regression after the adapter change. Integrity
queries returned zero rows. The nonempty-database refusal was exercised against
the earlier synthetic database. Lint, all 248 automated tests, build, explicit
repository validation and diff checks passed. The temporary server was stopped
and `pg_ctl status` confirmed no server running. No existing server/data was reset.

## Remaining acceptance

Targeted native ordering/retry tests are not general concurrency completion.
Still required: mixed conversion/identity/employee UPDATE lock-order/deadlock tests,
concurrent reservation/confirmation/transfer/quantity/lifecycle contention,
representative throughput and large-data performance, application retry UX,
actual deployed schema/external payroll dependencies and live RBAC/RLS acceptance.
Proposal 0057 and related gated proposals are not promoted by passing this harness.
