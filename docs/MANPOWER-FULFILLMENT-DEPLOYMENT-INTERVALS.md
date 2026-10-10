# Deployment interval foundation (MP-B06)

## Scope and approved interpretation

The user approved the end date as the **first unassigned day**. Proposal 0045
therefore uses half-open `[actual_date, ended_date)` intervals. A transfer may
start on the old assignment's end date without overlap. Active deployments have
an open upper bound. This is a database prerequisite, not an enabled transaction UI.

- Tenant/employee GiST exclusion protects both active and historical primary
  deployments. Reversed records remain stored but are excluded from effective
  intervals and existing fulfillment accounting.
- Actual dates must be finite and no later than today's Manila business date.
  Ended assignments require a later end date; active assignments cannot carry an end.
- Day-granularity assumption: same-day start/end is an empty assignment and is
  rejected. Future dates belong in scheduling, not actual confirmation/ending.
- Existing incompatible dates or overlaps stop installation. No source records,
  history, attachments, permissions, RLS, or Supabase configuration are rewritten.
- `btree_gist` is required in `extensions`; a different existing installation
  stops installation instead of being silently relocated. Operator promotion
  requires verified extension availability and live baseline reconciliation.

## Validation

Synthetic PGlite PostgreSQL rehearsal passed in isolation and combined with
quantity amendments, lifecycle, identity refresh and scheduling. It verifies
historical and active overlaps, adjoining intervals, finite/current/past date
rules, rejection of future and empty intervals, historical fulfillment retention,
and reversal exclusion without record deletion. Existing private exact transition
intents are used to seed owner-only synthetic facts; this is **not** evidence of
an actual confirmation API, public ending/reversal authorization, or concurrent
independent database sessions.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --intervals
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals
```

`npm run lint`, all 245 `npm test` tests and `npm run build` passed.
Read-only verification: `supabase/verification/manpower_deployment_intervals.sql`.

## Release gates and remaining work

Proposal stays outside automatic migrations. No production database was accessed
or changed. Independent concurrency, live extension/baseline/data verification,
actual individual/bulk confirmation, conversion handoff, transfers, replacements,
reversals and coordinated UI remain outstanding. Do not mark Stage B complete.
