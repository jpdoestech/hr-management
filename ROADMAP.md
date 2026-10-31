STRELLAS HR Management — Development Roadmap

UI-20261030 — Shared interactive control sizing system

Status: completed and pushed to origin/main.

Implementation: 3e05641ba3791dabc8c0bc53b849df50456193b9.
Remote refs/heads/main matched the full implementation hash after pushing on
2026-10-30. The commit includes Summary, Description and validation results.

- Standardized form controls at 44px desktop / 48px phone, toolbar controls at
  42px / 44px, and compact pagination at 34px / 44px using semantic tokens.
- Aligned typography, spacing, composite controls, selection targets and focus
  presentation while preserving Attendance geometry and existing workflows.
- Updated CSS ownership, cache versions, browser fixtures and sizing documents.
- Validation: lint, 407 tests, build, structural validation and diff checks;
  computed browser checks at 1440, 1280, 768, 390 and 320px with synthetic data.
- No production JavaScript, database, permissions or persistence changes.
- See docs/UI-CONSISTENCY.md for measured results and verification limits.


UI-20261029-E — Direct History-to-Overview navigation

Status: completed and pushed to origin/main.

Implementation: 0ed1f233104e8334cd9199dba426e18649c74c3e.
Remote refs/heads/main matched this hash after pushing on 2026-10-29.

- Retained navigation handlers when active employee action buttons are disabled,
  so Overview works immediately after switching to History.
- Added editor/viewer transition regression coverage and browser fixture support
  for the actual tab switcher. Verified History then Overview with synthetic data.
- Validation: lint, 407 tests, build, structural validation and diff checks.
- No database, permission, persistence or dependency changes.


UI-20261029-D — Uniform responsive tables and shared controls

Status: completed and pushed to origin/main.

Implementation: 63b1efcc7e0b8e90f13f77bfe95aafdc3523ff72.
Remote refs/heads/main matched the full implementation hash after pushing on
2026-10-29. The commit includes the summary, description and validation results.

- Fixed viewport-filling table widths across all table families, including
  settings, access control, previews, reports, manpower and modal tables.
- Unified typography, cell spacing, actions, pagination, toolbar controls and
  gutters; capped desktop search growth. Preserved full employee names,
  Attendance editing and responsive request cards.
- Compared the reference repository read-only. Added computed-style fixtures
  for all table classes, editable tables and mobile request cards.
- Validation: lint, 406 tests, build, structural validation and diff checks;
  synthetic browser review at 320–3440px and short landscape, plus dialogs
  and Attendance staging. No database, authorization or dependency changes.
- See docs/UI-CONSISTENCY.md for coverage and limitations.


UI-20261029-C — Compact laptop and desktop employee filters

Status: completed and pushed to origin/main.

Implementation: 7b52e06d8216aee433864a59fac70c072e2b76d5.
Remote refs/heads/main matched the full implementation hash after pushing on
2026-10-29. The commit includes the summary, description and validation results.

- Replaced uneven growing filter blocks with equal-width inline controls on
  wide desktops and a compact Filters popover on laptop/tablet widths.
- Kept the toolbar to one aligned row, including administrator actions and
  active-filter Clear. Preserved full labels, long-value notes and phone layout.
- Added focus restoration when a focused filter panel closes. Browser fixture
  checks now include administrator controls and desktop alignment/width rules.
- Validation: lint, 406 tests, build, structural validation and diff checks;
  synthetic checks at 1280, 1366, 1500, 1920 and 390px. No production records,
  database, permission or persistence changes. See docs/UI-CONSISTENCY.md.

UI-20261029-B — Full filter labels, flexible columns and scoped Overview edits

Status: completed and pushed to origin/main.

Implementation: 2d2241adabcb5fa958ca9c44627b053513be11ce.
Remote refs/heads/main matched the full implementation hash after pushing on
2026-10-29. The commit includes the summary, description and validation results.

- Replaced clipping-prone filter widths with content sizing and wrapping;
  selected values too long for the screen have a visible full-text note.
  Phone filters overlay the employee table instead of consuming record space.
- Employee columns follow headers/current-page data without fixed widths or
  name ellipses. Search icon alignment/contrast and similar record-table text
  clipping are corrected. Missing "Not recorded" values use dark red.
- Permission-gated Overview pencils open one group at a time. Section saves
  preserve other fields and reuse employee persistence, audit and rollback.
- Validation: 405 tests, lint, build, structural validation and diff checks;
  synthetic browser review of responsive filters, full names, missing values,
  Emergency Information editing, and read-only presentation.
- No SQL, schema, authorization-policy or dependency changes. No confidential
  records or authenticated production saves used. See docs/UI-CONSISTENCY.md.

UI-20261029 — UI consistency and compact employee records

Status: completed and pushed to origin/main.

Implementation: 3db694d1dce7359ff9240a58f9e70be08e0b5803.
Push verified against refs/heads/main with git ls-remote on 2026-10-29.
The implementation commit includes the summary, description and validation
results. This publication note is a separate documentation-only follow-up.

- Resolved the ten UI audit findings: label associations, search focus,
  compact table density, readable record/case text, mobile control sizing,
  shared modal tokens, action icon semantics, filtered leave recovery,
  persistent required-field errors and computed-style browser checks.
- Aligned the desktop sidebar logo and workspace header dividers, and kept
  employee pagination visible in responsive layouts. Existing server paging,
  column projection, cache limits and request protection remain unchanged.
- Changed the shared CSS, application UI helpers/renderers, cache versions,
  action-icon validation contract, browser fixtures and focused regression
  tests. Details: docs/UI-CONSISTENCY.md and design-system/MASTER.md.
- Validation: lint, 395 tests, production build, structural validation and
  diff checks passed. Synthetic browser checks covered 320–1920px widths,
  short landscape, modal typography/labels/errors and filtered leave recovery.
- No SQL, schema, authorization or dependency changes. Production records and
  authenticated saves were not used. Physical-device coverage is not exhaustive.

Purpose

This roadmap guides incremental development of the STRELLAS HR Management & Disciplinary Dashboard.

The goal is to improve security, reliability, HR workflow completeness, usability, accessibility, and maintainability while preserving existing application behavior.

Codex must follow the repository's AGENTS.md before implementing roadmap items.

Roadmap Rules
Inspect the existing codebase before selecting a feature.
Verify whether each proposed feature already exists and works correctly.
Never reimplement a working feature merely because it appears in this roadmap.
Refine acceptance criteria based on actual architecture and documented business requirements.
Implement one coherent feature at a time.
Respect dependencies and prioritize security and data integrity.
Run required validation before marking a feature complete.
Commit and push completed features only when authorized and permitted by repository policies.
Record verified progress and the commit reference where applicable.
Never mark a feature complete based only on a visual implementation or an unverified assumption.
Status Definitions
pending — Not yet started or awaiting assessment.
in_progress — Currently being implemented.
blocked — Cannot proceed safely because of a dependency, failure, missing permission, or unresolved decision.
completed — Acceptance criteria and required checks have passed.
not_needed — Audit confirmed the feature is already adequately implemented or is outside the approved scope.

The initial statuses below are provisional until the repository audit is completed.

Phase 0 — Repository Audit and Automation Foundation
ROADMAP-001: Audit the existing application

Priority: P0 — Critical
Initial status: pending

Tasks:

Inspect README.md, AGENTS.md, package.json, source modules, styles, scripts, tests, migrations, deployment workflows, and docs/.
Inspect the Git branch, working tree, and recent history.
Inventory the existing HR operational areas and their actual functionality.
Identify incomplete workflows, bugs, duplicated logic, security risks, and missing tests.
Verify the existing validation, lint, test, and build commands.
Review current Supabase authorization and migration practices.
Produce a gap analysis that distinguishes verified issues from assumptions.

Acceptance criteria:

The current architecture and available commands are documented.
Existing functionality is mapped to the proposed roadmap.
Security concerns and deployment risks are recorded.
No existing user changes are overwritten.
Subsequent feature priorities are based on evidence from the repository.
ROADMAP-002: Establish the feature backlog and workflow

Priority: P0 — Critical
Initial status: pending

Tasks:

Create or refine AGENTS.md.
Create or refine ROADMAP.md.
Document the feature selection, validation, commit, push, and recovery workflow.
Identify which Git branch is intended for autonomous development.
Establish a reliable way to resume after a session ends.

Acceptance criteria:

Each actionable feature has a unique ID, priority, status, dependencies, and measurable acceptance criteria.
Completed features have verifiable evidence.
Blocked features have documented reasons.
The next eligible task can be identified without guessing.
Phase 1 — Security, Privacy, and Data Integrity
ROADMAP-010: Review authentication and authorization

Priority: P0 — Critical
Initial status: pending

Audit and improve, where necessary:

Authentication and session handling.
Role-based access for employees, managers, HR personnel, and administrators.
Supabase Row Level Security policies.
Record-level access restrictions.
Unauthorized data access through direct API or database requests.
Session expiration and error handling.

