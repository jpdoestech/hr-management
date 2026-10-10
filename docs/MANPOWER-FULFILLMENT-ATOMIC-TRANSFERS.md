# Atomic primary transfer backend (MP-B14)

Proposal 0053 adds `preview_manpower_transfer(kind, id)` and
`transfer_manpower_deployment(token, kind, id, fingerprint, destination, date,
reason)`. It covers both PRF-backed and operational sources, and both credited
requisition and non-credited operational destinations in **one transaction**.
It does not release the UI or replace the existing department-transfer form.

## Transaction behavior

- The selected source must be an active typed deployment, currently scoped to the
  caller. Its canonical database fingerprint prevents stale source transactions.
  Preview returns only necessary worker/name, state/date and fingerprint fields;
  no government IDs, addresses, compensation or applicant details are disclosed.
- The actual transfer day is the prior assignment's first unassigned day and the
  new assignment's start. Mandatory reasons support retroactive dates. Empty,
  future and non-finite intervals are rejected; shared historical exclusion applies.
- PRF sources close through the existing ending API. Operational sources close
  through exact private intents, preserving original destination/worker facts.
  The old historical PRF credit remains valid in both paths.
- A credited destination reuses reservation and explicit actual confirmation for
  one authorized open submitted line. Capacity and current identity evidence must
  pass; the resulting worker must be the original employee. The same worker cannot
  consume another credit on a previously valid credited line. Use genuinely new
  demand/replacement lines instead of re-counting the original filled requirement.
- A non-credited destination validates configured active client/branch/department/
  position fields and creates a linked operational deployment without a line or
  PRF capacity credit. A null client permits an internal operational destination.
- Source employee/applicant records, employment status/type, organization master
  fields and compensation remain unchanged. This is a **primary deployment**
  transfer, not the existing agency department/position change. Their coordinated
  UI/master-update integration remains a separate requirement; no legacy transfer
  is silently reinterpreted as a client deployment.
- Employee/manpower view and manpower update are mandatory. PRF source access also
  needs applicant view/scopes. Credited destinations require applicant view/update
  and target request scopes; operational destinations require destination/new-row
  scopes. Current authorization is checked before mutations and on retries.
- Source interlock and sorted request, identity and worker locks coordinate reused
  APIs. Legacy/on-call conflicts require reconciliation, not silent mutation.
- One transfer audit/history event links the source/destination, worker, reason,
  actual date and recording timestamp. Reused material ending/reservation/actual
  audit events remain intact; future unified timeline UI must correlate them.
- Private immutable actor/tenant-scoped retry evidence rejects changed payloads and
  reauthorizes both deployments. Retries do not reserve or credit twice, even after
  subsequent transfers. Any capacity, catalog, audit or late history failure rolls
  back the source ending, new assignment, child evidence and interval projection.
- History is read-only and RLS-protected by both deployment scopes. Private batch
  payloads and intents remain inaccessible to browser roles.

## Validation

Synthetic isolated and combined PostgreSQL rehearsals cover all four source/
destination combinations, exact original/new credit accounting, unchanged master/
applicant data, capacity exhaustion, scoped destination denial, stale previews,
date/reason/catalog errors, repeat-credit prevention, permission/tenant/anonymous
denial, audit and late PRF/operational destination rollback, chronological linked
history, later-transfer replay, revoked retry access, private storage and immutable
history. Shared interval and transfer integrity queries return zero rows.

Repository validation: lint, all 247 automated tests, production build and explicit
`node scripts/validate.mjs` passed. Both rehearsal commands below completed with
exit code zero using synthetic data only. These are local results, not independent
concurrency, production migration or live authorization acceptance.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending --shared-intervals --transfers
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending --shared-intervals --transfers
```

Read-only owner checks: `supabase/verification/manpower_transfer_integrity.sql` and
`supabase/verification/manpower_primary_intervals.sql`.

## Release gates

Proposal 0053 depends on the verified ending/shared-interval baseline and remains
outside automatic migrations. No production data, configuration or applied
migration changed. No current application form is switched to this API.

Still required: coordinated transfer/department-master UI and live baseline,
standalone operational endings, replacement demand links, controlled reversal and
downstream blocking (including transferred descendants), on-call rules, unified
timeline/analytics/export integration, independent-session lock/retry/performance
testing and live authorization/acceptance. Full Stage B is not complete.
