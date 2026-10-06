# SCPA HR Management — Structured Professional Build

This is the structured static build of the SCPA HR Management & Disciplinary Dashboard.

## Structure

- `index.html` — application shell
- `css/app.css` — existing application styles extracted from the monolith
- `css/professional.css` — professional UI/data-display redesign
- `js/app.js` — application runtime and feature integration
- `js/core/pagination.js` — reusable pagination helpers
- `supabase-config.js` — Supabase URL and publishable frontend key
- `database/migrations/` — existing SQL migrations carried forward
- `docs/` — architecture and deployment notes

## Deployment

### GitHub Pages

Upload/push the contents of this folder to the repository root and publish the `main` branch (or the configured Pages source). `.nojekyll` is included.

### Vercel

Import the repository as a static site. No build command is required. `vercel.json` is included for clean static deployment.

## Supabase

The application uses the public Supabase publishable key. Do not replace it with a service-role or secret key in browser code.

For a new deployment, apply the numbered SQL migrations in order. Existing deployments should continue through `supabase/phase21-employee-name-sort.sql`. Phase 15 adds restricted organization-structure management; Phase 16 adds RLS-aware server-side record queries; Phase 17 makes export unavailable to Viewer, Manager, and Employee accounts unless an Administrator enables it for that specific profile; Phase 18 adds indexed employee-directory search and projected responses; Phase 19 adds lazy workspace loading, tenant-scoped settings, restrictive tenant RLS, tenant-aware storage paths, and performance instrumentation; Phase 20 adds tenant-aware RBAC, effective-access explanations, and email-owned account security; Phase 21 indexes and applies the default Employee Information name order from A to Z.

The scoped Table of Disciplinary Action workbook workflow is documented in [`docs/TDA-CATALOG-IMPORT.md`](docs/TDA-CATALOG-IMPORT.md).

## Important

This build is intended to preserve the existing application behavior while making the codebase more maintainable, improving data presentation, adding client-side pagination to data tables, and improving HR Operations.

For actual Google Drive file upload/OAuth, use a secure backend/Edge Function flow rather than placing Google client secrets in frontend code.

## Professional data experience

- Structured HTML/CSS/JS project layout
- Responsive professional data tables
- Reusable pagination with 10 / 25 / 50 / 100 row sizes
- Search and filter controls across record modules
- Collapsible navigation groups
- Employee-centric HR Operations workspace with all 16 operational areas
- Employee self-service for profile corrections and leave requests
- Manager and HR request review with role-aware navigation
- Template-driven onboarding, regularization, transfer, and separation checklists
- Applicant tracking, structured evaluation, pre-employment readiness, and direct conversion to an employee record
- Employee lifecycle progress with manager-owned tasks, deadlines, notes, and audit history
- Workflow, automation, document, analytics, and data-quality surfaces integrated into one application shell

## Deployment automation

A GitHub Pages workflow is included at `.github/workflows/pages.yml`. Deployment notes are in `docs/DEPLOYMENT.md`.

## Validation

Run `node scripts/validate.mjs` from the project root to verify required files, local references, and the current Supabase publishable-key configuration.