Acceptance criteria:

Access follows the verified authorization requirements.
Sensitive data cannot be accessed solely by bypassing frontend navigation.
Security regressions have automated tests where feasible.
Existing legitimate workflows remain functional.
ROADMAP-011: Audit frontend secrets and integrations

Priority: P0 — Critical
Initial status: pending

Tasks:

Inspect browser-accessible files for privileged credentials.
Verify that only approved public configuration is exposed.
Review OAuth and Google Drive integration patterns.
Identify sensitive information in logs, URLs, and error messages.
Verify that privileged operations use an appropriate trusted backend or Edge Function.

Acceptance criteria:

No service-role keys or private credentials are exposed in frontend code.
Integration security gaps are documented and safely addressed.
No secrets are added to Git history or test fixtures.
ROADMAP-012: Verify database migration safety

Priority: P0 — Critical
Initial status: pending

Tasks:

Review the ordered migrations in supabase/migrations/.
Read docs/DEPLOYMENT.md and relevant baseline documentation.
Identify migration dependencies and backward-compatibility risks.
Review destructive operations and migration automation.
Document a safe recovery and verification procedure.

Acceptance criteria:

Migration order and deployment prerequisites are documented.
Existing database baselines are respected.
No production reset or destructive migration runs automatically.
Schema and policy changes can be tested in a safe environment.
ROADMAP-013: Improve validation and data integrity

Priority: P1 — High
Initial status: pending

Audit data validation for employee records, applicants, leave requests, attendance, disciplinary records, and related workflows.

Acceptance criteria:

Required fields and invalid values are handled consistently.
Authorization is checked at the appropriate trusted boundary.
Duplicate or inconsistent records are prevented where business rules require it.
Error messages do not expose confidential information.
Relevant regression tests cover important edge cases.
Phase 2 — Core HR Workflows

The following feature groups are proposed audit targets, not assertions that these features are currently missing.

ROADMAP-020: Employee records and organizational structure

Priority: P1 — High
Initial status: pending

Review employee profiles, employee status, departments, positions, reporting relationships, and employee record updates.

Acceptance criteria:

Existing employee operations work consistently.
Field validation and authorization are enforced.
Record changes preserve required history and data integrity.
Search, filtering, and pagination behave consistently where applicable.
ROADMAP-021: Employee self-service

Priority: P1 — High
Initial status: pending

Review employee access to personal information, profile correction requests, leave requests, and request status.

Acceptance criteria:

Employees can access only their authorized information.
Requests are validated and persisted correctly.
Request states and error messages are clear.
HR or manager review follows the established authorization model.
ROADMAP-022: Attendance and leave management

Priority: P1 — High
Initial status: pending

Review attendance records, leave balances where applicable, leave submissions, approvals, and request history.

Acceptance criteria:

Attendance and leave records follow documented business rules.
Approval permissions are enforced.
Duplicate submissions and invalid state transitions are handled safely.
Relevant totals and statuses remain consistent with persisted data.
ROADMAP-023: Onboarding and employee lifecycle

Priority: P1 — High
Initial status: pending

Review onboarding, regularization, transfers, separation, checklists, task ownership, deadlines, and history.

Acceptance criteria:

Lifecycle stages follow documented transitions.
Required tasks and deadlines are trackable.
Ownership and permissions are enforced.
Important status changes retain the required audit history.
ROADMAP-024: Recruitment and applicant tracking

Priority: P1 — High
Initial status: pending

Review applicant records, candidate evaluation, pre-employment readiness, and conversion to employee records.

Acceptance criteria:

Applicant information is appropriately restricted.
Evaluation and status transitions are validated.
Conversion does not create unintended duplicate employee records.
Sensitive applicant information is not unnecessarily exposed.
ROADMAP-025: Disciplinary management and TDA catalog

Priority: P1 — High
Initial status: pending

Review disciplinary workflows, relevant employee records, the Table of Disciplinary Action catalog, and the documented catalog import process.

Acceptance criteria:

Access to disciplinary information follows strict authorization requirements.
Catalog imports validate their inputs and report errors clearly.
Historical disciplinary records are preserved according to approved business rules.
Changes and decisions have appropriate traceability.
ROADMAP-026: Documents and file integrations

Priority: P1 — High
Initial status: pending

Review employee documents, attachments, file access, and any Google Drive integration.

Acceptance criteria:

Private documents are accessible only to authorized users.
File operations use secure integration patterns.
File validation and error handling are implemented.
No private OAuth credentials are exposed in browser code.
Phase 3 — Workflow Automation and Reporting
ROADMAP-030: HR workflow automation

Priority: P2 — Medium
Initial status: pending

Audit existing workflow automation, reminders, deadlines, and task assignments.

Acceptance criteria:

Automation rules reflect approved business requirements.
Repeated execution does not create duplicate side effects.
Failed operations are visible and recoverable.
Automated actions respect permissions and record history.
ROADMAP-031: Notifications and reminders

Priority: P2 — Medium
Initial status: pending

Assess notifications for pending requests, deadlines, onboarding tasks, and other approved HR events.

Acceptance criteria:

Notifications are relevant and accurately reflect record status.
Sensitive employee information is not unnecessarily included.
Duplicate notifications are minimized.
Delivery failures are handled appropriately.
ROADMAP-032: Analytics and HR reporting

Priority: P2 — Medium
Initial status: pending

Review dashboards, operational summaries, charts, and data-quality reporting.

Acceptance criteria:

Metrics are calculated from reliable data.
Filters and date ranges behave consistently.
Access to reports follows authorization rules.
Charts and tables remain readable on smaller screens.
Empty and error states are handled clearly.
ROADMAP-033: Data quality and audit history

Priority: P2 — Medium
Initial status: pending

Review data-quality indicators, audit history, incomplete records, and workflow consistency.

Acceptance criteria:

Data-quality issues can be identified without exposing unauthorized records.
Audit history preserves relevant changes.
Reports distinguish missing data from actual zero values.
Any automated correction has a safe, documented process.
Phase 4 — UI/UX Pro Max and Accessibility
ROADMAP-040: Audit the existing design system

Priority: P1 — High
Initial status: pending

Tasks:

Read .agents/skills/ui-ux-pro-max/SKILL.md if present.
Inspect existing design-system documentation and page-specific overrides.
Inventory the application's colors, typography, spacing, components, navigation, tables, forms, and interaction states.
Identify inconsistencies and accessibility problems.
Preserve the current design language unless evidence supports a change.

Acceptance criteria:

UI/UX Pro Max guidance is used when available.
Existing design-system rules are documented and respected.
Improvements are based on actual application needs.
No unnecessary full redesign is introduced.
ROADMAP-041: Responsive layout and navigation

Priority: P2 — Medium
Initial status: pending

Review the application shell, navigation groups, dashboards, forms, and data tables at different viewport sizes.

Acceptance criteria:

Core workflows remain usable on desktop, tablet, and mobile.
Navigation remains understandable and keyboard-accessible.
Tables and forms do not cause avoidable layout failures.
Existing functionality is preserved.
ROADMAP-042: Accessibility and interaction states

Priority: P2 — Medium
Initial status: pending

Review accessible labels, keyboard behavior, focus management, contrast, form validation, loading states, empty states, errors, and confirmations.

Acceptance criteria:

Interactive elements have appropriate accessible names.
Keyboard users can complete essential workflows.
Focus states are visible.
Errors are communicated clearly.
Destructive actions have suitable safeguards.
ROADMAP-043: Consistent data presentation

Priority: P2 — Medium
Initial status: pending

Review search, filtering, sorting, pagination, status indicators, and table layouts across HR modules.

Acceptance criteria:

Data controls behave consistently.
Pagination does not silently lose relevant filters or sorting.
Loading, empty, and error states are clear.
Large datasets remain practical to navigate.
Phase 5 — Testing, Performance, and Maintainability
ROADMAP-050: Strengthen automated regression tests

Priority: P1 — High
Initial status: pending

Review existing tests and add coverage for critical business rules, data operations, authorization-sensitive behavior, and regression-prone features.

Acceptance criteria:

npm test passes for the supported test suite.
Important regressions are covered by repeatable tests.
Tests do not depend on real employee data or production credentials.
Failures are actionable and reproducible.
ROADMAP-051: Improve lint, build, and validation reliability

Priority: P1 — High
Initial status: pending

Review the existing lint, test, build, and validation scripts.

Acceptance criteria:

npm run lint, npm test, and npm run build work as documented.
node scripts/validate.mjs verifies the required project conditions.
Validation failures produce meaningful diagnostics.
No checks are weakened merely to make CI pass.
ROADMAP-052: Performance and maintainability

Priority: P2 — Medium
Initial status: pending

Inspect duplicated logic, oversized modules, unnecessary rendering work, expensive table operations, and avoidable frontend resource usage.

Acceptance criteria:

Changes address a verified maintenance or performance issue.
Existing behavior is preserved.
Unnecessary dependencies are avoided.
Relevant regression checks pass.
ROADMAP-053: Deployment and recovery procedures

