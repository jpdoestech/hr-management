# Manpower Fulfillment: Stage A1 Foundation

Date: 2026-10-09. Follows the approved specification and Stage A audit.

## Delivered

- Settings > Client Accounts: administrator-only add, edit and deactivate; database search and pagination (10/25/50). Existing shared styling, modals, change confirmations and unsaved-change handling are reused.
- Migration `0033_manpower_client_catalog.sql`: tenant-scoped client IDs, normalized unique names, RLS reads, checked mutation RPC, revision conflict detection, transactional audit. Browser REST writes and anonymous access are denied. No delete operation; deactivation preserves future references.
- Preview quantity utilities: canonical PRF normalization and the approved capacity equation. Scheduled reservations count once; ended deployments retain historical fulfillment credits. Invalid quantities and negative capacity fail explicitly. Quantities of 1000+ do not create placeholder slots.

## Architecture Amendment

The audit proposed clients inside tenant settings JSON. A dedicated small relational table, `hr_manpower_clients`, is used instead: it supports stable future foreign keys and atomic uniqueness/revision checks without stale whole-settings saves overwriting concurrent catalog changes. The UI remains in Settings. No additional person master or replacement audit/RBAC architecture is introduced.

Catalog mutation requires an Administrator/superadmin AND effective `settings.manage` permission, checked again by the database. Read access requires the current tenant and `manpower.view` or `settings.manage`. Future scoped request access must validate the parent PRF independently; catalog visibility is not permission to access every request.

## Deployment and Preservation

Deploy migration 0033 before using Client Accounts. The existing GitHub migration workflow may apply it when its baseline gate and secrets are configured; this session cannot verify that deployment state. Missing migration produces setup guidance and Retry, not fake catalog records.

No legacy PRFs, requisition lines, slots, employees, attachments or Supabase configuration were modified. No client records were inferred from ambiguous legacy names. There is no backfill or frontend cutover of the legacy fulfillment workflow in this slice. Production database baseline/reconciliation remains pending authorized access.

## Validation

- `npm run lint`: passed.
- `npm test`: 192 passed, zero failures (10 new client/demand tests).
- `npm run build`: passed; output in ignored `dist/`.
- `git diff --check`: passed.
- Migration 0033 executed in isolated PostgreSQL/PGlite with representative prerequisite/auth fixtures: create/edit/deactivate, normalized duplicate rejection, stale revision rejection, cross-tenant isolation, non-admin denial even with permission override, denied permission reads/writes, direct REST-style write denial, anonymous denial and rollback when audit insertion fails. These fixtures are not a full production migration-chain or Supabase/PostgREST test.
- Isolated browser fixture using the actual catalog functions and repository CSS: 1280px desktop, 768px tablet, 390px mobile; no document horizontal overflow. Search, 10-to-25 pagination change, Add modal and Cancel verified. Authentication and shared confirmation behavior were not exercised end-to-end against live Supabase.

## Next Implementation Slice

Stage A is NOT finished. Next: versioned PRF/line persistence, normalized uniqueness across legacy and new headers, transactional quantity/capacity guards, and a full-width multi-line draft/submit editor behind a safe rollout gate. Then authoritative onboarding reservations, identity review and deployment transitions. The new quantity utilities are preview calculations, not a substitute for database locking or server capacity enforcement.

The approved conservative on-call eligibility rule remains a Stage B requirement; it has not been enabled by this catalog release.

## Commit Remarks

Add administrator-managed Client Accounts foundation with tenant RLS, atomic revision-checked saves and audit; introduce tested quantity capacity previews; preserve the legacy PRF workflow pending transactional modernization.
