# Architecture

## Frontend

The frontend remains a no-build static application suitable for GitHub Pages and Vercel.

- `index.html` contains the application shell and static layout.
- `css/` contains the visual system.
- `js/app.js` contains the current application integration layer.
- `js/core/pagination.js` provides shared table pagination.

The current application is heavily interdependent, so the first structural refactor intentionally separates the runtime from HTML/CSS without forcing unsafe module-by-module rewrites. Future feature modules can be extracted from `js/app.js` incrementally.

## Data

Supabase PostgreSQL remains the record source of truth. The frontend continues using the existing record persistence model and current publishable key.

Google Drive is treated as document storage for future secure server-side upload/link flows; the browser must not contain Google client secrets.

## UX Principles

- More whitespace and clearer hierarchy
- Fewer competing borders
- Consistent table rhythm
- Sticky table headers
- Pagination for data tables
- Search/filter controls that do not rerender on every keystroke
- Employee-centric HR Operations workspace
- Responsive behavior for desktop, tablet, and mobile
