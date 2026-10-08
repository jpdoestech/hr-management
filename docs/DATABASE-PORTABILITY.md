# Database portability

Supabase uses PostgreSQL, so the HRIS data model already runs on PostgreSQL. The ordered files in `supabase/migrations/` remain the production source of truth while Supabase hosts the application.

## Portable PostgreSQL layer

The following database features can move to a managed or self-hosted PostgreSQL service with little or no structural change:

- HR records, tenant, settings, case, due-process, evidence, monitoring, disciplinary-history, and access-control tables
- primary keys, foreign keys, constraints, indexes, JSONB fields, and generated query indexes
- PL/pgSQL validation, workflow, audit, and reporting functions
- transaction-wrapped schema migrations

## Supabase adapter layer

These dependencies must be replaced or recreated when moving away from Supabase:

- `auth.users`, `auth.uid()`, and Supabase Auth session claims
- `storage.buckets`, `storage.objects`, and Storage policies
- PostgREST RPC exposure and browser access through `@supabase/supabase-js`
- Supabase-managed RLS authentication context
- migration history currently maintained in `supabase_migrations.schema_migrations`

## Migration approach

1. Keep business tables and functions PostgreSQL-compatible and avoid new Supabase-only dependencies unless they belong to authentication, storage, or API exposure.
2. Introduce explicit identity and file-storage adapters before changing database providers.
3. Export the schema and data with PostgreSQL-native tools, excluding Supabase-managed schemas unless the destination provides equivalents.
4. Recreate session identity, permissions, secrets, backups, connection pooling, and file metadata in the destination environment.
5. Run the same application and RLS regression tests against a staging PostgreSQL database before cutover.

A plain PostgreSQL migration is therefore feasible, but moving only the database is not enough: authentication, object storage, and the API/RPC transport must migrate with it or be replaced.
