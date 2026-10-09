# Stage B1: Non-Destructive Identity Review Foundation

Date: 2026-10-10. Status: locally rehearsed proposal, not production enabled.

## Architecture And Scope

Existing applicants and employees remain JSON records in `hr_records`, modules `onboardingCandidates` and `employees`. The conversion path uses applicant `employeeRecordId` and employee `sourceCandidateId`. Proposal 0038 records an explicit HR comparison decision against these stable IDs without changing either source, creating a second employee/person master, inferring identity from names or copying government identifiers into the review table.

Preview and recording require `onboarding.view`, `employees.view`, the narrowly defined `onboarding.review_identity` permission and scope access to BOTH sources. The permission is added to the existing catalog with no automatic role grants. Access Control UI/catalog integration is still required before rollout. No browser workflow or existing hiring/deployment route is changed.

The reviewer supplies SamePerson or SeparatePersons and a mandatory reason. Source fingerprints are compared under locks; stale previews fail. Conversion-link contradictions, malformed source IDs, repeat decisions and a second SamePerson employee for one applicant are rejected. Critical audit and immutable decision commit together. Failures roll back both. The read-only integrity diagnostic detects missing, changed or mismatched sources/audit references without repairing them.

## Risks And Release Gates

Follow-on Stage B2 supplies versioned re-review for records without assignment dependencies; see `MANPOWER-FULFILLMENT-IDENTITY-REVISIONS.md`. The limitations below describe Stage B1's original boundary. Assigned-worker correction and UI/deployment integration remain gated.

- SQL remains outside automatic migrations. Live baseline, actual RLS helpers and independent concurrency must be verified before promotion.
- This is only initial-review infrastructure, NOT completed identity resolution. Duplicate discovery, reviewer UI, effective-person resolution, applicant conversion reuse, unresolved-identity deployment blockers and reservations remain outstanding.
- Initial decisions are immutable. Corrections/supersession and downstream dependency checks must be designed and delivered before enabling the review workflow for users. Never manually overwrite decisions to bypass that gate.
- Source edits/deletions do not mutate a historical review; the diagnostic flags them. Future deployment/reservation APIs must recheck current source validity and unresolved comparisons rather than trusting any historical SamePerson row.
- Fingerprints are stale-data tokens, not cryptographic identity evidence. A match does not prove identity; the HR reviewer must evaluate evidence. No automatic merge or destructive migration is introduced.

## Validation

`node tests/database/manpower-identity-rehearsal.mjs` with the external `HRIS_PGLITE_MODULE` runtime passed. Cases cover all three permission requirements, both-source scope and tenant denials, minimal preview, reason/decision validation, stale source rejection, two separate decisions, conflicting/repeated links, initial SamePerson uniqueness, both conversion-link directions, bad source IDs, immutable/direct-write denial, original attachment preservation, audit rollback and anonymous denial. Integrity SQL is executed against clean and deliberately stale synthetic facts.

Repository lint, 241 tests, production build and diff checks passed. PGlite is isolated/single-connection: production policies, deployment and independent concurrency remain unverified. No UI changes were made in this slice.

Commit remarks: prepare explicit, audited applicant/employee identity review without merging records or enabling unresolved identity/deployment workflows.
