# Line capacity monitoring

Specification sections 4.3 and 5.2; inspected `origin/main` at `bcdda88`, matching
local HEAD. This connects existing capacity accounting, not a second reservation
engine or a claim that the full manpower specification is complete.

## Behavior

Submitted request > Requisition Lines > line details > View capacity reads only
that line's existing `manpower_line_capacity(text)` RPC. Refresh is explicit;
opening a request does not load all reservations or make one RPC per line.
Original/current/cancelled/effective/reserved/scheduled/historically fulfilled/
active deployed/available counters are validated as nonnegative safe integers
with the canonical capacity equation and subset relationships before display.
Scheduled remains a subset of Reserved. Genuine ending retains fulfillment;
reversed credits do not count. Progress is derived from fulfillment, not from
administrative closure/reopening or future schedules.

Reads are duplicate-click guarded. Navigation, revision, session and permission
changes discard late results. Errors are announced and retryable, do not expose
raw database messages, and never substitute fake zero totals. Existing inline
editing, paging and table scrolling remain unchanged. No worker identity data
is fetched. Request-wide totals, worker lists, onboarding transactions and the
unified timeline remain outstanding.

## Applicable SQL

No new SQL or historical migration changes are needed for this UI. It depends
on the existing reviewed [0040 reservation/capacity proposal](../supabase/proposals/0040_manpower_reservations.sql)
and its prerequisites. Follow [deployment procedures](DEPLOYMENT.md) and verify
the target baseline before any authorized release; do not blindly replay the
proposal or weaken guards to enable the UI.

Read-only presence/permission diagnostic:

```sql
select to_regprocedure('public.manpower_line_capacity(text)') as capacity_rpc;
select has_function_privilege('authenticated',
  'public.manpower_line_capacity(text)', 'EXECUTE') as authenticated_execute;
```

Run the second query only if the first returns a non-NULL function. Presence or
EXECUTE privilege does not prove function contents, scope enforcement or correct
capacity. Verify using authenticated synthetic accounts in a reviewed test
environment. SQL Editor owner privileges are not an RLS acceptance test.
Missing RPC produces setup guidance; inconsistent or legacy commitments require
reconciliation, not data deletion/reset. No production SQL was executed.

## Verification

Eight focused tests cover canonical arithmetic, integer limits/subsets, scoped
RPC payload/error propagation, progress meaning, lazy escaped controls, safe
error messages, double clicks, stale reads and retry/access guards. Synthetic
browser checks verified real disclosure rendering, refresh, missing-RPC error,
contained table scrolling and no document overflow at 390, 768 and 1440 pixels.
The tablet grid was adjusted to two columns after the initial sizing check.
No live Supabase/RLS validation is claimed. Full repository results and the
publication reference are recorded in ROADMAP.

Commit remarks: connect lazy authoritative line capacity monitoring without
worker hydration, duplicate formulas, new tables or configuration changes.
