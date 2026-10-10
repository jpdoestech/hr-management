# HRIS Manpower Fulfillment — Master Requirements & Codex Implementation Specification

**Project:** SCPA HR Management / HRIS  
**Repository:** https://github.com/jpdoestech/hr-management  
**Authoritative source:** Latest live `main` at time of each implementation stage  
**Specification date:** 2026-10-09  
**Status:** Business requirements approved in consultation; repository-specific implementation and production DB state require verification.  
**Target modules:** People & Records → Manpower Fulfillment; Onboarding & Applicants; On-Call / Replacement; related employee lifecycle, transfers, analytics, audit and access controls.

> **Instructions for Codex:** Treat this file as the business/acceptance contract, **not** as evidence that a named table or helper exists. Inspect the current checkout, compare it with live `origin/main`, report the commit SHA and differences, and trace every affected workflow/database path before edits. If the local workspace has uncommitted changes, preserve them and do not reset or overwrite. Implement the requirements in the existing architecture with the fewest safe changes. Do not invent schema names or infer production migration state from files alone.

---

## 1. Objective and operating principles

Modernize the existing manpower-request experience to support **one manually numbered PRF with many departments, positions and requisition lines**, potentially hundreds or thousands of requested employees. Connect each line to existing applicant/employee identity, HR-controlled reservation, explicit deployment confirmation, temporary/on-call assignments, replacement demand, transfers, history, and reports.

- Prefer **evolution of existing Manpower Fulfillment, Onboarding & Applicants, and On-Call / Replacement** over building parallel modules.
- **Onboarding & Applicants is the authoritative entry point** for PRF worker reservations. Manpower Fulfillment may deep-link into that shared process but must not implement a separate reservation engine.
- **Deployment transactions** establish PRF fulfillment; applicant selection, onboarding completion, and scheduled future deployment do not.
- **Employment/engagement status**, **primary deployment**, **on-call assignment**, **worker hiring category**, and **requisition demand type** are distinct concepts.
- Preserve historical records and security. Use stable identifiers; never rely on editable PRF text as a relational key.
- Keep the build token-efficient and maintainable: minimal cohesive changes, targeted tests, concise progress summaries; no unrelated redesign.

### Non-negotiable protections

1. Preserve the existing Supabase setup and `SUPABASE_PUBLISHABLE_KEY`; do **not** replace it with `SUPABASE_ANON_KEY` or put service-role/secret credentials in client code.
2. Preserve Supabase Auth, current RBAC, RLS, tenant/client scope, audit practices, and related production data. New writes must be protected by real backend/database authorization and consistency checks, not merely hidden frontend controls.
3. No destructive data resets or migrations. Never drop old slot/PRF records until migration, reporting, references and rollback have been validated.
4. Do not create a second employee master, new approval engine, new audit service, or new recruitment/on-call app when existing components can be reused.
5. Do not materialize one empty employee/slot row per unit of requested headcount without a proven legacy compatibility need. Design demand as quantities; create assignments as real people are reserved/deployed.
6. Do not claim tests, deployment, production schema, or data migrations are verified when they are not.
7. Do not introduce payroll or attendance mutations as side effects of a deployment status change; handle downstream dependencies safely.

---

## 2. Repository audit and existing-system mapping (mandatory gate)

### Publicly confirmed foundation (2026-10-09)

The public `main` README documents `index.html`, `css/app.css`, `css/professional.css`, `js/app.js`, `js/core/pagination.js`, `supabase-config.js`, ordered `supabase/migrations/`, responsive/searchable paginated tables, applicant-to-employee conversion, employee lifecycle checklists and audit history, and `node scripts/validate.mjs`.

**Relevant links:**
- https://github.com/jpdoestech/hr-management
- https://raw.githubusercontent.com/jpdoestech/hr-management/main/README.md

### Previous source-audit observations — **VERIFY, DO NOT ASSUME**

