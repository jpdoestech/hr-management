# Stage B2: Versioned Identity Re-Review

Date: 2026-10-10. Status: locally rehearsed, deployment gated. Proposal 0039 follows 0038; no application or production writes enabled.

## Why This Slice Is Necessary

Stage B1 correctly rejects stale source fingerprints but has only immutable initial reviews. After an applicant record changes, identity evidence requires re-review; overwriting the old decision would erase history. Before reservation integration, this slice supplies an explicit versioned path.

## Behavior

- Original review rows and audit IDs are retained as revision 1. New decisions append a revision and reference the superseded audit event. No source applicant/employee is merged, edited or deleted.
- A separate current-link projection points to the immutable SamePerson fact. Its primary key permits one current employee link per applicant. Foreign keys ensure the pointer identifies a SamePerson fact, not a SeparatePersons event. Historical facts remain append-only.
- Preview reports the current pair revision and whether sources changed. Writes revalidate fingerprints, scope and the existing narrow permission, serialize per applicant, require the expected revision and a new reason, and commit audit/fact/current-link changes atomically.
- A reviewer must explicitly release the current link with a SeparatePersons decision before linking a different employee. Existing conversion links are never silently rewritten. Older six-argument RPC calls still permit initial reviews only; they cannot silently supersede prior decisions.
- Re-review is blocked where legacy slots reference the applicant/employee. It is also conservatively blocked if future reservation/deployment tables exist until their dependency-aware checks are integrated. This is an intentional temporary release gate, NOT a completed correction workflow for deployed workers.

## Compatibility And Risks

The proposal changes only the review table's key/index shape and adds immutable version metadata plus a projection. Inspect the actual live constraints and external references before promotion; it must not overwrite an unexpected deployed schema. No automatic migration or frontend enablement is introduced. No default permission grants.

The initial integrity script is specific to Stage B1; after 0039 use `manpower_identity_revisions_integrity.sql`. Historical fingerprints may legitimately differ from current sources; the newer diagnostic tests current sources only against latest pair decisions, while separately validating all audit/supersession chains and current pointers. A stale latest review is a re-review exception, never proof of a valid deployment identity.

Still outstanding: reviewer UI/Access Control catalog integration, duplicate discovery, effective-person resolution, dependency-aware corrections after assignments, reservation/deployment enforcement and independent multi-connection/production validation.

## Validation

`node tests/database/manpower-identity-rehearsal.mjs --revisions` passed with the external PGlite runtime: unchanged initial facts, stale-source refresh, mandatory reasons, revision/retry conflicts, single current link, release-before-relink, historical supersession chains, legacy dependency blocking, protected pointers/facts, anonymous denial and audit-failure rollback. Integrity SQL correctly distinguishes stale latest evidence from historical facts.

Repository lint, 241 tests, production build and diff checks passed. Tests use synthetic records only. PGlite does not validate independent connections or live RLS helpers.

Commit remarks: add append-only identity re-review revisions and a constrained current-link projection without merging source records or bypassing assignment dependencies.
