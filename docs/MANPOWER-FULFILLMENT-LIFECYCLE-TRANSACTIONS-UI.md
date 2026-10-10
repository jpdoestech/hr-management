# Submitted request lifecycle UI - MP-A14

Specification: sections 4.3, 4.4 and 5.2. Inspected `origin/main` at
`99a28c9`, matching the local branch. This application slice does not complete
the manpower specification or authorize database release.

## Behavior

- Authorized submitted-request viewers with `manpower.update` see Close and
  Cancel for Open requests, or Reopen for Closed/Cancelled requests. Drafts
  retain their existing workflow. Read-only viewers have no mutation controls.
- Open requisition lines expose cancellation of outstanding unfilled demand.
  The selected saved line and its request ID are reused; no unrelated worker,
  employment or assignment transaction is created.
- A compact inline action panel captures a mandatory trimmed reason of
  1-1000 characters and, for line cancellation, a positive integer quantity.
  The panel uses existing tokens and controls, stays at most 640px wide, wraps
  safety text and adapts to mobile/tablet. It does not introduce another modal.
- Explicit confirmation calls only the existing `change_manpower_lifecycle`
  RPC with the saved request revision. Permissions/session/context and entries
  are rechecked after confirmation. Duplicate writes/navigation are blocked
  during confirmation, write and refresh.
- Full request operations apply to every affected line, not just the visible
  page. Reserved/scheduled and historical fulfilled commitments are checked by
  the backend. Visible quantities provide an input upper bound only, never a
  replacement for authoritative capacity checks.
- Close/Cancel preserve deployed history and cancel remaining unfilled demand;
  Reopen never restores cancelled demand. Line cancellation leaves the request
  Open. Original and current authorized quantities remain read-only here.
- Save retains the selected request, section and bounded page. Discard restores
  the action controls and focus without leaving the request. Switching editors,
  sections, pages or workspace reuses Save/Discard/Keep editing behavior.
- Validation and backend errors retain input and focus an accessible alert.
  Missing RPC, stale revision, revoked access and unresolved reservations are
  errors, not silent success. Ambiguous responses require inspecting the saved
  request/lifecycle history before retrying; no automatic replay occurs.
- Lifecycle changes use the existing audited lifecycle history. The UI does
  not directly update headers/lines or manufacture history/audit records.

## SQL and rollout

No SQL files or historical migrations changed. No database server was installed
or started, and no SQL was executed. Production data, attachments, authentication,
RLS/RBAC and Supabase publishable configuration remain unchanged.

The authoritative backend is
[0042_manpower_lifecycle.sql](../supabase/proposals/0042_manpower_lifecycle.sql),
following reviewed proposals 0035-0041. It remains outside automatic migrations.
See [SQL setup and verification](MANPOWER-FULFILLMENT-QUANTITY-UI.md#sql-setup-and-verification)
for the read-only RPC/EXECUTE diagnostic and release safeguards, and
[lifecycle integrity SQL](../supabase/verification/manpower_lifecycle_integrity.sql)
for post-deployment checks after prerequisites are verified. Do not enable a
production workflow merely because a synthetic fixture passes.

## Verification

Pure/handler tests cover state-based/read-only actions, bounded line parent
projection, reason/quantity validation, unchanged baseline facts, expected RPC
responses, duplicate clicks, retained errors, cancellation, permission/session/
request/input changes during confirmation, Save/Discard/Keep navigation,
pending workspace navigation and busy-refresh protection.

The local browser fixture contains only synthetic records and in-memory RPC
responses, no Supabase credentials or real employee data. Verified page-two
line cancellation (11-20 of 31), Close, Reopen without restoring cancellation,
Discard, retained reservation errors and missing-RPC guidance. At 390x844,
768x1024 and 1440x900 the document did not horizontally overflow and the panel
remained within its content width; mobile/tablet actions were 44px high.

Actual project command results and publication are recorded in ROADMAP.
Browser/handler evidence is not new live SQL, concurrency or RLS validation.

## Remaining

Submitted header/date/numbering amendments; authoritative onboarding
reservation/deployment UI; identity/on-call eligibility; worker/timeline views;
reporting/export integration; legacy reconciliation; coordinated database
release and live security/end-to-end acceptance remain incomplete.

Commit remarks: connect reasoned request close/cancel/reopen and line demand
cancellation to the existing lifecycle API, retaining request/page context,
unsaved navigation, accessible responsive validation and all release gates.