Earlier audit notes identified potential structures named `manpowerRequests`, `manpowerRequirements`, `manpowerSlots`, legacy `prf`, `onboardingCandidates`, `employees`, `oncall`, and `transfers`. Notes also suggested optional/reused PRF numbers, a possible 500-headcount UI ceiling, slot-per-headcount generation, applicant PRF free text, and on-call free-text names. **These are verification targets, not certified facts about the latest `main` or live database**. Inspect current source/migrations and record exactly which are true.

Before implementation, map:

| Concern | Inspect and document |
|---|---|
| PRF header and numbering | Existing entities, manual entry, uniqueness, edit logic, client link, approval/state |
| Position requirements | Child items, department/position catalogs, requested quantities, target dates, location, replacement fields |
| Slots and fulfillment | Per-slot creation, status calculation, reservations, deployed counts, source of truth, exports |
| Applicants/onboarding | PRF references, applicant-to-employee conversion, readiness/eligibility, identity links |
| Employees/employment | Stable IDs, former/inactive status, engagement changes, active primary deployment |
| On-call/replacements | Existing fields, eligible candidate search, replacement relationship, history |
| Transfers/deployments | Current transaction model, actual dates, assignment intervals, employee lifecycle history |
| Infrastructure | Current storage pattern, migrations, policies, RPC/functions, indices, audit tables and tests |
| Security | Permission checks, RLS, tenant scope, exports, bulk operations, admin overrides |

**Deliverable of this gate:** short evidence-based mapping with actual file paths, function/table names, current behavior, gaps, migration risks and the repository commit SHA. Inspect deployment/migration version state before DB writes; source code does not establish live schema state.

---

## 3. Functional architecture and canonical relationships

Conceptual only; map to existing schema before inventing tables:

```text
Client/Client Account
  └─ PRF header (stable id; manual editable unique PRF number)
       ├─ Requisition line A (department / position / demand type / quantity / site / date)
       │    ├─ Worker reservation (one identified applicant / person)
       │    └─ Deployment credit / transaction (confirmed actual deployment)
       ├─ Requisition line B ...
       └─ Critical PRF activity timeline

Person identity ↔ verified non-destructive applicant/employee identity links
  ├─ Applicant history / hiring category
  ├─ Employment / rehire / separation engagement history
  ├─ Primary deployment transactions, transfers, reversals
  └─ Separate approved temporary on-call/replacement assignments

Linked replacement requirement → outgoing employee/deployment (when known)
```

The PRF **header owns common client/date/remarks and overall workflow**. Every **line owns a specific staffing requirement**, permitting the same department/position to appear several times for different type/site/date/purpose. Reservations and confirmed deployments refer to the **specific line**, not just a textual PRF number. No duplicate person identity solely because one person is redeployed or rehired.

### Distinct classifications (must not be collapsed)

- **Demand/request type (line):** `Expansion` or `Replacement` (mixed within one PRF).
- **Worker hiring/engagement category:** `New Hire`, `Rehire`, or `Existing Employee / Transfer` (reuse current terminology and workflow where possible). A *new hire* can fill a *replacement* line.
- **Employment status:** existing canonical statuses (e.g. regular/probationary/contractual/inactive/etc.); never infer solely from deployment.
- **Assignment status:** reserved, scheduled, confirmed deployed, ended, cancelled/released, reversed/voided (map to minimal current-state representation).
- **On-call engagement:** separate approved temporary assignment; no automatic conversion to an active primary employment/deployment.

---

## 4. PRF header and multi-line demand requirements

### 4.1 Header

- **PRF Number:** required on final submission, **manually entered**, editable by authorized users, unique within the correct existing tenant/company scope (determine from current model). Normalize whitespace (including trim) and compare case-insensitively; enforce with DB uniqueness/concurrency protection, not only frontend checks. Display helpful duplicate errors. Preserve an immutable internal ID and audit number edits; dependent records remain linked after edits. Do not auto-generate the number.
- **Client Account:** requesting client/company, not an employee pool or manpower position. Reuse existing client master data.
- **Date Requested**, **overall Target Deployment Date**, **general Remarks**, and applicable existing priority/status metadata. Reuse existing approvals if present; **do not add a new approval step** otherwise.
- **Save Draft** (incomplete fields permitted) and **Submit / Open Request** (full validation). Authorization and audit apply to transitions.
- Header totals automatically aggregate line quantities; do not use independently editable duplicate totals.

