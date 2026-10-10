# Replacement outgoing references (MP-B16)

Proposal 0055 adds `link_manpower_replacement_sources(token, line_id, revision,
items)` and immutable outgoing references to the **existing** submitted Replacement
line model. Use the current draft/save/submit workflow to authorize new demand;
this API does not create another request workflow or reopen an original filled PRF.
It remains outside automatic migrations and does not enable application forms.

## Contract

Each item supplies `source_kind` (`reservation` or `operational`), `source_id`, the
current `source_fingerprint` from `preview_manpower_transfer`, and a mandatory
reason. One or several outgoing deployments may be linked atomically. Sources
must be genuinely `Ended`, not reserved, scheduled, active or reversed. The source
worker, actual date and first unassigned day are saved as historical evidence.
A PRF-backed source cannot be linked to its own original filled line.

The target must be a submitted Replacement line at its saved request revision.
Outgoing details may be added after closure/cancellation as historical information:
this does not reopen the request, reinstate cancelled capacity or authorize new
deployments. Draft/Expansion targets and stale source/request evidence are rejected.

References are **informative**, not capacity units or allocations of attrition.
They do not change requested/authorized/cancelled/reserved/scheduled/fulfilled
counts. A reference may appear on multiple separately authorized lines with explicit
reasons; it must not be summed as additional demand or credits. Each source is unique
within a line. Authorization of quantity remains with the existing PRF workflow.
Incoming worker hiring category remains separate from Replacement demand type.

Only an explicit actual confirmation against a new authorized reservation produces
a replacement fulfillment credit. Original outgoing fulfillment stays intact even
after the replacement deployment genuinely ends. Source employee/applicant master
records and employment status/type remain unchanged. No legacy records are inferred,
converted, deleted or silently reconciled.

## Security and transactions

The trusted RPC checks current tenant, employee/manpower view, manpower update,
target request scope and source deployment/employee scopes. PRF-backed sources also
require applicant view/scope through the existing primary-read helper. Preview and
reference rows do not expose government IDs, addresses or compensation. RLS requires
access to both source and destination; private retry payloads are not browser-readable.

The source interlock, target request mutex/row lock and sorted worker locks coordinate
existing mutation APIs. Canonical actor/tenant retry evidence supports reordered
selections, rejects changed payloads and reauthorizes current access. Audit, batch and
all reference inserts commit together; audit/late-second-row failures roll back all.
Per-source reason, dates, actor, timestamp and audit correlation are retained.
References and retry evidence cannot be rewritten/deleted through browser access.

## Validation

Synthetic PostgreSQL rehearsals cover both source types; individual/bulk links;
stale previews/revisions; active, draft, Expansion and original-filled-line rejection;
duplicate selections/references; mandatory reasons; tenant/role/source and destination
scope denial; immutable/private evidence; audit/late-row rollback; reordered and
revoked-access retries. The combined lifecycle rehearsal verifies late information
on a closed request without changing state or capacity.

A real reservation/actual-confirmation/ending sequence on the new replacement line
proves new credit occurs exactly once while outgoing historical credit and master
records remain unchanged. Read-only owner check:
`supabase/verification/manpower_replacement_integrity.sql`.

Verified locally: isolated and combined commands exited zero; replacement integrity
queries returned zero rows. Lint, 247 automated tests, production build, explicit
repository validation and diff checks passed. This backend-only slice does not
change rendered UI; no browser, independent concurrency or live acceptance claimed.

```powershell
$env:HRIS_PGLITE_MODULE='file:///path/to/@electric-sql/pglite/dist/index.js'
node tests/database/manpower-reservation-rehearsal.mjs --interlock --ending --shared-intervals --transfers --operational-ending --replacement-sources
node tests/database/manpower-reservation-rehearsal.mjs --lifecycle --identity-refresh --scheduling --intervals --confirmation --interlock --handoff --addresses --new-employee --ending --shared-intervals --transfers --operational-ending --replacement-sources
```

## Remaining gates

Still required: outgoing-reference UI/search and timeline/export integration,
audited correction of mistakenly linked references without erasing prior history,
controlled reversal blocking for replacement references and transfer descendants,
on-call rules, independent-session concurrency/authorization tests and live baseline/
migration acceptance. Shared helpers/RLS are exercised with synthetic test adapters,
not production policies. Stage B is incomplete; no live or production success claimed.
