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

Apply `supabase/phase23-employee-relations-case-foundation.sql` after Phases 19, 20, and 22. Run the complete file once in **Supabase Dashboard > SQL Editor**, then reload the application. The migration expands case stages without rewriting existing values, records legacy workflow values, adds tenant-scoped allegations/findings, and replaces broad case policies with the existing effective-permission and scope checks. It does not delete or move Incident, CVR, NTE, Memorandum, NOD, Disciplinary Action, case-link, activity, or attachment data. Review the Phase A implementation map in [Employee Relations Redesign: Phase A Audit and Mapping](EMPLOYEE-RELATIONS-REDESIGN-PHASE-A.md) before continuing with later workflow phases.

Apply `supabase/phase24-employee-relations-due-process.sql` after Phase 23. Run the complete file once in **Supabase Dashboard > SQL Editor**, then reload the application. Phase 24 creates tenant-scoped response, hearing, and decision tables; enforces Row Level Security; requires `employee_relations.approve` for approval/return actions; prevents silent editing of approved decision content; and tracks explicit NOD finalization metadata. The migration is additive and does not delete, rename, or rewrite existing NTE/NOD JSON records or attachment references. Until Phase 24 is installed, the case workspace remains in compatibility mode and does not treat a legacy inline NTE explanation as a formal normalized response.

Apply `supabase/phase25-disciplinary-history.sql` after Phase 24. Run the complete file once in **Supabase Dashboard > SQL Editor**, then reload the application. Phase 25 creates the tenant-scoped authoritative disciplinary-history table, generates history idempotently from approved decisions with qualifying findings and finalized NODs, backfills existing qualifying Phase 24 decisions in chronological order, and protects finalized source/outcome fields. Existing `disciplinary` JSON records remain untouched and appear only in **Legacy Review** until Phase E. See [Employee Relations Redesign: Phase D Disciplinary History](EMPLOYEE-RELATIONS-PHASE-D.md).

Apply `supabase/phase26-employee-relations-legacy-migration.sql` after Phase 25. Run the complete file once in **Supabase Dashboard > SQL Editor**, then reload the application. Phase 26 projects existing disciplinary rows into a permission-controlled legacy review queue and existing memoranda into read-only case correspondence. Original `hr_records` rows, case links, timestamps, source JSON, and attachment references remain untouched. Automatic employee matching accepts only a valid stable ID or one unique exact normalized name; ambiguous records stay queued for review. See [Employee Relations Redesign: Phase E Legacy Migration](EMPLOYEE-RELATIONS-PHASE-E.md).

Apply `supabase/phase27-employee-relations-monitoring.sql` after Phase 26. It adds tenant-scoped interim-measure and implementation records, protects completed execution, synchronizes linked history status, and powers lifecycle monitoring without modifying existing case evidence or outcomes. See [Employee Relations Redesign: Phase F Monitoring](EMPLOYEE-RELATIONS-PHASE-F.md).

Apply `supabase/phase28-employee-relations-validation.sql` after Phase 27. It adds chronology guardrails for employee responses, Notices of Decision, and final-action implementation. The migration does not rewrite existing rows; review legacy exceptions from **Documents & Governance > Data Quality** after deployment. See [Employee Relations Redesign: Phase G Validation](EMPLOYEE-RELATIONS-PHASE-G.md).

Apply `supabase/phase29-employee-relations-evidence.sql` after Phase 28. It adds a tenant-scoped case evidence register with provenance, custody, managed attachments, archive status, existing Employee Relations permissions, and record-scope enforcement. It does not move or rewrite existing report and case attachments. See [Employee Relations Hardening: Phase H Evidence Register](EMPLOYEE-RELATIONS-PHASE-H.md).

Apply `supabase/phase30-employee-relations-intake.sql` after Phase 29. It adds a tenant-scoped Reports & Intake queue for complaints, referrals, attendance exceptions, audit findings, and security reports. Existing Incident and CVR records remain unchanged; the migration only expands case-link and allegation-source constraints to support normalized intake. See [Employee Relations Hardening: Phase I Reports and Intake](EMPLOYEE-RELATIONS-PHASE-I.md).

Apply `supabase/phase17-user-export-permissions.sql` before deploying the matching frontend. Viewer, Manager, and Employee profiles default to no export access. A System Administrator can enable export for a specific account from User Management; Administrator and HR Staff roles include export access automatically.

## Google Drive

The System Administrator can choose Google Drive as the destination for all new HR uploads in Settings. Configure a Google Cloud OAuth 2.0 Web Client ID and add each deployed app origin, such as the Vercel production URL and local preview origin, to its authorized JavaScript origins. Enable the Google Drive API for that Google Cloud project.

See [Google Drive File Storage Setup](GOOGLE-DRIVE-STORAGE-SETUP.md) for the complete configuration, testing, filename, and troubleshooting steps.

The configured Drive root folder must be accessible to every HR user who uploads files. The app requests a short-lived Google access token when an upload starts, creates or reuses a module folder such as `leave`, `atd`, `cvr`, or `onboarding` below the configured root, and uploads the file there. Access tokens remain in browser memory and are not stored in Supabase. OAuth client IDs are public application identifiers; do not place a Google client secret in this frontend.

Changing the destination affects new uploads only. Existing Drive and Supabase files remain indexed and readable from the Document Center.

## Local preview

Because browser modules and Supabase access are used, preview the project through a local HTTP server rather than opening `index.html` directly from the filesystem.
