# TDA Catalog Import

The Offense Catalog accepts the approved Table of Disciplinary Action workbook format used by `TDA_Industrial.xlsx`.

## Access

Only a System Administrator can import a TDA workbook. HR users with edit access can maintain individual catalog entries after import.

## Workbook format

The importer reads `TDA-OFFENSES` when present, otherwise the first worksheet. It requires these columns:

`NO.`, `OFFENSES TYPE`, `OFFENSES REMARKS`, `1st`, `2nd`, `3rd`, `4th`, and `5th`.

`DISCIPLINARY REMARKS` may remain formula-driven in the source workbook. The application deliberately recalculates it during import: a first-occurrence consequence of `DISMISSAL` becomes `GRIEVANCE/<OFFENSES TYPE>`; other rows use their offense type. This avoids relying on stale Excel or Google Sheets formula results.

## Applicability

Each import batch records:

- TDA type, such as `Industrial`
- all clients or one named client/account
- all configured branches or selected branches
- all departments or selected departments

Client/account is stored as catalog applicability metadata for now. When a formal client-under-branch directory is introduced, these values can be migrated to stable client identifiers without changing the imported offense data.

## Conflict handling

- **Skip duplicates** keeps existing matching offenses.
- **Update matching offenses** replaces the five consequences and workbook metadata for an offense with the same applicability scope.
- **Replace matching scope** removes the existing catalog entries for the selected type/client/branch/department scope, then imports the workbook rows.

The complete workbook is validated before records are saved. Every successful import is stamped with its source file, sheet, batch identifier, time, and user.
