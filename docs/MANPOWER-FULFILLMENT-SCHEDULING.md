# Reservation Scheduling Foundation - MP-B05

Status: locally rehearsed proposal. No production deployment or scheduling UI enabled.

## Transaction

`supabase/proposals/0044_manpower_scheduling.sql` adds `schedule_manpower_reservation(reservation, expectedRevision, plannedDate, reason)`:

- Reserved/Scheduled assignments on Open requests can receive or change a planning date. Passing null clears the schedule, returning to Reserved without releasing capacity.
- A monotonically increasing schedule revision rejects stale edits, including an ABA date change (A to B to A). No-op dates are rejected; callers reload after stale requests rather than blindly retrying.
- New planning dates are today or later using Asia/Manila business dates. Historical planning corrections remain a separate reconciliation gate; old overdue plans do not automatically expire.
- A reason of 1-1000 trimmed characters is required. Existing onboarding update/view, manpower view, tenant and request/candidate scopes are enforced. Resolved employee view/scope is also rechecked.
- Shared request, identity and worker locks plus reservation/source row locks coordinate with release and quantity/lifecycle transactions. Only exact private transition intents permit the update.
- Schedule history and the existing critical audit event commit atomically. A scheduled assignment stays Reserved for capacity purposes; actual dates and fulfillment credit remain untouched.
- Existing release works with the new column and keeps plan/history facts. Released or confirmed assignments cannot be rescheduled through this RPC.

The additive revision column defaults to zero; existing records and planned dates are preserved, not fabricated into audit facts. Any pre-existing revision-zero plans require baseline reconciliation before deployment. The proposal remains outside automatic migrations; no configuration, applied migration or source record is modified.

## Validation

```powershell
$env:HRIS_PGLITE_MODULE='file:///C:/Users/USER/AppData/Local/Temp/hris-workforce-validation/node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --scheduling
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling
```

The external PGlite environment and synthetic sources contain no production credentials or employee records. Tests cover schedule/reschedule/clear, ABA revisions, mandatory reasons, past-date denial, permissions/scopes/tenant/anonymous denial, linked employee access, schedule history RLS, direct-write guards, unchanged fulfillment/actual dates, release after scheduling, and atomic audit rollback.

`supabase/verification/manpower_schedule_integrity.sql` checks private intents, audit references, revision/date/state continuity and current-history consistency. Tests return no violations. It deliberately does not certify unreviewed revision-zero legacy plans; those require baseline reconciliation.

Lint, 245 tests, production build and diff checks passed. Backend-only slice; no new browser-validation claim.

## Remaining Scope

This does not implement actual deployment confirmation, applicant conversion, bulk scheduling/confirmation, backdated historical planning, transfers/replacements/reversals, on-call eligibility, scheduling UI, unified reporting, independent concurrency or live authorization acceptance. The specification remains incomplete and production enablement is gated.