Priority: P1 — High
Initial status: pending

Review .github/workflows/pages.yml, migration deployment, GitHub Pages configuration, and deployment documentation.

Acceptance criteria:

Automated checks run before appropriate deployments.
Deployment failures are observable.
Protected branches and required reviews remain respected.
Database migration prerequisites are documented.
Recovery procedures do not rely on destructive automatic resets.
Phase 6 — Autonomous Feature Delivery
ROADMAP-060: Establish safe feature-by-feature delivery

Priority: P1 — High
Initial status: pending

Implement a repeatable workflow for selecting, validating, committing, and publishing eligible features.

Acceptance criteria:

Each feature has a unique roadmap ID.
Changes are reviewed and tested before commit.
Only intended files are staged.
Commits are focused and descriptive.
Push success is verified before reporting completion.
The roadmap records completed work and commit references.
Failed or blocked features remain accurately marked.
Unrelated user changes are preserved.
ROADMAP-061: Verify GitHub Actions quality gates

Priority: P1 — High
Initial status: pending

Assess whether GitHub Actions should run the existing lint, test, build, and validation commands on relevant pull requests and pushes.

Acceptance criteria:

CI uses the actual supported project commands.
Required checks fail visibly when they fail.
Secrets are handled through appropriate GitHub configuration.
Production deployment is not treated as successful merely because code was pushed.
Existing deployment behavior is preserved unless an approved change is necessary.
ROADMAP-062: Verify safe session recovery

Priority: P2 — Medium
Initial status: pending

Ensure autonomous work can resume after an interrupted Codex session.

Acceptance criteria:

The current feature and its status are recorded.
Incomplete work is not falsely marked completed.
The next eligible task can be selected deterministically.
Git state and existing changes are checked before resuming.
A session restart does not cause duplicate commits or unsafe deployment actions.
Feature Execution Protocol

For every feature selected from this roadmap:

Confirm that the feature is applicable and not already complete.
Check dependencies and business requirements.
Set its status to in_progress.
Implement the smallest coherent change.
Add or update relevant tests.
Run the required validation commands.
Review security, accessibility, data integrity, and the final diff as applicable.
Commit and push only when authorized and permitted.
Verify the remote result.
Record the commit reference, test results, and completion evidence.
Mark the feature completed only when its acceptance criteria pass.
Continue to the next eligible feature.

If a feature is already implemented and passes its acceptance criteria, mark it not_needed with evidence rather than rebuilding it.

If a feature is blocked, record the blocker and select another independent eligible feature when safe.

Never bypass security checks, destructive-operation safeguards, required approvals, or repository protection rules to keep the workflow moving.

Progress Log

Append a concise entry for each completed feature.

Date	Feature ID	Result	Commit	Notes
—	—	Awaiting initial audit	—	No completion claims until verified
Definition of Done

A feature may be marked completed only when:

Its acceptance criteria pass.
Relevant automated tests pass.
Required project validation passes.
Security and data-integrity implications have been reviewed.
Documentation is updated where necessary.
The final diff contains only intended changes.
Any required commit and push have been verified.
Remaining limitations are documented.

The roadmap is complete when all approved, applicable features are completed or explicitly resolved as not_needed, and no unresolved critical blocker remains.

## Manpower Fulfillment Status (2026-10-10)

Approved requirements: `docs/HRIS_MANPOWER_FULFILLMENT_SPEC.md`. The specification is NOT complete.

- Stage A is partial. Draft transactions, spreadsheet paste, responsive inline editing, PRF registry/submission proposals and read-only submitted request/history views have local validation evidence in the Stage A2-A7 reports. Latest slice: `6329cf4`.
- Stage A remaining: coordinated submission/amendment/lifecycle UI and release, legacy/export compatibility checks, independent concurrency and live database verification. Quantity and lifecycle transaction proposals are locally rehearsed, not deployed or complete end-to-end features.
- Stage B remaining: individual/bulk applicant reservations, employee identity links, scheduled versus actual deployments, transfer/replacement/reversal intervals and explicitly approved on-call eligibility. Active, On Leave, Suspended and AWOL-pending workers remain excluded from on-call selection.
- Stage C remaining: authoritative fulfillment/aging/timeline reporting and exports, analytics reconciliation, performance, live RLS/RBAC, independent concurrency and end-to-end acceptance.
- Registry/submission SQL remains in `supabase/proposals/`, outside automatic migrations. Existing production data, attachments and Supabase configuration must be preserved. Local rehearsal is not evidence of production deployment.
- MP-A08: prepared, deployment gated - audited quantity-increase amendment foundation and isolated database rehearsal (`docs/MANPOWER-FULFILLMENT-STAGE-A8.md`), pushed as `55c9c97`. Decreases remain gated on authoritative reservation/fulfillment accounting; do not assume commitments are zero or accept client-provided counters. Amendment entry is not yet enabled.
- MP-A09: locally validated - read-only Amendments tab, bounded database pagination, retained per-tab page state and explicit missing-schema fallback (`docs/MANPOWER-FULFILLMENT-STAGE-A9.md`). Reads require proposal 0037 storage; no migration or mutation entry is enabled by this UI slice. Submission History continues to preserve initial facts separately.
- MP-C01: locally validated - independent legacy manpower export safety fix, with formula neutralization and explicit manpower view/export checks (`docs/MANPOWER-FULFILLMENT-EXPORT-SAFETY.md`). Stage C authoritative quantity-model exports and production acceptance are NOT complete.
- MP-B01: locally rehearsed proposal - initial audited applicant/employee identity decisions with narrow permissions, both-source scopes, stale-preview checks and unchanged source records (`docs/MANPOWER-FULFILLMENT-IDENTITY-FOUNDATION.md`). Effective identity resolution, corrections, UI and reservation/deployment enforcement remain gated; Stage B is NOT complete.
- MP-B02: locally rehearsed proposal - versioned re-review before assignment dependencies, append-only supersession history and one current link (`docs/MANPOWER-FULFILLMENT-IDENTITY-REVISIONS.md`). No source merges or UI enablement. Corrections beneath existing assignments remain blocked pending dependency-aware integration.
- MP-B03: locally rehearsed proposal - atomic individual/bulk applicant reservations, idempotent batches, explicit release, canonical capacity and source-writer guards (`docs/MANPOWER-FULFILLMENT-RESERVATION-FOUNDATION.md`). The 75-worker acceptance slice passes locally; UI, candidate-alias review, conversion/deployment integration, legacy reconciliation and independent concurrency remain outstanding. No production enablement.
- MP-A10: locally rehearsed proposal - reasoned positive quantity increases/decreases checked against reserved/scheduled and historical fulfilled commitments after cancelled demand (`docs/MANPOWER-FULFILLMENT-QUANTITY-AMENDMENTS.md`), pushed as `03b848c`. Lint, 241 tests, production build, diff checks and the isolated PostgreSQL amendment rehearsal passed. Original headcount, cancellation totals and history stay intact; audit failure rolls back changes. Existing increase-only API remains strict. Cancellation accounting constraint is prepared, but lifecycle RPCs/UI, live verification and independent concurrency are still outstanding. Stage A is NOT complete.
- MP-A11: locally rehearsed lifecycle proposal - line outstanding-demand cancellation, multi-line close/cancel and reopen without restored capacity (`docs/MANPOWER-FULFILLMENT-LIFECYCLE.md`), pushed as `0292668`. Lint, 241 tests, build, diff checks and the isolated PostgreSQL lifecycle rehearsal passed. Reservations must be resolved before affected demand closes; original/authorized quantities and historical fulfillment remain intact. Revision/access controls, append-only history, read-only integrity checks and multi-line audit rollback pass locally. Mutation UI, live verification and independent concurrency remain release gates; Stage A is NOT complete.
- MP-A12: locally validated read-only lifecycle UI (`docs/MANPOWER-FULFILLMENT-LIFECYCLE-UI.md`), pushed as `bb40f18`. Closed/cancelled request browsing, database state filtering, bounded lifecycle history and explicit missing-storage fallback are implemented. Lint, 245 tests, build, diff checks and synthetic desktop/tablet/mobile browser checks passed. No transaction entry or database deployment enabled; unified timeline and historical line-delta disclosure remain unfinished.
- MP-B04: locally rehearsed unchanged identity evidence refresh (`docs/MANPOWER-FULFILLMENT-IDENTITY-REFRESH.md`), pushed as `b1d7358`. Lint, 245 tests, build, diff checks and isolated/combined PostgreSQL rehearsals passed. Stale evidence can be refreshed for the same resolved employee without changing assignment worker keys or capacity. Identity changes beneath assignment history, legacy dependencies and unknown deployment ledgers remain blocked. Full correction/alias/conversion workflows, UI and live acceptance remain unfinished; no production enablement.
- MP-B05: locally rehearsed schedule/reschedule/clear foundation (`docs/MANPOWER-FULFILLMENT-SCHEDULING.md`), pushed as `c90d165`. Lint, 245 tests, build, diff checks and isolated/combined PostgreSQL rehearsals passed. Monotonic revisions prevent stale/ABA updates, plans remain reserved rather than fulfilled, and reasons, scopes, audit/history rollback and explicit release are enforced. Planning history is append-only. Actual deployment, bulk actions, UI, baseline reconciliation, independent concurrency and live acceptance remain unfinished.

