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

## Google Drive

The System Administrator can choose Google Drive as the destination for all new HR uploads in Settings. Configure a Google Cloud OAuth 2.0 Web Client ID and add each deployed app origin, such as the Vercel production URL and local preview origin, to its authorized JavaScript origins. Enable the Google Drive API for that Google Cloud project.

See [Google Drive File Storage Setup](GOOGLE-DRIVE-STORAGE-SETUP.md) for the complete configuration, testing, filename, and troubleshooting steps.

The configured Drive root folder must be accessible to every HR user who uploads files. The app requests a short-lived Google access token when an upload starts, creates or reuses a module folder such as `leave`, `atd`, `cvr`, or `onboarding` below the configured root, and uploads the file there. Access tokens remain in browser memory and are not stored in Supabase. OAuth client IDs are public application identifiers; do not place a Google client secret in this frontend.

Changing the destination affects new uploads only. Existing Drive and Supabase files remain indexed and readable from the Document Center.

## Local preview

Because browser modules and Supabase access are used, preview the project through a local HTTP server rather than opening `index.html` directly from the filesystem.