### 4.2 Requisition line fields

- Department (existing master), Position (existing master and appropriate department relationship).
- Requested/authorized headcount (positive integer, supports 100/500/1000+, no arbitrary 10/500 cap; database-supported range with overflow checks).
- Type: Expansion or Replacement.
- Optional line-specific target deployment date, falling back to header target date for reporting.
- Optional site/location, using existing site master if available; do not silently invent new sites.
- Line-specific remarks/purpose (e.g. `L3 Delivery – Downtown & Samal`, `Reliever for Jeven Abrahan`).
- Optional outgoing employee references for Replacement, with **multiple individual links** when a line covers several replacement workers. Do not require all outgoing employees up front; record when known. Keep historical outgoing-worker/deployment references.
- Per-line lifecycle and fulfillment summary.
- Allow identical department+position on different lines when request type, purpose, site, or target date differs; never auto-merge legitimate distinct requirements.
- Track and audit authorized revisions, original quantity, cancelled outstanding demand and reason; preserve fulfilled history.

### 4.3 Editable quantity, cancellation and capacity

- Increasing quantities allowed with relevant permission and audit.
- **Decreasing authorization cannot violate reserved + historically fulfilled valid credit**, after accounting for cancelled outstanding demand. Require explicit reservation release/reassignment before a decrease would undercut commitments.
- **Preserve original requested headcount** and current authorized headcount. Track **cancelled outstanding demand separately** from normal headcount amendments. Reopening a request does not implicitly restore cancelled slots.
- Sample accounting for a line (counters must be precisely named and use one canonical formula):

```text
OriginalRequested = initial submitted quantity (immutable historical baseline)
CurrentAuthorized = latest approved/current total after quantity amendments
CancelledUnfilled = formally cancelled portion of CurrentAuthorized (not already credited/committed)
EffectiveCapacity = CurrentAuthorized - CancelledUnfilled
Reserved = active reservations, including those scheduled for future deployment
Fulfilled = valid historical deployment credits against that line, excluding reversals
Available = EffectiveCapacity - Reserved - Fulfilled
ActiveDeployed = current active primary deployments associated with that line (distinct from Fulfilled)
```

- All capacity checks must be server/database-authoritative and concurrency safe. Do not allow negative Available; do not reuse a historically fulfilled original slot to count a subsequent attrition replacement unless an explicitly separate linked replacement demand authorizes it.
- Avoid duplicate summary state: compute from authoritative transactions, or use reconciled DB aggregates/materialized views if needed for performance.
- Permit cancelled/closed requests with valid historical deployments; cancellation applies to outstanding unfilled demand, never deletes deployed employee history. All active reservations must be released/reassigned before final cancellation or partial closure. Record reason.

### 4.4 Lifecycle

Support existing lifecycle naming where possible, with business meaning equivalent to Draft, Open, Partially Filled, Filled, Closed and Cancelled. **Operational progress** (open/partial/filled) can be derived, while administrative actions (close/cancel/reopen) must be explicit and audited. Authorize reopening with mandatory reason; do not silently restore cancelled capacity. Draft-only uncommitted lines may be deleted; submitted/committed lines require controlled cancellation with reason and preserved historical references. Full or partial request closure requires reason if remaining demand is closed unfilled.

---

## 5. UI/UX requirements

### 5.1 PRF editor and list