- MP-B06: locally rehearsed deployment interval prerequisite (`docs/MANPOWER-FULFILLMENT-DEPLOYMENT-INTERVALS.md`). User-approved end date is the first unassigned day, allowing adjacent half-open intervals. Database exclusion rejects historical/active overlaps; date guards reject future/non-finite/empty actual intervals. Reversed records remain auditable. Lint, 245 tests, build and isolated/combined PostgreSQL rehearsals passed. Actual confirmation, ending/transfer/reversal APIs, UI, live baseline and independent concurrency remain unfinished; no production enablement.

MP-B06 publication: implementation `c420990` pushed to `origin/main` and verified. Repository validation and diff checks also passed. Proposal 0045 remains outside automatic deployment; the next eligible slice is actual deployment confirmation with authoritative identity/source checks, all-or-nothing batches and audit/idempotency protection.

- MP-B07: locally rehearsed resolved-identity actual confirmation (`docs/MANPOWER-FULFILLMENT-ACTUAL-CONFIRMATION.md`). Single and all-or-nothing bulk confirmation reuse reserved rows, record actual dates/reasons separately from timestamps, enforce current identity/access/revision/interval checks and retain idempotent immutable audit/history. The 75-of-1000 actual fulfillment slice passes without placeholders, including final-row rollback and retry. Lint, 245 tests, build and isolated/combined PostgreSQL rehearsals passed. Conversion/alias handling, transfer/reversal, legacy/on-call integration, UI, live baseline and independent concurrency remain unfinished. No production enablement.

MP-B07 publication: implementation `de0c621` pushed to `origin/main` and verified. Repository validation and staged diff checks passed. The resolved-identity confirmation proposal remains outside automatic deployment. Next: controlled applicant-to-employee identity/conversion handoff and source-writer concurrency protection; transfer/ending/reversal, on-call and coordinated UI remain required.

- MP-B08: locally rehearsed source-writer interlock (`docs/MANPOWER-FULFILLMENT-SOURCE-INTERLOCK.md`). Relevant source writes and reservation/identity/scheduling/confirmation RPCs share a tenant transaction lock, with private bodies and unchanged public signatures. Conflicting legacy slot/on-call writes fail closed; unrelated reads/modules remain unlocked. Lint, 245 tests, build, repository validation and isolated/combined PostgreSQL rehearsals passed. Independent sessions, dependency/cache/isolation checks, contention and deadlock/retry UX remain release gates. Conversion, full on-call integration, UI and live acceptance remain incomplete; no production enablement.

MP-B08 publication: implementation `d960e39` pushed to `origin/main` and verified. Staged diff checks passed; source-only locking, distinct tenant keys, isolation handling, private access denial and the existing wrapped transaction regressions passed locally. Proposal 0047 remains gated. Next: controlled applicant-to-employee conversion handoff; independent-session concurrency and retry UX remain required, not completed by this slice.

- MP-B09: locally rehearsed existing-master applicant/reservation handoff (`docs/MANPOWER-FULFILLMENT-EMPLOYEE-HANDOFF.md`). Scoped HR review, readiness/fingerprint checks, exact private source/assignment intents, stable reservation/capacity, preserved master/history, fresh immutable identity evidence and idempotent audit-backed retries are implemented. Unknown duplicate names block handoff; reviewed separate-person evidence is retained across the stage change. Audit/final-row rollback and later explicit deployment pass. Lint, 245 tests, build, repository validation and isolated/combined PostgreSQL rehearsals passed. Atomic new-master creation, rehire coordination, historical/alias correction, UI, independent sessions and live acceptance remain required. No production enablement.

MP-B09 publication: implementation `994dfa3` pushed to `origin/main` and verified. Staged diff checks passed. The existing-master handoff preserves capacity and original employee references, carries scoped separate-person evidence, and supports explicit later actual confirmation. Proposal 0048 remains gated. Next: genuinely new employee creation using this controlled handoff, with canonical number allocation and input/address validation; UI and independent/live acceptance remain required.

- MP-B10: locally rehearsed backend address-validation prerequisite (`docs/MANPOWER-FULFILLMENT-ADDRESS-VALIDATION.md`). Private immutable reference catalog and an explicit non-overwriting seed generator derive from unchanged authoritative files. Optional/imported street addresses, strict hierarchy/names/ZIP, canonical display and private access pass automated tests and synthetic isolated/combined database rehearsals. Lint, 247 tests, build, repository validation, seed generation and diff checks passed. Atomic new employee creation, remaining master-field validation, UI, independent sessions and live acceptance remain unfinished. Proposal 0049 stays outside automatic migrations; no production enablement.

MP-B10 publication: implementation `12f092a` pushed to `origin/main` and verified. Staged diff checks passed; generated bulk seed SQL stayed outside Git. Next: atomic new-master creation with canonical employee numbers and remaining input validation. The immutable catalog and proposal 0049 still require reviewed test/live setup; conversion UI and production acceptance are not complete.

- MP-B11: locally rehearsed atomic new-hire employee backend proposal (`docs/MANPOWER-FULFILLMENT-NEW-EMPLOYEE.md`). Creates the existing master with database-generated global six-digit numbers, validated catalog/contract/compensation/IDs/addresses, audited metadata and controlled same-reservation handoff. Unknown duplicates, stale previews and late failures roll back creation; retries are private, immutable and reauthorized. Lint, 247 tests, build, repository validation, diff checks and isolated/combined PostgreSQL rehearsals passed. Conversion UI, generic-writer/independent concurrency, rehire/alias workflows and live acceptance remain release gates. Proposal 0050 is not automatically deployed.

MP-B11 publication: implementation `7c677c3` pushed to `origin/main` and remote HEAD verified. Staged diff checks passed. The new-hire backend proposal does not complete conversion UI or release; existing production conversion remains unchanged. Next eligible backend slice: reasoned deployment ending with retained historical fulfillment, approved half-open dates, scopes/revisions/audit and rollback; transfers/reversal, on-call, coordinated UI and independent/live acceptance follow.

- MP-B12: locally rehearsed genuine deployment ending proposal (`docs/MANPOWER-FULFILLMENT-DEPLOYMENT-ENDING.md`). Same-row endings use approved half-open dates, retain historical fulfillment, leave employment/source data unchanged and preserve audited immutable history. Individual/bulk scope, stale confirmation, idempotency, closure compatibility, adjacent redeployment and all-or-nothing rollback pass synthetic checks. Lint, 247 tests, build, repository validation, diff checks and isolated/combined PostgreSQL rehearsals passed. Atomic credited/non-credited transfer, reversal, UI, independent concurrency and live acceptance remain outstanding; proposal 0051 is outside automatic migrations.

MP-B12 publication: implementation `969ca31` pushed to `origin/main` and remote HEAD verified. Staged diff checks passed. Single/bulk ending, closed-demand compatibility, retained credit and explicit adjacent redeployment are locally rehearsed, not production enabled. Next eligible work: map the existing transfer path and implement atomic transfers covering both authorized requisition credit and non-credited operational assignments; reconcile their shared non-overlap model before claiming transfer completion. Reversal/downstream blocking, on-call, UI and independent/live acceptance still follow.

- MP-B13: locally rehearsed shared primary interval prerequisite (`docs/MANPOWER-FULFILLMENT-SHARED-PRIMARY-INTERVALS.md`). Audited the existing department-transfer path; prepared an additive private interval projection spanning PRF and non-credited operational assignments, exact private intents and source/reservation conflict guards. Cross-ledger/history overlaps, failed-sync rollback, adjacent operational chains, actor audit, private/RLS denial and unchanged PRF capacity pass synthetic checks. Lint, 247 tests, build, repository validation, diff checks and isolated/combined PostgreSQL rehearsals passed. Legacy organization transfers are not silently reclassified or credited. Public atomic transfer, operational ending, UI, independent concurrency, baseline reconciliation and live acceptance remain unfinished; proposal 0052 is outside automatic migrations.

MP-B13 publication: implementation `8e4b0cc` pushed to `origin/main` and remote HEAD verified. Staged diff checks passed. Shared interval synchronization, historical cross-ledger exclusion and non-credited storage are locally rehearsed prerequisites, not a released transfer workflow. Next: implement one atomic transfer API across PRF-backed and operational sources/destinations, with scoped catalog/identity validation, original credit preservation, authorized new-demand credit only, fresh preview checks, audit/idempotency and rollback. Preserve existing organization-transfer behavior during later coordinated UI integration; no inferred legacy deployments.

