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

## Google Drive

The frontend supports Google Drive document references and metadata. Real Google Drive OAuth/upload operations should be implemented through a secure server-side or Supabase Edge Function flow rather than exposing Google client secrets in `index.html`.

## Local preview

Because browser modules and Supabase access are used, preview the project through a local HTTP server rather than opening `index.html` directly from the filesystem.