- Use a **dedicated full-width form page**, not a cramped modal.
- Section A: PRF header; Section B: editable multi-line requisition table.
- Desktop: inline editable rows with Add, Duplicate, Remove (draft only), and row-level validation; mobile/tablet: expandable responsive cards. Retain consistent dark-blue/gold/gray system styling and current design conventions, keyboard usability, accessible labeling, responsive performance.
- Sticky/save action area for **Save Draft / Submit (Open) / Cancel** without obscuring content. Unsaved-change warning.
- Spreadsheet efficiency: allow **manual rows, duplicate-row, Excel/Google Sheets clipboard paste**; preview detected headers/columns, map existing catalog values, show invalid rows, validate before commit. No silent master-data creation. Keep invalid pasted content in review, not production records.
- Drafts can be partial. Submission requires required header/line fields and duplicate PRF check. Clear loading/empty/error/success states.
- On submit/open, display aggregate requested, reserved, scheduled (subset of reserved), fulfilled, active deployed, cancelled, available and line status. No pre-creation of large numbers of empty worker records.

### 5.2 Request details / monitoring

- PRF summary with **expandable requisition lines**; allow authorized **inline editing** within detail view, with Save/Discard and a reason for critical changes. Changing quantity, dates, numbering or cancellation follows safeguards.
- Show requested, reserved, scheduled, fulfilled, available, cancelled and current active deployed numbers with clear definitions.
- Each line can expand to a paginated/searchable worker list with applicant/employee identity, assignment/reservation status, reservation age, date scheduled, actual deployment date, and links to source workflows.
- Provide shortcuts from PRF lines into **Onboarding & Applicants**; the underlying reservation action remains authoritative there.
- Add overdue-reservation warnings; **no automatic expiry**. Reservations remain until authorized release/rejection/withdrawal/cancellation.
- Unified chronological timeline of **critical** PRF, quantity, reservation, deployment, reversal and status events, reusing existing audit infrastructure instead of copying every low-level event.
- Reuse existing table pagination/filter components and existing export patterns; server-side paging/filtering where needed for large counts.

---

## 6. Onboarding & Applicants → reservations

- HR may reserve workers **individually or in bulk**, exclusively through the authoritative Onboarding & Applicants workflow; PRF views can deep-link to that workflow with PRF/line preselected.
- Search/select an **open eligible requisition line**, showing PRF, client, department, position, site and available headcount. Assign the stable line ID; show derived PRF Number automatically. Preserve association through applicant-to-employee conversion and future deployment.
- HR reservation is **explicit**; no auto-reservation merely because an applicant exists, passed selection, or became onboarded. Reservation occupies exactly one line capacity unit.
- Bulk preview identifies eligible/ineligible, duplicate selection, existing reservations, active primary assignments, unresolved identity matches, permissions, capacity, and conflicting records. **All-or-nothing** atomic commit on validation success. Never reserve the valid subset silently if one row fails. Show actionable errors and allow correction/retry.
- Reject duplicate effective reservations/person across conflicting PRF lines and enforce appropriate unique/interval constraints at DB layer. Prevent double click/retry duplicate operations (idempotency).
- An applicant's rejection, withdrawal, cancellation, or authorized reservation release returns capacity, preserving full transaction history. Reservation release is not deployment fulfillment.
- Scheduled future deployment **continues to occupy the existing reservation**; it does not consume a second slot or count as Fulfilled.
- Separate hiring category (New Hire/Rehire/Existing Transfer) from line demand type (Expansion/Replacement). For Replacement, allow identifying outgoing employee(s) as information becomes known.

---

## 7. Explicit deployment confirmations and history