- MP-B14: locally rehearsed atomic primary transfer backend (`docs/MANPOWER-FULFILLMENT-ATOMIC-TRANSFERS.md`). One RPC links and commits old ending plus PRF-backed or non-credited destination across both source types, reusing existing accounting/identity/confirmation and shared interval guards. Preview, current scopes, reasons, audit/history, idempotency and all-or-nothing rollback are included. All four source/destination combinations, capacity exhaustion, scoped destinations, late failure rollback, unchanged master records and read-only integrity checks passed isolated/combined synthetic PostgreSQL rehearsals. Lint, 247 tests, build and explicit repository validation passed. Employee/applicant master fields and the legacy department-transfer form remain unchanged. UI/master integration, operational endings, replacement/reversal/on-call, independent concurrency and live acceptance remain required; proposal 0053 is outside automatic migrations.

MP-B14 publication: implementation `7bd53e1` pushed to `origin/main`; remote HEAD verified. Staged diff checks passed. No production database migration or application transfer form was enabled. Next eligible backend slice: standalone operational deployment ending with the same half-open date rule, fresh evidence, current scopes, preserved history, actor audit, idempotency and all-or-nothing rollback. Replacement/reversal dependencies and coordinated UI/master integration remain release gates.

- MP-B15: locally rehearsed operational ending backend (`docs/MANPOWER-FULFILLMENT-OPERATIONAL-ENDING.md`). Individual/bulk genuine endings reuse guarded operational storage and shared intervals with fresh previews, scoped authorization, actor audit, immutable history and canonical retries. Original PRF credits and employee/applicant master fields remain unchanged. Isolated/combined synthetic rehearsals pass, including audit/late-second-row rollback and revoked retry access; read-only integrity queries return zero rows. Lint, 247 tests, build, explicit repository validation and diff checks pass. Proposal 0054 remains outside automatic migrations; UI, independent concurrency and live acceptance are not complete.

MP-B15 publication: implementation `b19b2e0` pushed to `origin/main`; remote HEAD verified. Staged diff checks passed. Standalone operational ending is locally rehearsed, not production-enabled. Next: inspect replacement-line/outgoing-worker support and add immutable links to genuine attrition without reopening historical credit; then controlled reversal with downstream/transfer-descendant blocking. Coordinated UI/master integration, on-call, reporting and independent/live acceptance remain required.

- MP-B16: locally rehearsed replacement outgoing-reference backend (`docs/MANPOWER-FULFILLMENT-REPLACEMENT-SOURCES.md`). Reuses existing submitted Replacement lines; links typed genuine ended PRF/operational deployments with dates, worker, reasons, audit, current scopes and canonical retries. Informational links do not allocate demand or mutate capacity/master records. Actual confirmation on new demand alone gains new credit, including when the replacement later ends. Isolated/combined synthetic rehearsals pass; combined lifecycle checks late details on closed requests without reopening demand. Integrity queries return zero rows; lint, 247 tests, build, explicit validation and diff checks pass. Proposal 0055 is outside automatic migrations; UI/correction, controlled reversal dependencies, independent concurrency and live acceptance remain required.

MP-B16 publication: implementation `e473298` pushed to `origin/main`; remote HEAD verified. Staged diff checks passed. No production migration or application feature was activated. Next: map attendance/payroll/legacy references and add controlled reversal with actionable blockers for downstream use, transferred descendants and replacement-source links; preserve all historical evidence and never silently mutate payroll. Audited outgoing-reference correction and coordinated UI/reporting remain unfinished.

- MP-B17: locally rehearsed read-only reversal dependency prerequisite (`docs/MANPOWER-FULFILLMENT-REVERSAL-DEPENDENCIES.md`). Maps indirect attendance/ATD, nested JSON links, legacy assignments, transfers, operational origins/descendants and replacement references. Current approval/source access and per-category permission/row-scope redaction protect diagnostics. Isolated/combined rehearsals pass, including attendance boundaries, malformed dates, nested payroll privacy and other-tenant exclusion. Lint, 247 tests, build, explicit validation and diff checks pass. Preview never enables reversal. Existing source lock does not cover attendance/ATD; mutating reversal requires a coordinated write interlock plus fresh transactional dependency checks. Proposal 0056 stays outside automatic migrations. Independent concurrency, live schema/external-payroll mapping, mutation/correction/UI and acceptance remain unfinished.

MP-B17 publication: implementation `ba2a287` pushed to `origin/main`; remote HEAD verified. Staged diff checks passed. Read-only diagnostics are locally rehearsed prerequisites, not controlled reversal execution. Next: coordinate record-reference/attendance/financial writes with reversal transactions, then implement fresh, authorized, auditable idempotent PRF-credit reversal and capacity reconciliation. Keep linked operational/transfer/replacement corrections gated until their dependency-preserving workflows exist; do not enable production from a clear preview alone.

- MP-B18: locally rehearsed controlled PRF-credit reversal backend (`docs/MANPOWER-FULFILLMENT-CREDIT-REVERSAL.md`). Additive HR-record write interlock, fresh current dependency checks, approve/update authorization, immutable negative-credit audit/history and canonical retries preserve original facts/master records and restore capacity exactly once. Active/ended corrections, dependency/redaction blocks, audit/late rollback, closed-PRF preservation and normalized voided-reference denial pass isolated/combined synthetic checks. Integrity queries return zero rows; lint, 247 tests, build, explicit validation and diff checks pass. Linked operational/transfer/replacement corrections remain blocked, not silently mutated. Proposal 0057 stays outside automatic migrations; independent races/deadlocks/throughput, live external-payroll mapping, UI/reporting and acceptance remain release gates.

MP-B18 publication: implementation `7c5af6e` pushed to `origin/main`; remote HEAD verified. Staged diff checks passed. No production migration or existing form was enabled. Next: verify whether a safe independent-session PostgreSQL runtime is available for the new write interlock/reversal races; never use production credentials for rehearsal. Continue audited replacement-reference correction and linked operational/transfer dependency handling while retaining historical evidence. UI, on-call, reporting, live schema/privacy and end-to-end acceptance remain unfinished.

- MP-B19: verified targeted native independent-session rehearsal (`docs/MANPOWER-FULFILLMENT-NATIVE-RACES.md`). Found PostgreSQL 18.3; initialized a separate loopback temporary cluster and synthetic databases. Added guarded native test adapter without application dependencies. Observed actual advisory-lock waits for writer-before-reversal, reversal-before-reference and simultaneous replay; timeout rollback/retry and independent tenant writes pass in isolated/combined native runs. PGlite regression, nonempty-database refusal, lint, 248 tests, build, explicit validation and diff checks pass. Integrity queries return zero rows; temporary server shutdown verified. This is targeted native evidence, not broad concurrency/performance or live Supabase policy acceptance. Production/configuration and proposal release gates remain unchanged.

MP-B19 publication: implementation `7f2feea` pushed to `origin/main`; remote HEAD verified. Staged diff checks passed. Only test/docs files changed; no proposal promotion or production activation occurred. Next: exercise mixed employee/conversion/source-row lock order and contention on the disposable native runtime, fix verified deadlocks without weakening guards, and continue audited replacement/linked-transfer correction. Targeted race coverage does not complete Stage B/C or replace live migration/privacy acceptance.

Scope clarification: the approved `docs/HRIS_MANPOWER_FULFILLMENT_SPEC.md`
defines implementation scope; this roadmap only tracks it. The previous native
runtime follow-up is deferred. Do not install/start database servers without
explicit approval. Preserve PostgreSQL compatibility for the user's homelab.

- MP-A12: saved-draft submission review/UI implemented using the existing
  `submit_manpower_request` RPC (`docs/MANPOWER-FULFILLMENT-SUBMISSION-UI.md`).
  Full-width saved header/line review, aggregate demand, explicit confirmation,
  current permission/revision/value checks, duplicate-click protection, cancel
  retention and focused backend errors are connected to submitted details.
  No migration was promoted or applied; backend release prerequisites remain.
  Next specification work: coordinated submitted detail amendments/lifecycle
  controls, followed by authoritative onboarding reservation/deployment UI.
  Stage A/B/C and live end-to-end acceptance remain incomplete.

MP-A12 validation: lint, all 256 automated tests, production build, explicit
`node scripts/validate.mjs` and diff checks passed. Synthetic browser fixture
verified review, explicit confirmation and missing-RPC retention. Viewports
390x844, 768x1024 and 1440x900 had no document-width overflow; review tables
scroll internally, mobile summaries use two columns and submit targets are
44px high. Temporary browser viewport reset and fixture server stopped.
No native PostgreSQL runtime, installation or production database operation.

MP-A12 publication: implementation `f1eecf4` pushed to `origin/main`; remote
HEAD verified. Only this feature's application/test/docs files were staged.
The skill search generated an untracked Python cache, excluded from the commit;
its cleanup was blocked by the execution policy. No existing user files changed.

Release gates: verify the live migration baseline and legacy data, rehearse compatible proposals, validate independent concurrent transactions and production authorization, then coordinate database and application enablement. No completion claim until these gates and the specification acceptance criteria pass.

