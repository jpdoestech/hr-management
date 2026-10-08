# SCPA HR Platform Deployment

## GitHub Pages

The project is a static client application. The included `.github/workflows/pages.yml` deploys the repository root to GitHub Pages whenever `main` changes.

Before the first deployment, set the repository's Pages source to **GitHub Actions**.

## Vercel

Import the repository as a static site. No build command is required. `vercel.json` is included for deployment configuration.

## Supabase

`supabase-config.js` contains the public project URL and publishable frontend key used by the application. Keep service-role or secret keys out of the browser and repository.

### Automatic database deployment

The authoritative migration history is `supabase/migrations/`. A push to `main` that changes a migration or `supabase/config.toml` runs `.github/workflows/supabase.yml` and applies pending migrations with the Supabase CLI. Vercel continues to deploy the frontend separately.

Add these encrypted GitHub repository secrets before enabling the workflow:

- `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token used by the CLI.
- `SUPABASE_PROJECT_REF`: the project reference from the Supabase project URL.
- `SUPABASE_DB_PASSWORD`: the database password for that project.

Also create the repository variable `SUPABASE_MIGRATIONS_BASELINED` with value `true` only after the first successful manual workflow run. Until that variable exists, migration pushes to `main` are deliberately skipped so an existing database cannot accidentally replay historical migrations before it is baselined.

Do not add a service-role key to GitHub, Vercel, `supabase-config.js`, or browser code for this workflow.

For a brand-new empty Supabase project, run **Deploy Supabase migrations** once with `baseline_existing_database` left off. The workflow applies `0001` through the latest migration in order. Then set `SUPABASE_MIGRATIONS_BASELINED=true` for automatic future deployments.

For the existing SLSC database, first confirm that every legacy phase through Phase 32 was already applied. Then run **Deploy Supabase migrations** manually once with `baseline_existing_database` enabled. This records migrations `0001` through `0029` as applied without rerunning them, then applies `0030_employee_number_six_digits.sql` normally. Set `SUPABASE_MIGRATIONS_BASELINED=true` after that successful run. Every later migration is then deployed automatically from GitHub. Never enable baseline mode for a blank or partially migrated database.

Files under `supabase/maintenance/` and `supabase/verification/` are deliberately excluded from automatic deployment.

The ordered migration chain includes the base schema, username authentication helper, Employee Self-Service, Manager approvals, organization structure, server pagination, export permissions, projected Employee Information queries, tenant isolation, RBAC, the complete Employee Relations domain, and canonical six-digit employee numbers. The Supabase CLI records each version in `supabase_migrations.schema_migrations`, so only new files run after the baseline.

## Google Drive

The System Administrator can choose Google Drive as the destination for all new HR uploads in Settings. Configure a Google Cloud OAuth 2.0 Web Client ID and add each deployed app origin, such as the Vercel production URL and local preview origin, to its authorized JavaScript origins. Enable the Google Drive API for that Google Cloud project.

See [Google Drive File Storage Setup](GOOGLE-DRIVE-STORAGE-SETUP.md) for the complete configuration, testing, filename, and troubleshooting steps.

The configured Drive root folder must be accessible to every HR user who uploads files. The app requests a short-lived Google access token when an upload starts, creates or reuses a module folder such as `leave`, `atd`, `cvr`, or `onboarding` below the configured root, and uploads the file there. Access tokens remain in browser memory and are not stored in Supabase. OAuth client IDs are public application identifiers; do not place a Google client secret in this frontend.

Changing the destination affects new uploads only. Existing Drive and Supabase files remain indexed and readable from the Document Center.

## Local preview

Because browser modules and Supabase access are used, preview the project through a local HTTP server rather than opening `index.html` directly from the filesystem.