- **Confirmed actual deployment**, not onboarding or a future schedule, is the sole PRF fulfillment event.
- HR confirms deployment **individually or in bulk**; require actual deployment date for each worker. Bulk UI permits a common date with individual overrides. Batch commit is **all-or-nothing** after validation.
- Actual deployment date (business event) and record creation/confirmation timestamps (system audit events) are separately recorded. Past dates allowed only with **mandatory reason**, auditable actor/time and overlap validation against the full historical effective-date intervals. Future dates remain **Scheduled**, and require later actual confirmation; no premature fulfillment.
- Convert a valid reservation into a confirmed deployment/fulfillment credit **exactly once**; do not create a second capacity-consuming assignment. Retries must be idempotent.
- One **active primary deployment per employee/person**. Independently approved on-call assignments are recorded separately; check timing and conflict rules. Active employment without a primary client deployment is permitted.
- When a deployment genuinely ends (resignation, contract completion, client/site reassignment), preserve the historical PRF fulfillment credit while closing the effective deployment interval. Do not infer separation from employment solely because deployment ended.
- A **transfer** closes the prior primary deployment and creates a linked new deployment transaction, atomically. A transfer counts toward PRF fulfillment **only when tied to an authorized open requisition line**; otherwise record it as an operational transfer without new-demand credit. Enforce interval non-overlap, including retroactive/backdated records.
- A **replacement following attrition** creates a new linked replacement requirement / authorized line rather than reopening and recounting the original historically filled PRF. New deployment fulfills the replacement requirement and retains outgoing worker's records. Do not equate replacement demand with a new-hire category.
- **Controlled reversal** for an incorrect deployment (e.g. never reported): mandatory reason, authorized user, audit event, negative/voided fulfillment credit and capacity reconciliation; never hard-delete. If referenced by attendance/payroll/other downstream processes, **block automatic reversal until dependencies are resolved**, with actionable diagnostics; do not silently mutate payroll.
- Distinguish genuine deployment followed by separation (historical credit stays) from false/incorrect deployment (credit reverses).

---

## 8. Identity, eligibility, on-call and re-engagement

### 8.1 Identity and engagement

- Use existing canonical person/employee identity and non-destructive verified links for applicant↔existing/former employee matching. Flag potential duplicates for HR review, compare safely, and permit HR to determine **same identity** or **separate persons**; neither auto-merge nor auto-delete.
- **Block deployment while a potential duplicate identity is unresolved.** Record reviewer, decision and rationale. Preserve original source IDs and existing attendance, payroll, disciplinary, employee and deployment references.
- Existing/former employees can satisfy new PRF demand through new authorized deployments; preserve their prior engagement and assignment histories. New engagement/rehire when appropriate should not create a parallel employee master.

### 8.2 On-Call / Replacement → Add On-Call Record

- Candidate selector draws from **eligible applicants and eligible inactive/former employees only**. **Exclude employed-but-unassigned workers**, current active workers and current Regular/Probationary workers. Do not determine eligibility purely from absence of active deployment or a historic employment type.
- Respect existing rehire eligibility, disqualifications and applicant/engagement statuses. Re-evaluate eligibility when assigning/confirming, and preserve reason/evidence for historical decisions.
- Replace free-text person names with searchable linked identities where possible; keep original historical text for legacy migration/display until safely reconciled.
- Link optional appropriate PRF/requisition line and the employee temporarily being replaced, along with client/department/position/site, coverage dates, status and remarks.
- Temporary on-call assignment history is **separate** from the primary employment/deployment ledger and does **not** auto-promote to an active primary deployment or change employment classification. Prevent conflicting assignments under the agreed eligibility and schedule rules.

---

## 9. Reporting, analytics and exports

Provide PRF-level and requisition-line-level screens plus **Excel/CSV export** with RBAC/RLS/privacy protections and large-export performance controls. Reuse existing dashboard/export infrastructure.

Required measures (with clear definitions): original requested; current authorized; quantity revisions; cancelled outstanding demand; effective capacity; reserved; scheduled as subset of reserved; fulfilled valid historical credited deployments; active deployed; available; open requirements; overdue reservations; fill rate; fulfillment duration; replacement and transfer contributions.

Differentiate explicitly:
- **Time-to-Fill:** requested date to confirmed actual deployment of an authorized slot.
- **Time-to-Hire:** applicant/recruitment start to recorded hiring completion (worker category-aware; may not apply to transfers).
- **Time-to-Deploy:** date onboarded to actual deployment date.
- **Historical PRF fulfillment** vs **current active deployed manpower**; attrition must not decrement historical fulfillment or reopen the original requisition.

Allow filtering by client, PRF, requisition line, department, position, site, type, dates, lifecycle, hire category, worker and status. Export only rows/fields the user is authorized to view; protect sensitive personal identifiers. Test Excel/CSV formula injection by escaping unsafe values. Provide clear reporting of amendments, cancellations, scheduled assignments and reversals without double counting.

