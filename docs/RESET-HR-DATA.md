# Reset HR Data While Preserving Users

Use this procedure only when you intentionally want to remove all operational HR data and start with an empty HR workspace.

The current reset also writes a marker into the preserved settings row. Before saving, the application compares its marker with the database so a browser tab that was open during the reset cannot restore deleted records.

The reset preserves:

- Supabase Auth users
- User profiles and roles
- System settings, including the configured storage provider
- Per-user interface preferences

The reset removes employee and applicant records, memos, NTE and NOD records, leave records, PRFs, ATD records, incidents, evaluations, lifecycle checklists, HR cases, service requests, document indexes, legacy state, and audit history.

## 1. Back Up Anything Required

Export or download any records and documents that must be retained. The reset cannot be undone after the transaction completes and storage files are removed.

## 2. Empty Supabase Storage

If Supabase Storage has been used:

1. Open the Supabase project dashboard.
2. Select **Storage**.
3. Open the **hr-documents** bucket.
4. Use **Empty bucket** to remove its files through the Storage service.
5. Confirm that the bucket is empty.

Do not run `delete from storage.objects`. Direct SQL deletion removes only Storage metadata and can leave billable physical files orphaned. You may empty the bucket before or after the database reset; a nonempty bucket is reported as a cleanup reminder and does not roll back the database reset.

## 3. Remove Google Drive Files

If Google Drive has been used:

1. Open the root folder configured in HRIS Settings.
2. Review the contents and preserve any required documents.
3. Delete the HRIS-created module folders or their files, such as `leave`, `atd`, `cvr`, `prf`, and `onboarding`.
4. Empty Google Drive trash when permanent removal is required by your retention policy.

SQL cannot remove files from Google Drive.

## 4. Run the Reset SQL

1. Deploy the current HRIS application version.
2. Close every open HRIS browser tab and installed-app window.
3. Open **Supabase Dashboard > SQL Editor**.
4. Create a new query.
5. Open `supabase/reset-hr-data-preserve-users.sql`.
6. Copy the complete script into the SQL Editor.
7. Review the preserved and deleted tables listed at the top of the script.
8. Click **Run** and accept the destructive-operation warning.

The destructive-operation warning is expected because the script intentionally deletes HR data. The revised script creates no helper table, so Supabase should not warn that `reset_hr_results` needs Row Level Security. Optional tables from migrations that are not installed are skipped safely.

## 5. Verify the Reset

The result must say `HR operational data reset completed`, retain the expected `preserved_profiles` count, and show a non-empty `reset_marker`. The Messages panel reports every deleted or skipped table and the number of files still in Supabase Storage. If an operational table is not empty, the script raises an error and rolls back instead of reporting success.

Reopen the HRIS after resetting. If an older browser tab attempts to save stale data, the current app rejects the write and asks the user to reload. Older deployments do not have this protection, which is why all HRIS tabs must be closed before the reset.

Sign back in to the HRIS and confirm:

1. Existing user accounts can still authenticate.
2. User roles remain unchanged.
3. Employee, applicant, memo, case, and other HR tables are empty.
4. Storage settings remain configured.
5. A new employee or applicant can be created normally.
