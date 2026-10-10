# Onboarding identity review

Specification sections 6, 7 and 12 Stage B; current main inspected at `450eea2`.
This connects the existing versioned identity backend to applicant details.

## Workflow

Onboarding & Applicants > applicant details > Review Identity. Users need
`onboarding.view`, `employees.view` and `onboarding.review_identity`; backend
authorization also checks both record scopes. The existing employee autocomplete
selects an actual employee record. The server preview returns only comparison
names/departments, conversion-link context, source fingerprints and review version.
No government IDs, addresses or source record JSON are exposed by the preview.

HR manually selects Same Person or Different People and provides a reason.
There is no default decision, automatic linking or destructive merge. The
versioned transaction checks the current fingerprints, revision, links and
assignment dependencies; it uses the existing audit architecture. Saved results
are verified before success. Source records, attachments and historical assignments
are not re-keyed or merged by the UI.

Confirmation locks input/actions and prevents duplicate saves and closing during
the transaction. Stale/missing/denied/dependency errors retain entries. Refresh
Comparison reloads evidence without silently saving the previous decision.
Changing the selected employee resets the decision/reason; manually typing over
the picker selection invalidates Save until an actual record is chosen again.
Success, Back, Escape and outside-click use the shared modal navigation, with
Save/Discard/Keep for unsaved changes, returning to the same applicant overview.

## Applicable SQL

No new SQL is introduced by this UI. Verify the reviewed existing identity
foundations and current dependency-aware implementation before enabling production
use. See proposals 0038, 0039 and 0043, reservation/source guards and the target
baseline. Follow [deployment procedures](DEPLOYMENT.md); do not replay historical
SQL, weaken dependency checks or assume source files prove live deployment.

Read-only diagnostics:

```sql
select to_regprocedure('public.preview_manpower_identity_review(text,text)')
  as preview_rpc;
select to_regprocedure(
  'public.record_manpower_identity_review(text,text,text,text,text,text,bigint)'
) as versioned_review_rpc;
```

NULL indicates absent setup. Presence alone does not prove current function
contents, EXECUTE privileges, scope/RLS enforcement or successful transactions.
Use authenticated synthetic users in a reviewed environment to test these; SQL
Editor owner privileges do not establish real-user authorization. No production
SQL, key/configuration changes or server installation/startup occurred.

## Verification

Nine focused tests cover pair/fingerprint/revision validation, explicit decisions,
reason bounds, comparison escaping, saved audit/version/result verification,
double-click locking, cancellation, retained backend errors, late-preview/session/
selection/access changes and shared return wiring. Full project checks are
recorded in ROADMAP. Existing backend tests remain in place; this UI change does
not claim a new live database security test.

The synthetic browser harness renders the actual controller-generated modal,
with picker/auth/confirmation/backend stubs. It verifies 390/768/1440 containment,
validation, successful return and stale-error retention. It does not verify the
real picker, authentication, shared confirmation overlay, live identity decision
or production end-to-end behavior. Layout review also corrected comparison-name/
department separation and mobile action/textarea sizing.

Still outstanding: automatic scoped identity-match discovery, authoritative
individual/bulk reservation preview and transaction UI, scheduling/confirmation/
conversion/transfer/ending/on-call workflows, line amendments, critical timeline,
aggregate reporting, legacy reconciliation and live acceptance. The full approved
specification is not complete.

Commit remarks: connect manual applicant identity review to existing scoped,
versioned audited APIs with responsive retained-context forms and no source merge.