---

## 10. Database, migration, performance and security strategy

**Do not presume physical table architecture.** First trace current data persistence and Supabase schema/RPC/RLS. Map current `manpowerRequests`/requirements/slots etc. if present. Compare conceptual model with existing records and choose a minimal additive path.

1. **Read-only baseline:** record current commit, file paths, schema/migration versions, relevant constraints/RLS, legacy row counts and references *when accessible*. If no production DB connection, state limitation and prepare migrations/tests, not claims of production validation.
2. **Migration plan:** additive schema/indices/constraints/functions, legacy mapping for single-position PRFs, PRF text links, per-headcount slots, on-call free text and deployment history. Include explicit backfill strategy, ambiguous-match exception list, verification queries, rollout order, feature compatibility, and safe rollback/forward-fix plan. Do not blanket-delete or silently rewrite legacy identities.
3. **PRF uniqueness:** scope unique numbers appropriately; trim/normalize and enforce atomically. Audit edits. Resolve existing duplicates through reporting/controlled remediation rather than applying breaking uniqueness constraints blindly.
4. **Capacity/consistency:** use DB transaction/RPC or equivalent server-side atomic boundaries for reservations, bulk confirmation, transfers, cancellations and reversal. Database guards ensure idempotency and no concurrent overbooking/dual active deployments. If current persistence is a single JSON-style record, explicitly analyze atomicity and propose the smallest safe migration; client-only checks are insufficient.
5. **Line quantities:** don't generate hundreds of unused placeholders; maintain valid historical slot references until fully migrated. Prefer per-person assignment rows only on actual reserve/schedule/deploy actions.
6. **Access:** enforce relevant existing RBAC and Supabase RLS for row access, mutations, identity review, backdating, cancellation, headcount reductions, reopening, audit viewing and exports. Honor multi-tenant/client separation. Browser never receives secrets.
7. **Performance:** indexes on PRF uniqueness/scope, line parent reference, person/worker, statuses, date intervals and common filters; batch/aggregate queries; pagination on large PRF employee lists; no 1,000 empty slot DOM elements; avoid unbounded `select *`.
8. **Audit:** retain only material lifecycle/critical changes (PRF identifiers, quantities/cancellation, line/PRF status, reservations/releases, schedules, actual confirmation, transfers, reversal, duplicate identity resolution); use existing audit mechanism and one aggregated timeline UI.
9. **Compatibility:** preserve current applicant-to-employee conversion, employee lifecycle events, payroll/attendance links, dashboards and exports. Update impacted queries atomically with model changes; provide migration reconciliation before changing historic reports.

---

## 11. Acceptance scenarios (business tests)

### PRF creation and editing

- Manually create `PRF-2026-001`; reject another normalized duplicate in the same permitted scope, including casing/whitespace variants. Authorized number edits preserve all linked records.
- One PRF with Operations/Delivery Rider Expansion 100, Operations/Delivery Rider Replacement 10, Warehouse/Picker Expansion 50, Logistics/Driver Replacement 20, Admin/Encoder Expansion 5. Each is a distinct line; sum is 185. Some lines have different sites/dates and outgoing references.
- Handle 10, 100, 500, 1000+ requested headcount without thousands of empty worker placeholder records or broken performance.
- Paste structured rows from Excel/Sheets; preview invalid department/position/quantity and block unsafe submission; drafts may be incomplete.
- Increase/decrease with reasons, block reductions below effective Reserved+Fulfilled, preserve original/revised/cancelled totals and history.
- Delete uncommitted draft line; cancel committed line outstanding demand without losing confirmed deployments; partial close requires reason and resolved reservations. Reopen with reason but no implicit reinstatement of cancelled capacity.

### Reservation, identity and deployment

