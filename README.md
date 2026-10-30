# STRELLAS HR Management — An Online Portal

This is the structured static build of the STRELLAS HR Management & Disciplinary Dashboard.

## Structure

- `index.html` — application shell
- `css/app.css` — existing application styles extracted from the monolith
- `css/professional.css` — professional UI/data-display redesign
- `css/workspace.css` — shared people-workspace presentation, loaded last
- `design-system/MASTER.md` — palette, component and responsive UI rules
- `js/app.js` — application runtime and feature integration
- `js/core/pagination.js` — reusable pagination helpers
- `supabase-config.js` — Supabase URL and publishable frontend key
- `supabase/migrations/` — authoritative ordered Supabase CLI migrations
- `docs/` — architecture and deployment notes

Database portability notes for a possible standalone PostgreSQL deployment are in [`docs/DATABASE-PORTABILITY.md`](docs/DATABASE-PORTABILITY.md).

Gated manpower backend address validation and reference-seed procedures are in
[`docs/MANPOWER-FULFILLMENT-ADDRESS-VALIDATION.md`](docs/MANPOWER-FULFILLMENT-ADDRESS-VALIDATION.md).
These proposals are not automatic migrations or production-enabled conversion.

## Deployment

### Navigation

Dashboard and Employees are direct sidebar links. Access Control and Settings are grouped under Administration, separately from Documents & Governance. Existing per-workspace permissions still determine visibility and access, including restricted Organization Structure access for HR Staff.

Data tables default to 25 rows per page, including database-backed lists. Explicitly selected page sizes are preserved; available size options and query limits are unchanged.

### GitHub Pages

Upload/push the contents of this folder to the repository root and publish the `main` branch (or the configured Pages source). `.nojekyll` is included.

### Vercel

Import the repository as a static site. No build command is required. `vercel.json` is included for clean static deployment.

## Supabase

The application uses the public Supabase publishable key. Do not replace it with a service-role or secret key in browser code.

For a new deployment, GitHub Actions applies the ordered files in `supabase/migrations/`. Existing databases that already received the legacy Phase SQL files must use the one-time baseline procedure in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before automatic migration deployment is enabled. Destructive reset utilities and read-only security checks are intentionally excluded from the migration chain.

The scoped Table of Disciplinary Action workbook workflow is documented in [`docs/TDA-CATALOG-IMPORT.md`](docs/TDA-CATALOG-IMPORT.md).

## Important

This build is intended to preserve the existing application behavior while making the codebase more maintainable, improving data presentation, adding client-side pagination to data tables, and improving HR Operations.

For actual Google Drive file upload/OAuth, use a secure backend/Edge Function flow rather than placing Google client secrets in frontend code.

## Professional data experience

The shared workspace styling combines compact record tables with rounded panels
and clear hierarchy while retaining SLSC's existing
violet/charcoal workspace and navy/gold sign-in colors. It uses the existing
static HTML/CSS/JavaScript architecture. Visual QA and component rules are in
[`design-system/MASTER.md`](design-system/MASTER.md).
UI consistency fixes, regression checks and their limits are documented in
[`docs/UI-CONSISTENCY.md`](docs/UI-CONSISTENCY.md).

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


Run `npm run lint`, `npm test` and `npm run build` for the existing repository
checks. The Node tests do not open a browser.

Run `npm run test:browser`, then open its printed loopback URL in a browser.
The synthetic suite checks shared sizing and workflow recovery at 1440, 1280,
768, 390 and 320px document widths. It exits nonzero on failures, incomplete
reports or a timeout. For automated Chrome/Edge runs, use
`npm run test:browser -- --headless`; set `BROWSER_BIN` to an installed browser
executable when automatic discovery is unavailable. No new packages are needed.
See [browser regression coverage and limits](docs/BROWSER-REGRESSIONS.md).
