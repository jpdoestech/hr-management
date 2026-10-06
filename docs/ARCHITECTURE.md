# Architecture

## Frontend

The frontend remains a no-build static application suitable for GitHub Pages and Vercel.

- `index.html` contains the application shell and static layout.
- `css/` contains the visual system.
- `js/app.js` contains the current application integration layer.
- `js/core/pagination.js` provides shared table pagination.
- `js/core/performance.js` records bounded, in-memory timings without employee data or search text.

The current application is heavily interdependent, so the first structural refactor intentionally separates the runtime from HTML/CSS without forcing unsafe module-by-module rewrites. Future feature modules can be extracted from `js/app.js` incrementally.

## Data

Supabase PostgreSQL remains the record source of truth. Authentication loads only the modules required by the landing workspace; additional record modules are fetched through an explicit workspace dependency map. Saves diff only modules that were loaded when the edit began, preventing an unloaded module from being treated as an empty deleted collection.

Phase 19 assigns every operational row to a tenant and adds restrictive tenant policies on top of existing role and ownership policies. Existing deployments are backfilled into the default SLSC tenant. New Supabase Storage uploads use `tenant/user/module/file` paths; legacy `user/module/file` objects remain readable only for users in the default tenant.

Phase 20 adds a normalized RBAC layer: permission catalog, tenant roles, role permissions, multi-role user assignments, direct grant/deny overrides, scopes, and resource assignments. Database helpers calculate effective access with direct-deny precedence and the `hr_records` policies enforce both the applicable module action and record scope. `profiles.role` remains synchronized as a compatibility role for older workflows while the application transitions to permission checks.

Employee Information uses a cache-first list/detail boundary: cached records paint immediately, the projected directory RPC returns only visible columns, and complete employee data remains the source for authorized profile operations.

Google Drive is treated as document storage for future secure server-side upload/link flows; the browser must not contain Google client secrets.

Employee self-service transactions use `hr_service_requests` and validated Supabase RPC functions. Employee and Manager accounts receive only self/team-scoped records through Row Level Security; they do not write directly to the shared HR record store.

## UX Principles

- More whitespace and clearer hierarchy
- Fewer competing borders
- Consistent table rhythm
- Sticky table headers
- Pagination for data tables
- Search/filter controls that do not rerender on every keystroke
- Employee-centric HR Operations workspace
- Responsive behavior for desktop, tablet, and mobile