- Onboarding selects specific available PRF line; auto-populates PRF details; saves stable link through employee conversion.
- Bulk reserve 75 applicants: if one is ineligible or capacity is insufficient, none are committed; retry after correction succeeds; duplicate requests/retries do not double reserve.
- Withdrawal/rejection/cancellation frees reservation and records history; scheduled deployment retains reservation but does not fulfill.
- Bulk confirm workers using common date and individual date overrides; missing/invalid dates block entire commit. Each confirmed worker receives exactly one valid fulfillment credit.
- Past actual deployment requires reason and full historical overlap check. Future proposed deployment remains Scheduled until explicit actual confirmation.
- Potential duplicate identity blocks deployment pending HR review; link verified identities without destructive merge.
- One active primary deployment, separate approved on-call history, and employed-without-deployment permitted.
- Genuine departure retains historical PRF fulfillment; replacement requirement is newly linked and tracked separately.
- Transfer closes old/deploys new atomically; credit only if linked to authorized requisition line. Wrong deployment reversal restores appropriate capacity and logs reason; blocked where payroll/attendance dependencies unresolved.

### On-call, reporting and security

- On-call selector shows eligible applicants and inactive/former workers; excludes active/Regular/Probationary and employed-but-unassigned; no free-text-only identity for new transactions.
- On-call assignment never automatically changes primary employment/deployment.
- PRF vs line dashboards reconcile original/current/cancelled/reserved/scheduled/fulfilled/active/available; historic fulfilled remains stable after attrition.
- Excel/CSV exports respect row-level permissions and escape spreadsheet formula injection.
- Multi-user concurrency and unauthorized tenant/role operations are rejected server-side.
- Existing system modules continue working. No unapproved key/config changes or data loss.

---

## 12. Implementation stages and release gates

### Stage A — Evidence-based audit, model, migrations and PRF modernization

1. Inspect latest repo and actual deployed schema access, identify conflicts and legacy dependency paths.
2. Deliver concise mapping/migration plan **before any irreversible operation**. If severe ambiguity or live migration state unknown, pause only affected DB step and ask targeted questions, while continuing safe isolated work.
3. Implement the smallest migration path for manual unique PRF number, line-based demand/quantity history, capacity, required relations and compatibility with historical slots.
4. Implement full-width PRF editor, draft/submit, multi-line entry, clipboard paste, inline details and status/cancellation controls.
5. Verify legacy records/exports and database enforcement.

**Gate:** PRF entry/edits/history safe, no broken old records, no overbooking; schema migration rehearsed/tested.

### Stage B — Onboarding, identity, deployment and on-call

1. Unified individual/bulk reservation from Onboarding & Applicants, with PRF shortcuts and all-or-nothing DB validation.
2. Identity-match review/linking, separate hiring category/demand type, and applicant-to-employee continuity.
3. Scheduled vs confirmed actual deployment, common/override dates, retroactive reasons, idempotency, historical interval rules, transfers, replacements, reversals and downstream blocking.
4. Eligible applicant/former-employee on-call selection, separate temporary history.

**Gate:** end-to-end PRF→reservation→deployment→history works and safety rules pass.

### Stage C — Monitoring, exports, tests and stabilization

1. PRF/line dashboards, aging alerts, activity timeline, filters, Excel/CSV exports.
2. Reconcile all existing analytics and historical migration counts; test performance on large headcounts and large worker collections.
3. Run repository validation, lint/tests/build as defined by current `package.json`, DB/RLS/RPC tests where possible, and targeted regression tests.
4. Summarize gaps and rollout instructions; no unverified production success claims.

**Gate:** business acceptance scenarios pass or limitations are explicitly documented with reproducible evidence.

---

## 13. Codex execution contract (concise responses, low token waste)

