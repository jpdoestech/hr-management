# Department and Position Import

In **Settings > Organization Structure > Import**, download the template or supply an Excel/CSV file with `Department` and optional `Position` columns. The first worksheet is read. Maximum: 2,000 rows and 5 MB.

- Blank positions import departments only.
- Department names and department-position pairs are matched case-insensitively, with repeated whitespace normalized.
- Duplicates are skipped; inactive entries are not reactivated. The completion summary shows added, skipped and client-assignment totals without listing every duplicate.
- If there are multiple active clients, select a client or use the shared catalog. With zero or one active client, no client selection is requested and the import continues as shared catalog entries.
- New client-specific entries store stable client IDs in `clientIds`. Existing client-specific entries can gain another client assignment; existing shared entries remain shared. These assignments do not retroactively change employee placements or restrict existing transaction workflows.
- `organization.manage` is required in the UI and database. Imports use an atomic settings-row lock, existing catalog validation and the central audit log. Invalid rows roll back the complete import.

## Database Setup

Migration `supabase/migrations/0060_organization_import.sql` is additive and requires the existing organization/access-control and Client Accounts migrations through `0033`. It does not depend on the manpower proposals. Follow `docs/DEPLOYMENT.md` for the reviewed migration deployment. No database reset is required.

Read-only verification after deployment:

```sql
select to_regprocedure('public.organization_import_clients()'),
       to_regprocedure('public.import_organization_structure(jsonb,uuid)');
```

## Employee Excel Template

The administrator-only employee template now includes Excel list validation for all non-address selection fields: department, department-linked position, branch, gender, civil status, employment type/status, status-linked reason, leaving classification and factor. Lists use the current configured catalog at download time and a hidden reference sheet. Validation covers rows 2 through 10,001. Regenerate the template after catalog changes.

Excel rejects invalid typed values, but pasting can bypass validation and changing a parent does not clear an already filled child cell. Existing application import validation remains authoritative and rejects invalid department-position or status-reason combinations. Addresses remain free text.

## Verification

### Template Repair (2026-10-12)

The original dropdown exporter inserted `dataValidations` after `ignoredErrors` when a worksheet had no page margins. That violates SpreadsheetML element ordering and can trigger Excel repair/open errors. The exporter now inserts validation before the first following worksheet element. Regression tests cover autofilters with and without page margins. Re-download the template after refreshing the app; existing downloaded files are not changed. All 321 tests, lint, production build and structural validation passed. Native Excel opening was not tested in this session.

- `npm run lint`, `npm run build`, and `node scripts/validate.mjs` passed.
- `npm test`: 320 tests passed, including the generated XLSX package and import parsing tests.
- `tests/database/organization-import-rehearsal.mjs`: actual RPC SQL passed synthetic in-memory duplicate replay, assignment, cross-tenant client denial, permission denial, rollback and audit checks. No PostgreSQL server was installed or started.
- Synthetic modal checked at 390, 768 and 1440 pixels with no page overflow; mobile inputs use 16px fonts and footer buttons meet 44px height. Zero/one client omits selection; multiple clients show selection. Backend/auth/confirmation are stubbed in this layout harness, not a live authorization test.
- Live Supabase migration deployment and native Excel interactive testing were not performed in this session.