- MP-A13: inline submitted-line quantity amendment UI implemented
  (`docs/MANPOWER-FULFILLMENT-QUANTITY-UI.md`). Uses the existing reasoned
  `amend_manpower_quantity` RPC; original quantity/cancelled demand stay
  read-only. Save/Discard, dirty pagination/tab/line navigation, revision/access
  checks, busy confirmation/write/refresh and focused retained errors preserve
  the selected request/page. Missing backend fails closed. No SQL promotion,
  server setup, production/configuration changes or new dependencies.
  Next specification slice: request/line lifecycle UI. Submitted header/date
  amendments, onboarding reservation/deployment, identity/on-call, monitoring,
  reporting and live release acceptance still remain.

MP-A13 validation: lint, 268 tests, build, explicit repository validation and
diff checks pass. Synthetic browser checks verify same-request page-two Save,
Discard, retained capacity/missing-RPC errors, and desktop/tablet/mobile layouts
(1440x900, 768x1024, 390x844) without document overflow. Mobile editor is fully
revealed within its scroll region and inputs/actions have 44px touch height.
Fixture service stopped; viewport override reset. No database runtime started.

MP-A13 publication: implementation `50ea138` pushed to `origin/main`; remote
HEAD verified. Only the inline quantity amendment feature's files were staged.

Documentation follow-up: linked applicable SQL instructions from the approved
manpower specification. Added reviewed proposal dependency order, read-only
RPC/EXECUTE diagnostics, integrity references and authorization/release gates
to `docs/MANPOWER-FULFILLMENT-QUANTITY-UI.md`. No SQL was executed, no migration
promoted, and no database runtime or configuration changed. This does not mark
the remaining specification features complete.

Documentation validation: lint, all 268 tests, production build, explicit
`node scripts/validate.mjs` and diff checks passed. SQL signatures/grants and
verification filenames were checked against repository source; the diagnostic
was not executed against a database. No new database validation is claimed.

SQL documentation publication: `99a28c9` pushed to `origin/main`; remote HEAD
verified. Specification scope and proposal release gates remain unchanged.

- MP-A14: submitted request/line lifecycle UI connected to the existing
  `change_manpower_lifecycle` RPC (`docs/MANPOWER-FULFILLMENT-LIFECYCLE-TRANSACTIONS-UI.md`).
  State/permission-based Close, Cancel, Reopen and selected-line cancellation
  use compact reasoned inline entry, explicit confirmation, stable revisions,
  retained request/section/page and shared Save/Discard/Keep navigation.
  Missing/stale/denied/reservation errors retain input; busy guards cover
  confirmation/write/refresh. No proposal promotion, SQL execution, database
  runtime, production record, configuration or new dependency changes.

MP-A14 browser evidence: synthetic page-two cancellation, Close, Reopen without
restored demand, Discard, retained reservation and missing-RPC errors verified.
390x844, 768x1024 and 1440x900 had no document overflow; the panel remains
bounded to 640px, with 44px mobile/tablet actions. No live database/RLS test
claim. Submitted header/date/numbering amendments and authoritative onboarding
reservation/deployment UI follow; identity/on-call, timeline/reporting, legacy
reconciliation and coordinated live release/acceptance remain unfinished.

MP-A14 validation: lint, all 282 automated tests, production build, explicit
`node scripts/validate.mjs` and diff checks passed. Inputs/actions lock during
confirmation/write and unlock on retained errors/cancel; the shared quantity
editor receives the same protection. Fixture server shutdown verified and
temporary browser tab closed/viewport reset. Historical read-only lifecycle
documentation is preserved separately from the new transaction UI evidence.

MP-A14 publication: implementation `0d6b77a` pushed to `origin/main`; remote
HEAD verified. Staged diff checks passed; only this slice's files were staged.
The existing untracked skill Python cache remains excluded. No production SQL
was applied. Next: inspect submitted header/date/numbering amendment APIs and
their immutable submission/registry guards before coordinated UI changes.

MP-A14 publication documentation: `04f7841` pushed to `origin/main`; remote
HEAD verified. Specification remains the scope; ROADMAP records progress only.

- MP-A15: controlled submitted-header amendments
  (`docs/MANPOWER-FULFILLMENT-HEADER-AMENDMENTS.md`). Proposal 0058 reuses
  current request locks, private exact intents, scoped authorization, cross-model
  PRF registry and actor audit with append-only before/after history. Inline
  PRF/date/requested-by/priority/remarks entry confirms reasons, preserves
  submission/line/worker facts and same-request page context. Lazy Header History
  is bounded and escaped. Missing backend/duplicate/stale/denied errors retain
  input. Client/branch are deliberately not reinterpreted by this operation.

MP-A15 database evidence: standalone and combined existing in-memory PGlite
rehearsals passed. Strict field/date/state/revision/reason/access validation,
normalized current/legacy duplicate rejection, atomic registry/audit rollback,
old-number reuse, immutable baselines, quantity/lifecycle coexistence and empty
header integrity checks verified. Combined proposals through 0057 plus 0058
preserved an active reservation and canonical capacity after PRF/date edits.
No package/server installation, native server startup, live SQL execution,
historical migration edit or proposal promotion occurred.

MP-A15 browser evidence: synthetic page-two Save/Discard, changed-field history,
duplicate-number field error, missing RPC/storage retention and sibling
navigation verified. 390x844, 768x1024 and 1440x900 show no document horizontal
overflow; one/two-column forms max at 760px and mobile/tablet controls are 44px.
Next: controlled line metadata amendments, then authoritative onboarding
reservation/deployment UI. Identity/on-call, unified monitoring/reporting,
legacy reconciliation and live release/security acceptance remain unfinished.

MP-A15 project validation: lint, all 294 automated tests, production build,
explicit `node scripts/validate.mjs` and `git diff --check` passed. Browser
fixture shutdown and temporary tab cleanup were verified. SQL setup and
read-only diagnostics are documented in the header-amendments Markdown file.
The unrelated untracked skill Python cache is excluded from publication.

MP-A15 publication: `dff0cb6` pushed to `origin/main`; remote HEAD matched
`dff0cb6b7a5a086fcf97020f35f2208d771beefe`. Staged diff checks passed.
The specification is not complete; no live SQL or production deployment was
performed by this workflow.

- MP-A16: lazy authoritative requisition-line capacity disclosure. Reuses the
  reviewed `manpower_line_capacity(text)` API with strict integer/arithmetic
  result verification, refresh/retry, accessible announcements and stale-read
  guards. No worker hydration, per-page N+1 reads, schema/configuration changes
  or live SQL. Applicable SQL diagnostics are in
  `docs/MANPOWER-FULFILLMENT-LINE-CAPACITY-UI.md`. Eight focused tests passed;
  synthetic browser disclosure/refresh/missing-RPC and 390/768/1440 document
  containment verified. Tablet summary adjusted from three to two columns.
  Request totals and worker lists are not yet implemented by this change.

MP-A16 validation: lint, 302 automated tests, production build, explicit
repository validation and diff checks passed. Synthetic fixture server exited
successfully after shutdown; temporary browser tab closed and viewport reset.
Full specification remains incomplete and production release gates unchanged.

MP-A16 publication: `f298fa0` pushed to `origin/main`; remote HEAD verified as
`f298fa0fe3ae770e305baa3c4c6704348cb304d2`. Only this feature's files were
staged; the unrelated skill cache remains untouched and excluded.

- MP-A17: requisition-line worker monitoring. Read-only proposal 0059 uses
  invoker RLS and existing manpower/onboarding access, tenant and line/request
  checks. Scoped names/IDs, assignment states, age and scheduled/actual/ended
  dates are server-searched/filtered before bounded paging. Typing retains focus,
  errors retain filters, and return navigation preserves the previous line page.
  SQL instructions are in `docs/MANPOWER-FULFILLMENT-WORKER-MONITORING.md`.
  Five focused tests and the existing in-memory rehearsal with 31 synthetic
  reservations passed; no read audit writes, unauthorized/input/tenant denials,
  name/state search and paging verified. Synthetic browser checks passed at
  390/768/1440 widths, including off-page search, typing focus, empty state,
  return context and missing backend. No live SQL or configuration changes.
  Source shortcuts/aging warnings, line amendments, authoritative transaction
  UI, totals/timeline/reporting and live acceptance remain incomplete.

MP-A17 project validation: lint, all 307 automated tests, production build,
explicit repository validation and diff checks passed. Fixture shutdown/exit,
temporary tab cleanup and viewport reset verified. No server was installed.

MP-A17 publication: `ec00be7` pushed to `origin/main`; remote HEAD verified.
Follow-up review adds an explicit onboarding-permission recheck before painting
an in-flight worker response. No database deployment was performed.

MP-A17 permission follow-up `450eea2` pushed and remote HEAD verified. Lint,
308 tests, build, explicit validation and staged diff checks passed.

