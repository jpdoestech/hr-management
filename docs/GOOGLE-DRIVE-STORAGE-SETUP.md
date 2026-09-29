# Google Drive File Storage Setup

This guide configures Google Drive as the destination for new HRIS uploads. Only a System Administrator can change the storage provider. Existing files remain in their original storage location.

## 1. Apply the Required Supabase Migration

1. Sign in to the Supabase dashboard and open the HRIS project.
2. Select **SQL Editor** and click **New query**.
3. Open `supabase/phase14-admin-storage-settings.sql` from this repository.
4. Copy the complete SQL file into the query editor.
5. Click **Run** and confirm that it finishes successfully.

Run only the Phase 14 migration. Do not rerun the complete schema on an existing database.

## 2. Create the Drive Root Folder

1. Sign in to the Google account that will own the HR documents.
2. Create a folder such as `SLSC HR Files` in Google Drive.
3. Share the folder with every HR Google account that will upload or open documents.
4. Give upload users **Editor** access.
5. Open the folder and copy its complete URL.

The HRIS creates module folders such as `leave`, `atd`, `cvr`, `prf`, and `onboarding` inside this root folder when they are first needed.

## 3. Create or Select a Google Cloud Project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select an existing project or create a dedicated HRIS project.
3. Keep the project name and owner information recognizable to your administrators.

## 4. Enable Google Drive API

1. In Google Cloud Console, open **APIs & Services** and then **Library**.
2. Search for **Google Drive API**.
3. Open it and click **Enable**.

## 5. Configure the OAuth Consent Screen

1. Open **Google Auth Platform**.
2. Under **Branding**, enter the app name, support email, and developer contact email.
3. Under **Audience**, choose the appropriate user type:
   - Choose **Internal** when the project belongs to the SLSC Google Workspace organization and only organization members will use it.
   - Choose **External** when users may use accounts outside that Workspace organization.
4. Under **Data Access**, add the Google Drive scope requested by the application:

   `https://www.googleapis.com/auth/drive`

5. Save the configuration.

The current HRIS root-folder workflow needs this Drive scope to locate the configured folder, create module folders, upload files, and remove replaced files. Public external use of this restricted scope requires Google verification.

## 6. Add Test Users

Complete this section while an External OAuth application is in **Testing** status.

1. Open **Google Auth Platform > Audience**.
2. Find **Test users** and click **Add users**.
3. Add the exact Google email address of every person testing Drive uploads.
4. Save the list and wait a few minutes for the change to propagate.

If Google displays `Error 403: access_denied` and says the app can only be accessed by developer-approved testers, the account selected in the Google popup is not on this list. Add that exact account and retry.

## 7. Create the OAuth Web Client

1. Open **Google Auth Platform > Clients**.
2. Click **Create Client**.
3. Select **Web application**.
4. Give it a clear name such as `SLSC HRIS Web`.
5. Add every exact application origin under **Authorized JavaScript origins**.

Production:

```text
https://slsc-eis.vercel.app
```

Local preview:

```text
http://localhost:4173
```

6. Add other deployed origins if the application is hosted on another domain.
7. Do not add page paths, query strings, or a trailing route. An origin contains only the scheme, hostname, and optional port.
8. Create the client and copy the Client ID ending in `.apps.googleusercontent.com`.

The browser integration does not use a Google client secret. Never add a client secret to frontend code or HRIS settings.

## 8. Configure HRIS Settings

1. Sign in to the HRIS using a System Administrator account.
2. Open **Settings**.
3. Under file storage, select **Google Drive**.
4. Paste the **Google Drive Root Folder URL**.
5. Paste the **Google OAuth Web Client ID**.
6. Click **Test Drive Connection**.
7. Select an approved Google account and grant access.
8. After the connection succeeds, click **Save Settings**.

OAuth access tokens remain in browser memory and are not saved in the HRIS database.

## 9. Verify a Real Upload

1. Open an HR module that accepts an attachment, such as Leave Tracker, NTE, CVR, ATD, or Onboarding.
2. Select an employee and complete the required form fields before choosing the file.
3. Choose a small test PDF and save the record.
4. Open the configured Drive root folder.
5. Confirm that the correct module folder was created and contains the file.
6. Confirm that the filename follows this format:

```text
Last Name, First Name_EmployeeNumber_Department_DocumentType.extension
```

Example:

```text
Dela Cruz, Juan_0001_Production_nod.pdf
```

Applicant files use the PRF number until an employee number exists. Specialized documents use a specific type such as `payslip`, `quotation-soa`, or `incident-report`.

## 10. Troubleshooting

### Error 403: access_denied

Add the exact Google account to **Google Auth Platform > Audience > Test users**, then retry with that account.

### Origin is not allowed

Add the exact browser origin to the OAuth Web Client's **Authorized JavaScript origins**. Confirm that `https://slsc-eis.vercel.app` is entered without a page path.

### Drive folder cannot be opened

Confirm that the root URL points to a Google Drive folder and that the account selected in the OAuth popup has Editor access to it.

### Google popup does not appear

Allow popups for the HRIS domain and retry **Test Drive Connection**.

### Drive API is disabled

Enable Google Drive API in the same Google Cloud project that owns the OAuth Client ID, wait a few minutes, and retry.

### Production access for external users

Testing mode is limited to approved testers. For broader External access, complete Google's OAuth verification process for the requested Drive scope. For an organization-only deployment, prefer an Internal audience in a Google Workspace-owned project.

## Supabase Storage Alternative

To return new uploads to Supabase, sign in as a System Administrator, open **Settings**, select **Supabase Storage**, and save. No existing Google Drive files are moved or deleted.