- Read this specification once and use it as reference; do not repeatedly restate it. Check `origin/main` before each implementation stage, and use the latest source as authoritative. Avoid overwriting concurrent/uncommitted work.
- Before editing: present a **brief verified repo map**, major migration/concurrency risks, and proposed minimal changes. Distinguish confirmed implementation facts from assumptions.
- Implement stage-by-stage. Do not drift into unrelated feature work or redesign already-functional modules.
- Preserve key names and configuration (`SUPABASE_PUBLISHABLE_KEY`), Supabase Auth/RLS/RBAC, existing master data, histories and exports.
- Follow project-specific migrations and CI/deployment procedures. Do not assume that a fresh migration directory equals production schema state.
- After each stage, respond only with: **Files/migrations changed; key behavior implemented; commands/tests run and results; data compatibility/rollout notes; blockers/questions**. Avoid verbose narration or speculative completion claims.
- Ask about genuine business-rule or irreversible migration ambiguities; use the agreed defaults above for resolved questions. Do not ask the user to reconfirm approved choices.

## 14. Explicitly excluded from scope

New payroll/attendance modules; payroll recalculation; new approval engine; automatic staffing recommendations; AI recruitment scoring; replacing Supabase with Google Sheets; new employee master; mass destructive record merges; document storage changes; total application rewrite; unrelated branding/theme revamp.

---

## 15. Final architectural decisions register

| ID | Decision |
|---|---|
| D01 | One manual, editable, unique PRF number per request; internal immutable IDs |
| D02 | One PRF contains many department/position lines, request quantities and mixed Expansion/Replacement types |
| D03 | Overall target date + optional per-line dates/sites; outgoing replacement references optional individually |
| D04 | Very large headcounts supported without preallocating worker placeholders |
| D05 | Original, current authorized and cancelled outstanding demand preserved separately |
| D06 | Requested cannot be lowered below effective reserved+fulfilled commitments |
| D07 | Drafts may be incomplete; submitted/open requests fully validated |
| D08 | Partial closure/cancellation preserves deployed history and requires resolving reservations/reasons |
| D09 | Authorized reopening with reason; cancelled demand not automatically reinstated |
| D10 | Full-width editor; editable rows desktop/cards mobile; paste+preview, duplicate row, inline detail editing |
| D11 | Onboarding authoritative for individual/bulk PRF reservation; PRF shortcuts only |
| D12 | Atomic all-or-nothing bulk reservation/confirmation; idempotency and concurrency checks |
| D13 | Scheduled future deployment retains a reservation and no fulfillment credit |
| D14 | Only HR-confirmed actual deployment counts; date captured separately from system timestamp |
| D15 | Bulk deployment supports shared date and per-worker overrides; retroactive date requires reason |
| D16 | One active primary deployment; separate approved temporary on-call assignments |
| D17 | Employed but unassigned workers allowed, excluded from on-call candidate pool |
| D18 | On-call candidates: eligible applicants/inactive/former only, subject to rehire and status rules |
| D19 | Existing/former workers may fulfill authorized new PRF slots via new deployment transactions |
| D20 | Transfers end prior primary deployment/create linked new one; credit only if authorized line linked |
| D21 | Replacements after attrition use linked new requirement; original historical fulfillment remains |
| D22 | False deployments reversed with reason/audit; attendance/payroll dependencies block automatic reversal |
| D23 | Potential duplicate identities require HR review before deployment; link non-destructively |
| D24 | Activity timeline of critical changes; reuse existing audit mechanisms |
| D25 | Both PRF- and line-level dashboard; Excel/CSV export with RBAC/RLS/privacy |
| D26 | Reuse existing approval workflow if present; no new approval process if absent |
| D27 | Hiring category distinct from requisition Expansion/Replacement; employment distinct from deployment |
| D28 | Preserve Supabase publishable key, current migrations, employee histories and working modules |

## 16. Implementation SQL references

Applicable SQL setup order, copy-ready read-only RPC/permission diagnostics,
integrity-script links and release safeguards are documented in
[SQL setup and verification](MANPOWER-FULFILLMENT-QUANTITY-UI.md#sql-setup-and-verification).
The authoritative SQL remains in `supabase/proposals/` and
`supabase/verification/`; proposals are not automatically deployed migrations.
These operational references do not change the approved business requirements
or authorize production SQL execution, database resets or PostgreSQL installation.
Live baseline, authorization and end-to-end acceptance remain required.

**End of master specification.**