- MP-B20: manual identity-review UI in applicant details. Reuses current employee
  autocomplete, minimal scoped comparison preview and the existing versioned
  audited identity transaction. Requires three permissions; explicit decision,
  bounded reason, fingerprints/revision, confirmation locking, duplicate guards
  and saved-result verification. Stale errors retain entries, changed employee
  selection resets decisions, and shared Save/Discard/Keep navigation returns to
  the applicant. No source merge, SQL/configuration change or server installation.
  Nine focused tests passed. Synthetic controller/form harness verified responsive
  containment, validation, return and stale errors; picker/auth/confirmation/RPC
  are stubbed, not production acceptance. SQL diagnostics/limits are in
  `docs/MANPOWER-FULFILLMENT-IDENTITY-REVIEW-UI.md`. Automatic identity discovery,
  authoritative reservation/deployment/on-call UI and broader specification gates
  remain incomplete.

MP-B20 publication: `cbe4740` pushed to `origin/main`; remote HEAD matched
`cbe4740173b2ea21c6a4af952861483bb1d94805`. Only identity-review UI, tests,
setup notes and related progress records were staged; the skill cache is excluded.

MP-B20 project validation: lint, 317 automated tests, production build, explicit
repository validation and diff checks passed. Synthetic fixture shutdown/exit,
temporary browser tab cleanup and viewport reset verified. No live SQL executed.

Attendance roster loading fix — 2026-10-17 (locally verified)

- Separated failed roster requests from genuine empty results, added Retry that
  keeps cutoff/filters, prevented stale failures replacing newer results, and
  blocked saves while the roster is unavailable.
- Explained dated schedule requirements, added a manager-only employee schedule
  action and filter clearing, and directed viewers to an attendance manager.
  Empty/error guidance stays outside the wide matrix table for responsive use.
- Changed the attendance controller, application cache versions, synthetic
  browser fixture, five behavioral regression tests and attendance setup docs.
- Lint, 386 tests, build, explicit repository validation and diff checks passed.
  Synthetic browser checks verified Retry recovery, manager schedule form,
  viewer guidance, and mobile/tablet layout. Browser tab and fixture were closed;
  viewport override was reset.
- No database migration, employee data or authorization policy changed. Live
  Supabase schedules/access and deployment remain unverified. Missing schedules
  still require reviewed HR setup. No commit, push or deployment performed.

Attendance employee-first roster — 2026-10-17 (locally verified)

- Adapted the AMS employee-first attendance flow. Accessible employee records
  now populate the matrix without per-employee attendance schedule setup.
  Ordinary status painting and bulk reported Late/UT minutes save through the
  canonical attendance records and appear in Records & KPIs.
- Added migration 0064 for bounded scoped roster queries and atomic mixed
  ordinary/scheduled saves. Existing dated assignments keep ownership of their
  days. Ordinary entries do not fabricate reviewed calendars, actual punches,
  worked minutes or payroll evidence. Client restrictions, permissions, hire /
  separation dates, stale hashes, audit history and posting locks still apply.
- Updated matrix/controller, cache versions, synthetic browser fixture, core
  tests, SQL rehearsal, migration validation manifest and attendance guide.
  Replaced the empty-state requirement to create schedules with automatic
  employee/access/filter guidance. No employee or schedule backfill.
- Verification: lint, 389 tests, build, explicit repository validation and diff
  checks passed. Actual migrations 0031/0062/0063/0064 passed a synthetic PGlite
  rehearsal covering ordinary saves, reported minutes, zero-minute Day-off,
  leave/AWOL, attachments, tenant/client/permission isolation, stale changes,
  mixed-batch rollback, approval/posting, and existing scheduled behavior.
  Browser checks verified no-schedule Present/save, Late/UT/save, context menu
  and 390px mobile editor. Fixture/tab closed and viewport reset.
- Rollout: deploy migration 0064 before the matching frontend. No production
  SQL, commit, push or deployment performed; authenticated live acceptance is
  pending. Test-only PGlite was installed outside the repository.

Attendance employee-first publication: `9471445` pushed to `origin/main`;
remote HEAD verified as `94714454176b629481271e55459861a4cc56d43a`.
Commit remarks include migration order, preserved access/integrity controls,
389 passing tests and SQL/browser verification limits. Deployment workflow
results and authenticated live acceptance have not been verified.

Attendance live rollout verification — 2026-10-21

- Signed-in Supabase dashboard confirmed project `wdgiifaywhqpzyyhdinz`
  (`strellas-hris`) has migrations 0062, 0063 and 0064 installed. Read-only
  catalog queries confirmed all four 0064 function bodies exactly match the
  committed SQL (MD5 after CRLF normalization).
- All five execution-permission checks passed: anonymous execution denied,
  authenticated execution allowed for the three public functions and denied for
  both private helpers. No migration replay or employee-data mutation occurred.
- `https://strellas-hr.vercel.app/` serves application version 20261017-2;
  deployed attendance modules contain the employee-first recording logic.
  The live HR app opens at Sign in; account-specific roster acceptance remains
  pending an authenticated HR session.
- GitHub migration automation still lacks its deployment secrets and baseline
  variable. The skipped workflow is not evidence that the live migration is
  absent; the dashboard/catalog checks above confirm installation independently.

UI-20261022 — Shared people-workspace redesign (locally verified)

- Applied a Sprout-inspired spacious layout and component treatment across the
  shell, dashboards, tables, forms, dialogs, attendance and authentication.
  Existing violet/charcoal and navy/gold palettes, fonts, runtime workflows,
  permissions and persistence remain unchanged. No dependency or migration.
- Added `css/workspace.css`, shell accessibility/brand refinements, shared
  design rules in `design-system/MASTER.md`, and a synthetic visual fixture.
  Existing browser fixtures load the new stylesheet in production order.
- Lint, 389 tests, build, explicit validation and diff checks passed. Browser
  checks covered 1280px desktop, 768px tablet, 390px phone and 320px dashboard;
  employee overview/edit markup, navigation, attendance staging, sign-in and
  registration layout, wrapped details and skip-link focus were reviewed.
  Final fresh preview had no console errors. No confidential records used.
- Scope: shared presentation completed locally. Representative fixture pages
  do not prove every role-specific runtime flow. Live deployment and
  authenticated production acceptance require separate verification.

UI-20261022 publication: `47ab820` pushed to `origin/main`; remote HEAD verified
as `47ab82087e031703eddcafba8b39bcfe00ce29d0`. Commit remarks record validation,
preserved behavior and visual-review limits. No production SQL was executed.

UI-20261022 live assets: `https://strellas-hr.vercel.app/` returned HTTP 200
and loads `css/workspace.css?v=20261022-1`. The stylesheet returned HTTP 200
and exactly matches the tested source after CRLF normalization. Automatic
rollout is verified at the public-asset boundary; authenticated role-specific
HR workflows remain outside this visual review.


UI-20261030-R — Browser regressions and workflow reliability (locally verified)

- Added `npm run test:browser`: 73 synthetic checks across 1440, 1280, 768,
  390 and 320px document widths using the existing modal, directory/table,
  workspace/auth and Attendance fixtures. Includes actual employee navigation,
  scoped persistence rollback/retry, unsaved edits, error associations, picker
  keyboard handlers, directory filter/search/page-size recovery, Attendance
  failed-save/retry and loading state checks.
- Fixed Attendance's post-confirmation submission race and exposed accessible
  roster-refresh busy state with stale-request protection. Updated import cache
  versions. No schema, permission, data-fetching or attendance-rule changes.
- Added a dependency-free loopback runner, validated ignored JSON reports,
  optional disposable-profile Chrome/Edge headless mode and a separate read-only
  GitHub UI regression workflow. Existing deployment behavior is unchanged.
  Workspace fixture port moved to 4191 because Node fetch rejects port 4190.
- Final verification: 73/73 browser checks; lint, 411 Node tests, production
  build, explicit structural validation and diff checks passed. Initial mock and
  browser-harness failures were corrected; no unresolved gate failure remains.
  Synthetic frontend render medians: cached profile 0.7ms, directory with 250
  records 1.5ms, directory with 10,000 records 1.8ms; only 25 rows rendered.
- Docs: `docs/BROWSER-REGRESSIONS.md`, README, UI consistency and MASTER record
  commands, coverage, measurements and limits. Offline fallback fonts, scripted
  handler events and fixed 900px iframe height are intentional test boundaries.
- Publication: implementation `11eefe0` pushed to `origin/main`; remote HEAD
  verified as `11eefe0a3c0aa2d94884bec0f8e278ab5267d35b`. Commit includes
  summary, description, validation and limits. No deployment performed.
  Optional headless launcher,
  hosted CI, authenticated backend workflows, screen-reader/physical-device
  acceptance and production performance remain unverified. No production data.


HR-20261030-GOV — Government ID uniqueness (implementation locally verified)

- Added shared employee ID comparisons and field errors for SSS, PhilHealth,
  Pag-IBIG and BIR TIN. Separators are ignored, leading zeroes preserved and TIN
  identity uses the first nine digits. Optional blanks, own-record edits and
  independent ID types remain valid. No duplicate override is offered.
