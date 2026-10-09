# Supabase database

This directory is the single source of truth for the HRIS database.

## Structure

- `migrations/` contains the ordered Supabase CLI migration history. Files run once in numeric order.
- `maintenance/` contains destructive or operator-invoked utilities. These files never run during deployment.
- `verification/` contains read-only post-deployment checks. These files never run during deployment.
- `proposals/` contains reviewed but deployment-gated SQL. Files do not run automatically; promote them to the next ordered migration only after their documented prerequisites and live baseline are verified.
- `config.toml` contains local Supabase CLI configuration. It contains no credentials.

## Migration rules

Manpower fulfillment proposals 0035-0037 remain deployment gated. Proposal 0037 supports audited quantity increases only; decreases require authoritative commitment accounting and amendment UI/history is not enabled. See `docs/MANPOWER-FULFILLMENT-STAGE-A8.md` and `ROADMAP.md` before promotion. Run the read-only integrity checks only after their corresponding schemas are deployed.

1. Never edit a migration after it has reached a shared or production database.
2. Create the next numeric migration for every schema or policy change, for example `0031_feature_name.sql`.
3. Keep migrations additive and safe for existing production data whenever possible.
4. Keep resets, repairs, and diagnostics outside `migrations/`.
5. Do not store the service-role key, database password, or access token in this repository.

GitHub Actions applies new migrations through `.github/workflows/supabase.yml`. See `docs/DEPLOYMENT.md` for required repository secrets and the one-time baseline procedure for the existing database.

Supabase is PostgreSQL, but authentication, Storage, PostgREST, and some RLS identity helpers are Supabase-specific. The portability boundary and a future standalone PostgreSQL migration approach are documented in `docs/DATABASE-PORTABILITY.md`.
