# SCPA HR Platform Deployment

## GitHub Pages

The project is a static client application. The included `.github/workflows/pages.yml` deploys the repository root to GitHub Pages whenever `main` changes.

Before the first deployment, set the repository's Pages source to **GitHub Actions**.

## Vercel

Import the repository as a static site. No build command is required. `vercel.json` is included for deployment configuration.

## Supabase

`supabase-config.js` contains the public project URL and publishable frontend key used by the application. Keep service-role or secret keys out of the browser and repository.

For Employee Self-Service and Manager approvals, run `supabase/phase10-self-service.sql` in the Supabase SQL Editor after the Phase 3 and Phase 9 migrations. The migration adds Employee and Manager roles, account-to-employee links, request RPCs, and the required Row Level Security policies.

Continue through `supabase/phase13-onboarding.sql` for the applicant onboarding workspace. Phase 13 keeps `onboardingCandidates` records visible only to Administrator and HR Staff accounts while preserving the existing employee and manager record scopes.

Apply `supabase/phase14-admin-storage-settings.sql` to restrict system-wide settings changes to Administrator accounts. The frontend skips the settings upsert for other roles so ordinary HR record saves continue to work under this policy.

Apply `supabase/phase15-organization-structure.sql` to let Administrator and HR Staff accounts add or edit departments and positions. The migration exposes a restricted function that updates only Organization Structure; General, compensation, storage, and audit settings remain Administrator-only in the interface and under Row Level Security.

Apply `supabase/phase16-server-record-pagination.sql` to enable database-side search, filtering, sorting, and pagination for Employee Information and reusable HR record tables. The function respects the existing `hr_records` Row Level Security policies and adds indexes for the most common department, status, and branch filters. Deploying the frontend first is safe because it temporarily falls back to locally cached pagination when the function is unavailable.

Apply `supabase/phase18-employee-directory-performance.sql` after Phase 17 to enable the optimized Employee Information data path. It adds a trigram search index, partial employee filter/order indexes, and an RLS-aware projected directory function. The frontend requests only the columns needed by the user's active table view and automatically falls back to the Phase 16 query until Phase 18 is installed. Run the complete Phase 18 file once in **Supabase Dashboard > SQL Editor**; it is additive and does not rewrite or delete employee records.

Apply `supabase/phase19-tenant-scale-foundation.sql` after deploying the matching frontend. Phase 19 backfills existing rows into the default SLSC tenant, changes HR settings to a tenant-scoped singleton key, adds restrictive tenant RLS to every available operational table, and scopes new Supabase Storage objects by tenant. Existing files remain supported through the migration's legacy-path policy. Run the complete file once in **Supabase Dashboard > SQL Editor** and then reload the application. Do not create a second tenant until its profiles, settings, Google Drive root, and administrator provisioning process have been configured.

Apply `supabase/phase20-access-control.sql` after Phase 19. Phase 20 upgrades User Management into tenant-aware RBAC with multiple roles, applicable-action permission matrices, direct grants and denies, scopes, resource assignments, effective-access explanations, and employee password self-service policy. Follow [Access Control and Account Recovery Setup](ACCESS-CONTROL-SETUP.md) to configure redirects, SMTP, seeded roles, and recovery testing.

Apply `supabase/phase17-user-export-permissions.sql` before deploying the matching frontend. Viewer, Manager, and Employee profiles default to no export access. A System Administrator can enable export for a specific account from User Management; Administrator and HR Staff roles include export access automatically.

## Google Drive

The System Administrator can choose Google Drive as the destination for all new HR uploads in Settings. Configure a Google Cloud OAuth 2.0 Web Client ID and add each deployed app origin, such as the Vercel production URL and local preview origin, to its authorized JavaScript origins. Enable the Google Drive API for that Google Cloud project.

See [Google Drive File Storage Setup](GOOGLE-DRIVE-STORAGE-SETUP.md) for the complete configuration, testing, filename, and troubleshooting steps.

The configured Drive root folder must be accessible to every HR user who uploads files. The app requests a short-lived Google access token when an upload starts, creates or reuses a module folder such as `leave`, `atd`, `cvr`, or `onboarding` below the configured root, and uploads the file there. Access tokens remain in browser memory and are not stored in Supabase. OAuth client IDs are public application identifiers; do not place a Google client secret in this frontend.

Changing the destination affects new uploads only. Existing Drive and Supabase files remain indexed and readable from the Document Center.

## Local preview

Because browser modules and Supabase access are used, preview the project through a local HTTP server rather than opening `index.html` directly from the filesystem.
