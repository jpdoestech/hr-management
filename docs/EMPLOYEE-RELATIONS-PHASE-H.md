# Employee Relations Hardening: Phase H Evidence Register

Phase H closes the structured investigation gap identified after the Phase G acceptance audit. It adds a case-level evidence register without moving or rewriting existing Incident, CVR, response, hearing, case-link, or attachment data.

## Required setup

1. Deploy the application files from this release.
2. Confirm migrations through Phase 28 have already been applied.
3. Open **Supabase Dashboard > SQL Editor**.
4. Run `supabase/phase29-employee-relations-evidence.sql` in full.
5. Reload the HRIS.
6. Open an HR Case and use **Investigation Evidence**.

## Behavior

- Evidence is attached to one stable HR Case and tenant.
- Supported types include statements, interview notes, attendance records, photos, CCTV references, messages, client reports, policy documents, and other supporting material.
- Source, evidence date, collection date, collector, custodian, external reference, summary, and managed file attachment can be recorded.
- Files use the System Administrator's existing Supabase Storage or Google Drive routing configuration.
- Evidence can be archived and restored. Normal UI actions do not physically delete evidence or its file.
- Existing case files and source-module attachments remain available in their original records.

## Data safety

The migration is additive, transaction-wrapped, tenant-scoped, protected by the existing Employee Relations permissions and record scopes, and mirrored in `database/migrations/`. It performs no update, delete, or backfill against production case records.
