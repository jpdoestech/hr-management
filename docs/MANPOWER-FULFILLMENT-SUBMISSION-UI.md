# Manpower saved-draft submission UI

Scope: specification sections 4.1, 4.4 and 5.1. Repository inspected at
`a51d9c1`, matching freshly fetched `origin/main`. ROADMAP is a progress log,
not authorization for work outside the approved specification.

## Workflow

1. Enter the header and requisition lines in Quantity Drafts. Save Draft still
   permits incomplete entries and returns to the draft list.
2. Reopen the saved draft and select Review & Submit. Complete PRF number,
   active client, reporting branch, requested by, dates, department/position
   and positive quantities are required. Unsaved changes and unapplied paste
   must be resolved before review.
3. Review the saved header, lines and aggregate headcount in the existing
   full-width editor. Back to editing preserves all entries.
4. Submit / Open Request opens the shared confirmation dialog. Cancel leaves
   the review intact. Confirmation rechecks the current session, permission,
   saved revision and reviewed values before calling `submit_manpower_request`.
5. Successful submission opens that request's submitted details. Missing RPC,
   duplicate number, stale revision and denied access show a focused error
   without clearing the editor. An ambiguous network result is not automatically
   replayed: reload and inspect the request state before retrying.

Only the existing server transaction can open the request; no direct table
write, legacy-slot fallback, worker reservation or deployment is performed.
Review controls are unavailable to view-only users and users lacking
`manpower.update`. UI permission checks do not replace backend scopes/RLS.

## Release boundaries

No SQL, migration, backend service or public Supabase configuration changed.
Proposals 0035/0036 remain outside automatic migrations. Their documented
baseline, registry, authorization and integrity checks still require approved
deployment verification. The UI cannot enable a missing backend. Installing
the RPC is a separate reviewed release operation, not an action of this UI.

This slice does not complete Stage A or the specification. Inline submitted
amendments and lifecycle controls, authoritative onboarding reservations and
deployment UI, identity/on-call workflows, unified monitoring/reporting and
live end-to-end/security acceptance remain outstanding.

## Validation

- Automated review and actual handler tests: complete/partial drafts, catalog
  validation, unsaved edits, escaped content, cancel/denial, changed review,
  simultaneous clicks, success navigation and missing/stale/denied backend.
- Local browser fixture uses synthetic data and a missing-RPC mock only;
  no Supabase connection or confidential records.
- Full repository checks and responsive fixture results are recorded in
  ROADMAP after execution. No PostgreSQL server was started or installed.

Commit remarks: connect saved quantity drafts to explicit review and the
existing scoped submission RPC; preserve draft entries, release prerequisites,
legacy workflows and responsive shared styling.
