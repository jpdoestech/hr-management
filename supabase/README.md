# Supabase database

This directory is the single source of truth for the HRIS database.

## Structure

- `migrations/` contains the ordered Supabase CLI migration history. Files run once in numeric order.
- `maintenance/` contains destructive or operator-invoked utilities. These files never run during deployment.
- `verification/` contains read-only post-deployment checks. These files never run during deployment.
- `proposals/` contains reviewed but deployment-gated SQL. Files do not run automatically; promote them to the next ordered migration only after their documented prerequisites and live baseline are verified.
- `config.toml` contains local Supabase CLI configuration. It contains no credentials.

## Migration rules

Proposal 0047 adds a tenant source-writer interlock and private transaction bodies
while preserving public RPC signatures. It is deployment gated pending independent
session testing, dependency/cache/isolation checks and deadlock/retry UX validation.
See `docs/MANPOWER-FULFILLMENT-SOURCE-INTERLOCK.md`.

Proposal 0046 adds resolved-identity individual/bulk actual confirmation with
idempotent tokens and immutable history. It remains deployment gated; controlled
conversion, transfer/reversal, legacy/on-call integration and mutation UI are
unfinished. See `docs/MANPOWER-FULFILLMENT-ACTUAL-CONFIRMATION.md`.

Proposal 0045 adds half-open historical deployment overlap/date guards, requiring
`btree_gist` in `extensions`. It is also deployment gated; actual confirmation and
transfer transactions are not enabled. See `docs/MANPOWER-FULFILLMENT-DEPLOYMENT-INTERVALS.md`.

Manpower fulfillment proposals 0035-0044 remain deployment gated. Proposal 0037 supports audited quantity increases only; 0038/0039 prepare identity review and 0040 prepares atomic reservations/release and capacity accounting. Follow-on 0041 prepares reasoned increases/decreases against authoritative commitments while preserving the increase-only API. Proposal 0042 prepares outstanding-demand cancellation, closure and reopening without restoring cancelled capacity. Proposal 0043 prepares unchanged resolved identity evidence refresh without re-keying assignments. Proposal 0044 prepares revision-controlled schedule/reschedule/clear transactions without deployment credit. None enables a complete production workflow. Coordinated mutation UI, assignment-aware identity corrections, conversion and deployment integration remain outstanding. Amendment history is read-only; mutation entry is not enabled. See the manpower implementation reports and `ROADMAP.md` before promotion. Run the read-only integrity checks only after their corresponding schemas are deployed.

1. Never edit a migration after it has reached a shared or production database.
2. Create the next numeric migration for every schema or policy change, for example `0031_feature_name.sql`.
3. Keep migrations additive and safe for existing production data whenever possible.
4. Keep resets, repairs, and diagnostics outside `migrations/`.
5. Do not store the service-role key, database password, or access token in this repository.

GitHub Actions applies new migrations through `.github/workflows/supabase.yml`. See `docs/DEPLOYMENT.md` for required repository secrets and the one-time baseline procedure for the existing database.

Supabase is PostgreSQL, but authentication, Storage, PostgREST, and some RLS identity helpers are Supabase-specific. The portability boundary and a future standalone PostgreSQL migration approach are documented in `docs/DATABASE-PORTABILITY.md`.
