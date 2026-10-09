# Manpower Fulfillment: Stage A3 Spreadsheet Paste

Date: 2026-10-09. Continues the Stage A2 feature commit `2caf94e`. Latest live `main` inspected at `75d71d6`; local HEAD matched it. Subsequent commits did not change the A2 draft editor, model, migration or release notes. Stage A remains incomplete.

## Delivered

- Quantity Drafts editor: collapsible Paste Requisition Lines panel within the existing full-width form. Existing fonts, color tokens, buttons, table styling and shared change-confirmation modal are reused.
- Excel/Google Sheets clipboard text is parsed by the already-bundled SheetJS library, not a custom TSV parser. Quoted tabs/newlines are preserved. Headers are detected and can be mapped manually; headerless rows use the displayed field order. Unknown columns must be explicitly mapped or ignored. Mapping controls keep focus during revalidation.
- Catalog-backed department, matching position and site validation; case/whitespace normalization resolves existing names only. Demand type, positive integer headcount, PostgreSQL integer overflow, real ISO dates, request-date chronology and remarks length are checked. No master-data creation or worker placeholders.
- Invalid source text stays in the preview for correction. One invalid row or mapping error blocks the entire batch. Applying requires confirmation, rechecks current contents, permissions, user and request identity, and appends distinct stable line IDs. Nothing is persisted until the existing atomic Save Draft RPC succeeds.
- Preview renders at most 25 rows per page. Its staged rows intentionally do not expose ordinary table sorting/filtering, avoiding hidden validation failures or conflict with the shared table enhancer.
- Save Draft refuses to silently discard an unapplied paste. Read-only draft viewers do not receive the paste panel. Existing dirty-page navigation tracks pasted input and newly added line IDs.

## Compatibility and Assumptions

No SQL, Supabase keys/configuration, legacy requests/slots, attachments, employment, reservations or deployment logic changed. Existing migrations 0033/0034 remain prerequisites for Quantity Drafts; their live applied state was not verified.

Target dates in pasted text must be `YYYY-MM-DD`; ambiguous locale dates and formulas are rejected rather than guessed/evaluated. Missing Demand Type column defaults to Expansion; an explicitly supplied invalid/blank demand type is rejected. Manual incomplete drafts remain supported; pasted rows must include department, position and quantity.

Technical paste limits are 2,000,000 characters and 64 source columns to bound parsing/mapping work. These are input-size limits, not headcount limits. A line requesting 100,000 people remains one quantity record. Existing draft lines are retained; paste appends, never replaces or silently merges them.

## Actual Validation

- `npm run lint`: passed, including repository structural validation.
- `npm test`: 212 passed, zero failures, including 12 paste tests and the strengthened read-only draft test.
- `npm run build`: passed.
- `node scripts/validate.mjs`: passed.
- `git diff --check`: passed.
- Real bundled SheetJS tests: quoted multiline/tab cells, header mapping, headerless data, invalid quantities/dates/catalogs, ignored columns, required/duplicate mappings, escaping, and 1,000 rows bounded to 25 rendered preview rows.
- Handler tests: invalid batch adds no subset; denied permission, cancel, session/request switch and invalid edits during confirmation do not append; successful batch retains old lines and creates unique new IDs.
- Browser fixture using actual editor, paste handlers, shared confirmation code/markup, table enhancer and CSS: invalid cross-department row disabled Add; Cancel retained input and left one original line; Confirm appended exactly two lines (1000 and 10 headcount) with distinct IDs. Mapping focus retained; 100-row preview advanced to source row 27 with 25 rendered rows and no conflicting enhancer controls.
- Responsive fixture checks: 1280x800, 768x1024, 390x844 and 844x390. The initial mobile overflow was fixed and rechecked: no horizontal overflow of the document or main scroll area; wide preview table scrolls internally. Mobile screenshot inspected.
- No authenticated/live Supabase save, production deployment, screen-reader session, or database migration/concurrency tests were performed in this slice.

The reproducible local-only browser fixture is `tests/browser/manpower-paste-fixture.mjs`. Run it with Node and open `http://127.0.0.1:4181/`. It serves only fixture HTML and project JS/CSS, uses the real shared confirmation UI, and never calls Supabase. Stop it via `/shutdown`.

## Remaining Release Gates

Next Stage A work: cross-model normalized PRF uniqueness registry/guards, additive submission and quantity-history transactions, desktop inline requisition rows/mobile expandable layout, inline detail amendments and reasoned cancellation/reopening. Diagnose existing duplicate numbers and verify migration state before production cutover. Do not enable submission until old writers and new-model concurrency safeguards are protected together.

Stages B/C remain: onboarding reservations and identity links, explicit scheduled/actual deployments, interval and reversal safeguards, conservative on-call eligibility, monitoring/timeline and safe scoped exports. This slice does not claim those workflows are complete.

## Commit Remarks

Add catalog-validated spreadsheet paste to quantity drafts with bounded responsive preview, manual column mapping, shared confirmation and all-or-nothing staging. Preserve existing records/security and keep submission gated pending cross-model PRF safeguards.