- Employee creation/full/scoped persistence, Excel preview validation and
  onboarding-to-employee conversion use the rule. Database conflict messages
  identify the field without revealing another employee's ID or identity.
- Added ordered migration 0065: four tenant-scoped partial unique indexes and
  a generic existing-duplicate preflight. The transaction locks writes while
  installing the rule and aborts safely on duplicates or lock timeout. No
  employee rewrite, destructive operation, RLS/permission change or dependency.
  Updated the validation script's authoritative ordered migration inventory.
- Verification: 419 Node tests, 78 browser cases across five widths, lint,
  build, explicit validation and diff checks passed. The actual migration
  passed an isolated in-memory PGlite rehearsal for pre-existing duplicate
  rollback, formatting/TIN normalization, blanks, edits, tenant/type isolation,
  update conflicts and single-statement batch rejection. Test-only PGlite was
  installed outside the repository; no live database was contacted.
- Browser harness initially lacked the existing input formatter; it now uses
  real formatter/format-validation functions and all five new cases pass.
  The initial structural gate required adding 0065 to its migration inventory;
  the full gate then passed without weakening validation.
- Docs: GOVERNMENT-ID-UNIQUENESS.md, EMPLOYEE-IMPORT-EXPORT.md, DEPLOYMENT.md
  and browser coverage document describe behavior, migration order and limits.
- Rollout: migration 0065 must be installed for authoritative enforcement.
  Existing production duplicates and live installation are unverified. Scoped
  or stale client data can miss a conflict until the database rejects it. The
  existing 250-record multi-batch save service is not an atomic full import;
  earlier batches can remain saved if a later batch fails. No workflow rewrite.
- Publication: implementation `d70f05e` pushed to `origin/main`; remote HEAD
  verified as `d70f05e5e7a3d624f8cc979c9488bef3f31a9cea`. Commit includes
  summary, description, validation and migration/rollout limits.


HR-20261030-GOV-OWNER — Duplicate government ID owner context (locally verified)

- Form, scoped-edit, import and onboarding duplicate errors now include permitted
  owner context as Client assigned | Department | Position | Name. Existing
  clientName is used when recorded; otherwise Client not assigned. No client
  assignment feature or invented company relationship was added.
- Added migration 0066 after 0065: a security-invoker owner lookup restricted to
  authenticated users with employee view and create/update permission. Tenant,
  existing RLS and record scope checks remain enforced. Only four display fields
  are returned; stored government IDs and record IDs are excluded. Requests are
  bounded to one 250-record save batch. No data rewrite or RLS policy change.
- Failed employee upserts enrich their existing uniqueness error using only
  the failed batch. Denied, missing or unavailable lookup retains generic
  rejection. Normal successful saves do not run this lookup. Existing uniqueness
  indexes, rollback, correction and no-override behavior remain unchanged.
- Verification: 422 Node tests; 78 browser checks at five document widths;
  lint, build, explicit structural validation and diff checks passed. The actual
  migration passed isolated PGlite tests under an authenticated role for all
  four ID types, minimal output, owner-name formatting, own-record exclusion,
  tenant/scope/RLS isolation, authentication/permission denial and batch bounds.
  Existing migration 0065 uniqueness/rollback checks also passed.
- Captured the requested Company Y | Sales | Merchandiser | Dela Cruz, Juan
  display using synthetic records only. No production records were accessed.
- Docs: government ID uniqueness, deployment and browser coverage describe the
  permitted metadata, fallback behavior and migration requirement. Hosted CI,
  full Supabase acceptance and live migration 0066 installation are unverified.
- Publication: implementation `7af8895` pushed to `origin/main`; remote HEAD
  verified as `7af889587d700c453fe98742a99749452def091c`. Commit includes
  summary, description, validation and migration/authorization limits.


UI-20261030-COMPACT — Compact enterprise controls (locally verified)

- Baseline on clean main: 422 Node tests / 78 browser checks passed. Captured
  1440px computed dimensions and screenshots before changes. Followed the
  pasted brief's 36px desktop toolbar / 40px form targets, superseding prior
  42/44px specifications. Phone/coarse controls retain 44–48px targets.
- Refined app.css semantic sizing, search widths (320px / 360px maximum),
  spacing and padding tokens. Height tokens accommodate enlarged control text.
  Existing feature/shared CSS consumes them; no new override layer or dependency.
  Ordinary rows remain 40px; pagination 34px; Attendance matrix/checks unchanged.
- Added proportional employee fields, purpose-sized wide filters, narrower
  numbers/dates/currency, consistent toolbar/button/icon alignment and an 80px
  desktop header. Preserved 721–1499px filter disclosure and mobile panels.
  Existing palette roles and fonts remain, with darker muted/placeholder/error
  text for measured contrast. All data rules, queries and permissions preserved.
- Fixed missing label associations in Movement/Transfer markup; added IDs only
  to previously unnamed disabled display fields. No event-handler change.
- Expanded existing synthetic browser fixtures to all seven requested widths
  and shared toolbar/real manpower renderer coverage. Corrected fixture-only
  shell, hidden-field, wrapper-focus and scrollbar assumptions. Added an
  unrounded contrast-calculation unit regression.
- Final verification: 423 Node tests, 175 browser checks, lint, build, explicit
  validation and diff checks passed. Verified enlarged control text, 320×568
  dialog actions and 960×540 zoom-equivalent reflow. Before/after examples:
  search 42×480 to 36×320px, form height 44 to 40px, date width about 467 to
  147px, header 96 to 80px. Pagination, table rows and textareas retain density.
- Updated MASTER, UI-CONSISTENCY, BROWSER-REGRESSIONS and README with current
  standards, ownership, measured dimensions, exceptions and coverage boundaries.
- Limits: fixture/source review is not authenticated production acceptance.
  Physical coarse-pointer devices, screen readers, native browser zoom and
  exhaustive hover/browser/dialog coverage remain unverified. No production data.
- Publication: implementation `dfe8d18` pushed to `origin/main`; remote HEAD
  verified as `dfe8d187e5330c9ab12f1536c4a57fc2a7dd372c`. Commit includes
  summary, description, validation and remaining acceptance limits.


ATT-20261030-EDIT — Preserve Late/UT edits (locally verified)

- Reopen actual duty times from the staged entry, then saved entry, before
  falling back to the reviewed schedule. Retain custom employee-only scheduled
  minutes when changing transaction type before saving.
- Cancel preserves prior data; identical restaging preserves undo history.
  Existing validation, permissions, concurrency hashes and batch saves remain.
- Changed attendance-preparation.js, application cache versions, the browser
  regression suite and Attendance documentation. No database migration.
- Verification: npm run lint; npm test (423 passed); npm run build;
  node scripts/validate.mjs; git diff --check. All succeeded.
- Browser runner: 179/179 checks passed, including new minute/time editor
  regression cases at 1440px and 390px for stage, reopen, cancel, transaction
  change, save and undo/redo. Synthetic records and mocked RPC saves only;
  live database writes and full-app Escape/backdrop behavior were not tested.
- Publication: implementation `4eb3ec2` pushed to `origin/main`; remote
  `refs/heads/main` verified as `4eb3ec2206123a39db61e04d11d3bfeb9ff720bf`.
  The implementation commit includes Summary, Description and validation.


ATT-20261031-CORRECT — Replace mistaken Late/UT entries (locally verified)

- Reproduced the reported validation error with an existing employee-only
  record containing scheduled minutes as text. Earlier tests covered numeric
  values only. Safely normalize whole-minute text before existing validation;
  malformed, fractional and out-of-range minutes remain rejected.
- Present, Day-off, Absent, paid/unpaid Leave and AWOL/P replacements retain
  scheduled minutes and clear both Late/UT values. Permissions, source/record
  hashes, reviewed-duty rules and batch persistence are unchanged.
- Updated matrix helper, full application import cache versions, unit/browser
  regressions, synthetic legacy fixture and Attendance correction instructions.
- Verification: new unit regression failed before the fix and passed after it;
  lint, 424 tests, build, structural validation and diff checks passed.
  Browser regression runner: 181/181 checks passed, including replacement and
  mocked persistence checks at 1440px and 390px using synthetic saved records.
- Deployment investigation: the live index served app.js?v=20261030-5 and the
  previous editor patch on 2026-10-31; that patch did not address this text-minute
  validation failure. No authenticated production records or writes were used.
- Publication: `1d72cb91765715f7379757653eb9ddb1f9f779ab` pushed to
  `origin/main`; the remote reference matched. Commit contains Summary,
  Description and validation results.
- Live verification on 2026-10-31: GitHub commit status for Vercel - strellas-hr
  reported deployment completed. Cache-busted live index plus versioned app,
  preparation and matrix JavaScript matched local files after line-ending
  normalization. Index loads app.js?v=20261031-1 through the full import chain.
  The ordinary homepage request still returned an older cached index; use a
  fresh query URL or hard reload to load this version. No authenticated live
  correction/save was performed; persistence tests used mocked fixture RPCs.
