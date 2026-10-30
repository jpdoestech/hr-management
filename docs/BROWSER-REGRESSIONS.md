# Browser regression checks

## Running the suite

Use Node 24 and an installed modern browser. Run `npm run test:browser` from
the repository root and open the URL printed by the command. The page runs
its checks automatically and posts the complete result to its loopback server.
The command exits 0 only when every expected scenario passes; failures, invalid
or incomplete reports, fixture startup errors and the 180-second deadline exit
nonzero. Ctrl+C stops the runner and its own fixture processes.

`npm run test:browser -- --headless` launches an installed Chrome/Edge with a
new disposable profile. `BROWSER_BIN` can specify the executable. No browser
installation or npm dependency is performed. It uses Chrome's documented
[headless interface](https://developer.chrome.com/docs/automation-and-testing/headless).
The runner never uses a personal browser profile or disables the browser sandbox.

The four existing fixtures use loopback ports 4187 (employee modal), 4194
(directory/tables), 4191 (workspace/auth) and 4189 (Attendance). Stop separately
started fixtures before running the suite. Occupied ports fail explicitly;
unrelated processes are never terminated. The workspace fixture moved from
4190 because Node fetch rejects that restricted port.

## Coverage and boundaries

The suite uses actual source renderers/helpers, production stylesheet links in
load order, and synthetic records. Authentication, storage, audit transport and
Supabase I/O are stubbed. Source employee section-save/persistence and navigation
functions execute against in-memory records, including rollback and retry.
Attendance runs the production module against a synthetic RPC adapter. The
workspace/auth fixture uses representative shell markup and registration handlers;
it does not sign in, register an account or validate backend authorization.

There are 73 checks: 14 scenarios at 1440, 1280, 768, 390 and 320px document
widths, plus three desktop performance samples. Every iframe is 900px high;
these widths are layout tests, not physical-device or short-screen emulation.

- Form dimensions, hidden/disabled inputs, visible focus, keyboard employee
  picker selection/Escape, native checkbox behavior and associated field errors.
- History to Overview navigation, viewer navigation and repeated navigation.
- Emergency Information scoped save, delayed failure, rollback, retained input,
  retry, duplicate-submission protection and exactly one successful history entry.
- Keep editing/discard confirmation without unintended persistence.
- Debounced directory search with focus recovery, department filtering, reset,
  next page, page-size change and bounded DOM row count.
- Shared table column sort/filter/clear, sticky headers, pagination sizing,
  table density, mobile request cards and absence of document horizontal overflow.
- Sign-in/registration geometry and password action targets via workspace checks.
- Attendance keyboard staging, failed batch/retry, repeated save, unavailable
  roster/retry, delayed refresh busy state, sticky employee column and intentional
  16px matrix checkboxes.

DOM click/input/keyboard events exercise handlers. They do not replace trusted
keyboard traversal, screen-reader testing, native popup testing or authenticated
end-to-end acceptance. Address data and backend transport remain fixture stubs.

To keep the suite deterministic and offline, the proxy removes external font
links and blocks external connections and native form posts with CSP. This suite
uses fallback fonts; the standalone fixtures retain production font links for
separate visual checks. It serves only fixture pages, styles, assets and shared
core modules, not application configuration or confidential records.

## Results and performance

The ignored `artifacts/browser-regression.json` contains case IDs, pass/fail,
durations, bounded error messages and numeric metrics. Complete report IDs and
a per-run nonce are validated before accepting results. The console lists all
failures and performance summaries. No employee records are written to reports.

The directory sample creates 250 and 10,000 synthetic records and renders only
25 rows per page. Eight synchronous renderer calls produce seven warm samples;
the first is discarded. The profile sample measures cached synthetic overview
markup rendering. These are frontend execution timings, not network, backend,
full-paint or production latency. Search timing includes the existing debounce.
There is no machine-dependent timing threshold in CI; bounded row counts are
asserted. Optimize only after measurements identify a real bottleneck.

The separate `UI regression checks` GitHub workflow runs Node tests and the
headless command on pull requests and main pushes with read-only repository
permissions. It neither deploys nor gates the existing deployment workflow;
branch protection is an administrator decision. A local browser pass does not
establish that the hosted workflow or optional headless launcher has run.

## Local verification — 2026-10-30

Results are also recorded in ROADMAP.md. The suite exposed and now covers two
Attendance fixes: recheck the busy/draft guard after asynchronous confirmation,
and expose `aria-busy` on an existing roster during refresh, clearing it for
the latest request. Backend conflict handling, staged edits, permissions, matrix
sizing and attendance business rules are preserved. No database changes.


Final local run: 73/73 browser checks passed using the available in-app Chromium
browser. Lint, 411 Node tests, build, explicit structural validation and diff
checks passed. The first Node gate exposed an outdated minimal DOM mock without
attribute methods; it was updated and the complete gate rerun successfully.
The new unit case verifies that stale requests cannot clear the latest request's
busy state. Initial browser harness failures from asset paths, animation-frame
scheduling and fixture assumptions were corrected before the final pass.

| Synthetic frontend operation | Warm median | Maximum |
| --- | ---: | ---: |
| Cached overview markup | 0.7ms | 1.4ms |
| Directory render, 250 records / 25 DOM rows | 1.5ms | 2.3ms |
| Directory render, 10,000 records / 25 DOM rows | 1.8ms | 2.1ms |

Directory search settled in 883–985ms in this background browser run, including
the debounce and focus restoration scheduling. Background animation frames
are throttled, so this is not a production latency claim. No speculative
performance rewrite was justified by the bounded renderer samples.

The optional standalone headless launcher and hosted GitHub job have not been
executed in this session. Production fonts, screen readers, trusted Tab traversal,
short-screen devices, authenticated saves and database performance remain
separate acceptance checks. Publication status is recorded in ROADMAP.md.
