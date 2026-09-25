# SCPA HR Management — GitHub Pages + Vercel + Supabase

This package is the Phase 2 version of the SCPA HR Management & Disciplinary Dashboard.

It is designed so **the same codebase can run on both GitHub Pages and Vercel**, using one Supabase project for authentication, database, and private document storage.

## Architecture

```text
GitHub Repository
       |
       +--------------------+
       |                    |
       v                    v
 GitHub Pages             Vercel
 static frontend          static frontend
       |                    |
       +---------+----------+
                 v
             Supabase
       Auth + Postgres + Storage
```

### Phase 2 database changes

The original prototype stored the whole application in one browser/localStorage object. Phase 1 moved that state to one Supabase JSON document. Phase 2 removes that single shared application-state document from the active data path.

The application now uses:

- `profiles` — authenticated user profiles and roles
- `hr_records` — record-level HR data grouped by module (`employees`, `leaves`, `disciplinary`, `nte`, `memos`, `nod`, `oncall`, `transfers`, `offenseCatalog`, `cvr`, `incidents`, `prf`, `evaluations`, `atd`)
- `hr_settings` — organization settings
- `hr_audit_logs` — persistent audit trail
- `storage.objects` / private `hr-documents` bucket — uploaded HR documents

Each HR record has its own Postgres row and JSONB payload. This is intentionally a **record-level transitional model**: it removes the single-document overwrite problem while allowing the current UI to remain intact. A future Phase 3 can convert high-value modules such as Employees, Leaves, Incidents, and Disciplinary Actions into fully typed relational columns and foreign keys.

## 1. Configure Supabase

Create a Supabase project, then open **SQL Editor** and run:

`supabase/schema.sql`

The schema creates the application tables, RLS policies, Auth profile trigger, and private document bucket.

## 2. Configure the frontend

Open:

`supabase-config.js`

Replace:

```js
export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY';
```

with the values from your Supabase project.

Use the **publishable key / anon key**, never the Supabase service-role key.

The browser-side publishable/anon key is not a password. Security comes from Supabase Auth and Row Level Security (RLS).

## 3. Create the first Administrator

1. Register your first account from the login screen.
2. Confirm the email if Supabase email confirmation is enabled.
3. In Supabase SQL Editor, promote that profile:

```sql
update public.profiles
set role = 'Administrator'
where email = 'YOUR_ADMIN_EMAIL';
```

After that, use **User Management** in the application to manage roles.

## 4. GitHub Pages

Put the contents of this project in a GitHub repository.

In GitHub:

1. Open **Settings → Pages**.
2. Select **Deploy from a branch**.
3. Select your main branch and `/ (root)`.
4. Save.

The application is already using relative module imports, so it works under a repository path such as:

`https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`

No Node.js build is required.

## 5. Vercel

Import the **same GitHub repository** into Vercel.

Use the default/static deployment settings. No build command is required.

Vercel and GitHub Pages can therefore deploy the same commit independently.

## 6. Authentication settings

Supabase Auth must allow the URLs you actually use.

In **Supabase → Authentication → URL Configuration**, add your deployed application URLs, for example:

- GitHub Pages URL
- Vercel URL
- your production custom domain, if you add one later

For production, keep email confirmation enabled unless your organization has another controlled onboarding process.

## 7. Roles and permissions

- **Administrator** — profile/role administration and HR record management
- **HR Staff** — HR record management
- **Viewer** — read-only access

RLS is enforced in Supabase, so the browser UI is not the security boundary.

## 8. Documents

Uploaded documents are stored in the private `hr-documents` bucket.

The application:

- limits individual files to 10 MB
- stores files under the authenticated user's UUID path
- creates short-lived signed download URLs
- does not expose the bucket publicly
- does not perform OCR

## 9. Phase 1 migration support

The application contains a one-time compatibility path for the previous `hr_app_state` table.

If you already used the Phase 1 version:

1. Run the new `supabase/schema.sql`.
2. Keep the existing `hr_app_state` row.
3. Log into the new Phase 2 frontend.
4. The application detects an empty `hr_records` table and imports the old state into the new record-level structure.

After verifying the migration, `hr_app_state` can be retained as a backup or removed manually.

## 10. Recommended next phase

Phase 3 can make the most important HR entities fully relational:

- Employees
- Leave Requests
- Department Transfers
- Incidents
- CVRs
- Disciplinary Actions
- NTE / Memo / NOD workflow
- ATD and payments
- Probationary Evaluations

That would add foreign-key relationships, stronger validation, employee IDs instead of employee-name matching, database-level reporting, and safer concurrent editing.

## Security reminder

Never commit a Supabase **service-role key** to GitHub.

Only the public Supabase URL and publishable/anon key belong in `supabase-config.js`.
