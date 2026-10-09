# Manpower Fulfillment: Stage A7 Submitted Request Review

Date: 2026-10-10. Latest `origin/main` inspected at `7b683fb`, matching local HEAD. Uses project ui-ux-pro-max guidance for readable data tables, bounded loading, keyboard navigation, responsive overflow and announced errors. Existing workspace navigation, toolbar, fonts, tokens and pagination are reused.

## Delivered

- Separate Quantity Drafts and Submitted Requests navigation under Manpower Fulfillment. The draft query now explicitly filters `state=Draft`; existing submitted records opened through a draft link are redirected to the read-only detail view.
- Submitted list reads only selected header columns, with server-side PRF search, reporting-branch filter and bounded 10/25/50 pagination. Search retains its input/focus and chosen page size. List filter/page state survives visiting a detail and returning.
- Read-only header metadata and independently paginated Requisition Lines / Quantity History sections. The header does not eagerly load all lines; history filters by the selected request through the existing line relationship.
- Original, current authorized and cancelled quantities remain distinct. Target dates fall back to the header when a line has none. Line details expand for demand type, site and purpose. History identifies the line and stored revision, preserving legitimate same-department/position lines as separate records.
- No assumed reserved/deployed/available totals or dashboard contributions. Those authoritative transactions are still pending, so the UI does not fabricate zero fulfillment measures or aggregate only the current page.
- Loading, empty and retryable error states; missing submission/history schema is reported as unavailable, not shown as a successful empty history. Header access failure discards previously displayed details.
- Async responses are checked against current request token, user, view, permission and mounted host. Stale/account-switched/permission-revoked responses cannot replace newer results.
- Scrollable tables have sticky headers, explicit column headers and captions, focusable keyboard-scroll regions, and contained mobile overflow. Information remains in a toolbar button, not a permanent notice.

## Compatibility and Assumptions

No SQL, source data, attachments, existing migration files, Supabase keys/configuration or RBAC/RLS policies changed. All new requests are SELECT operations through the existing authenticated Supabase client; there are no export or mutation actions in the submitted workspace.

Current proposal 0036 supports only `Draft` and `Open`; this list reads `Open`. Future reviewed Closed/Cancelled states must extend its filters rather than silently disappear. Quantity History currently shows the stored initial submission facts, not a complete amendment/deployment timeline. Submission and amendments remain disabled in the app.

Without reviewed proposals 0035/0036 installed, a database containing only 0034 drafts has no submitted requests. Missing detail/history columns or tables produce an unavailable state. No database setup is automatically performed by these screens. Real PostgREST relationship resolution and production RLS must be verified as part of the coordinated backend/UI release; synthetic query tests are not a live authorization certification.

## Actual Validation

- `npm run lint`: passed.
- `npm test`: 234 passed, zero failures. Ten new tests cover server-side state/search/branch filters, bounded projection/pagination, request-linked history queries, backend failure propagation, escaped data and header-date fallback, late-response protection, session/permission changes, retained page size and submitted/draft separation.
- `npm run build`: passed.
- Browser fixture with actual app read controllers, data-loading/render helpers, shared pagination and project CSS; synthetic records only, no Supabase calls. Verified 10/25 page sizes, PRF search retaining focus/size, branch filter returning 15 Manila records, keyboard line disclosure, independent history page 2 showing records 26-31, and a retryable missing-history alert retaining navigation/header.
- Responsive checks at 1280x800, 768x1024, 390x844 and 844x390: no document/main horizontal overflow. Wide mobile tables scroll internally. Keyboard ArrowRight scrolled the focused history region. Desktop and mobile screenshots inspected.
- No authenticated/live Supabase queries, deployment, screen-reader session or new database changes were performed.

Reproduce the local-only fixture with `node tests/browser/manpower-submitted-fixture.mjs`, open `http://127.0.0.1:4182/`, and stop via `/shutdown`. The `?missing-history` variant simulates unavailable history storage. It never saves real data or loads real records.

## Remaining

Stage A: controlled quantity amendments with reasons/capacity rules, closure/cancellation/reopening, submission UI confirmation and coordinated verified backend/UI release. Stages B/C reservations, deployments, identity/on-call workflows, authoritative monitoring, full critical timeline and scoped exports remain outstanding.

## Commit Remarks

Add bounded read-only submitted-request and quantity-baseline views, separate submitted records from editable drafts, and preserve search/page navigation. Reuse existing permissions/styles/pagination; guard stale responses and provide accessible responsive tables with truthful missing-schema errors. Keep submission and amendments gated.
