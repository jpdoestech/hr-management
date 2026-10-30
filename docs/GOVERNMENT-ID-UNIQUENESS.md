# Employee government ID uniqueness

## Rule

SSS Number, PhilHealth PIN, Pag-IBIG MID and BIR TIN must each be unique
among employee master records in the same tenant, including inactive and
separated employees. Different ID types have independent namespaces. Blank
values remain optional; existing length and format validation is unchanged.
Comparison strips non-ASCII-digit separators and preserves leading zeroes.
TIN uses its first nine digits, so adding or changing its optional three-digit
branch suffix does not create a different employee identity.

Applicant records can retain their own IDs before conversion. Conversion to
an employee checks the employee registry; applicant/employee records belonging
to the same person are not treated as two employee master records.

## Enforcement

`js/core/government-ids.js` supplies normalized comparisons and safe field
messages. The shared employee persistence path covers creation, full editing
and Government IDs section editing. Excel validation compares against loaded
employee records and accepted workbook rows, including preview corrections.
Onboarding conversion checks before changing the applicant or employee list.
Conflicts keep the entered values for correction and do not offer an override.

Client data may be scoped, stale or incomplete. Migration
`0065_employee_government_id_uniqueness.sql` is the authoritative protection:
four partial unique indexes on tenant and normalized ID reject duplicate
inserts, updates, direct writes and conflicting writes to the same key. This
uses PostgreSQL's [unique index enforcement](https://www.postgresql.org/docs/current/indexes-unique.html).
The indexes exclude missing/empty normalized IDs and non-employee modules.
No RLS, roles, permissions, authentication logic or stored values are changed.

Known database uniqueness errors map to a field-specific message. Neither
messages nor logs identify the other employee or expose their government ID.
The existing employee rollback and failure-retry behavior is preserved.

## Rollout and existing duplicates

Apply migration 0065 through the normal documented migration workflow before
relying on database enforcement. It locks writes to `hr_records` while checking
and creating indexes, with a five-second lock-acquisition timeout. Retry during
a suitable window if lock acquisition times out.

If existing employee IDs collide after normalization, the transaction aborts
with a generic review message and no data changes. It does not renumber, clear,
merge or delete any employee record. An authorized HR operator must privately
verify the real identifiers, correct the affected records using an approved
process, then retry. Do not paste identifiers or employee records into issues,
CI output or test fixtures. The frontend change alone cannot guarantee uniqueness
against records it has not loaded until the migration is installed.

A single failed database write statement rolls back as a unit. The existing
save service can send large changes in separate 250-record batches; this change
does not turn the complete multi-batch import into a single transaction. A late
conflict can leave earlier batches saved. Review and reload after a failed large
import before retrying; never assume a cross-batch rollback occurred.

## Validation

`npm test` covers each ID type, formatting variants, leading zeroes, blank
values, same-record edits, cross-type values, TIN suffixes, safe database error
mapping, shared employee persistence, import duplicates and onboarding rejection.
`npm run test:browser` adds five Government IDs section cases: duplicate errors
on all four fields, retained input, no attempted save, then a successful unique
correction. These run at 1440, 1280, 768, 390 and 320px alongside the existing
browser checks. The fixture uses the real formatting and uniqueness helpers.

For the isolated SQL rehearsal, install PGlite in a temporary directory outside
the repository and run:

```
node tests/database/government-id-uniqueness.mjs /absolute/path/to/pglite/dist/index.js
```

The script constructs an in-memory database using [PGlite](https://pglite.dev/docs/api);
it accepts a local module path, not a database connection URL. It applies the
actual migration and verifies pre-existing duplicate rejection without data
changes, four indexes, normalization parity, optional blanks, self-updates,
tenant/type separation, update collisions and atomic single-statement batch
rejection. It never reads or writes a live database and adds no application
dependency. It does not reproduce multi-connection scheduling or the entire
Supabase RLS/migration environment.

Local results and publication references are recorded in ROADMAP.md. Live
migration installation and existing production data have not been inspected.
