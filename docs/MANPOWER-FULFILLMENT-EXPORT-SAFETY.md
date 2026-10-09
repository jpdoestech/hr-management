# Manpower Export Safety Slice

Date: 2026-10-10. Roadmap ID MP-C01. This independent safety fix does not complete Stage C or enable quantity-model exports.

The existing legacy manpower CSV now uses a scoped serializer that prefixes formula-like text (including leading whitespace/control characters) with an apostrophe before CSV quoting. Header labels and getter results receive the same treatment. Numeric quantities, dates, quoted names, commas, null values and multiline text retain their existing serialization shape. Other modules' exports are unchanged.

`exportManpowerFulfillment` explicitly requires a session and `manpower.view` plus `manpower.export`, in addition to the existing export/download guards. Current search/branch/status/risk/type filtering is preserved. This does not establish a new server-side export boundary: the existing exporter operates on already-loaded, RLS-authorized legacy records. Revocation/stale-cache handling, paginated authoritative quantity-model CSV/Excel export and full privacy/performance acceptance remain future work.

Also refreshed the submitted-workspace import cache version so clients fetch Stage A9's amendment renderer rather than a cached prior module.

Validation: lint, 241 tests, production build and diff checks passed. Added cases cover formula prefixes, tabs/newlines/control/whitespace, headers/getters, ordinary content, cross-workspace permission denial and current export filters. No database, configuration, styles or production data were changed.

Commit remarks: harden legacy manpower CSV formula handling and explicit module permission checks; refresh the amendment module cache version.
