-- SCPA HR Management — Phase 3A
-- Role-based permissions for Administrator / HR Staff / Viewer
-- Run in Supabase SQL Editor.
--
-- Role model:
--   Administrator : full HR access + user management + settings
--   HR Staff       : create/update/delete HR records + audit logs
--   Viewer         : read-only HR records
--
-- This migration does NOT change authentication credentials or your
-- Supabase publishable key.

begin;

-- ---------------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------------
-- Everyone can see their own profile.
-- Administrators can see all profiles (needed for User Management).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_profile_role() = 'Administrator'
);

-- New profiles are created by the auth trigger (handle_new_user()).
-- Keep direct profile insertion disabled from the client.
drop policy if exists profiles_insert on public.profiles;

-- Only Administrators can edit profiles.
-- An Administrator cannot accidentally demote their own account.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update
on public.profiles
for update
to authenticated
using (
  public.current_profile_role() = 'Administrator'
)
with check (
  public.current_profile_role() = 'Administrator'
  and (id <> auth.uid() or role = 'Administrator')
);

-- No client-side profile deletion.
drop policy if exists profiles_delete on public.profiles;

-- ---------------------------------------------------------------------------
-- HR RECORDS
-- ---------------------------------------------------------------------------
-- All signed-in users may read HR records.
drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select
on public.hr_records
for select
to authenticated
using (true);

-- Administrator + HR Staff may create records.
drop policy if exists hr_records_insert on public.hr_records;
create policy hr_records_insert
on public.hr_records
for insert
to authenticated
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
);

-- Administrator + HR Staff may edit records.
drop policy if exists hr_records_update on public.hr_records;
create policy hr_records_update
on public.hr_records
for update
to authenticated
using (
  public.current_profile_role() in ('Administrator','HR Staff')
)
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
);

-- Administrator + HR Staff may delete records.
drop policy if exists hr_records_delete on public.hr_records;
create policy hr_records_delete
on public.hr_records
for delete
to authenticated
using (
  public.current_profile_role() in ('Administrator','HR Staff')
);

-- ---------------------------------------------------------------------------
-- SETTINGS
-- ---------------------------------------------------------------------------
-- All signed-in users can read organization settings.
drop policy if exists hr_settings_select on public.hr_settings;
create policy hr_settings_select
on public.hr_settings
for select
to authenticated
using (true);

-- Only Administrators may create/update/delete settings.
drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write
on public.hr_settings
for all
to authenticated
using (
  public.current_profile_role() = 'Administrator'
)
with check (
  public.current_profile_role() = 'Administrator'
);

-- ---------------------------------------------------------------------------
-- AUDIT LOGS
-- ---------------------------------------------------------------------------
-- All signed-in users can read the audit trail.
drop policy if exists hr_audit_select on public.hr_audit_logs;
create policy hr_audit_select
on public.hr_audit_logs
for select
to authenticated
using (true);

-- Administrator + HR Staff can write audit entries.
-- Viewers cannot create audit entries.
drop policy if exists hr_audit_insert on public.hr_audit_logs;
create policy hr_audit_insert
on public.hr_audit_logs
for insert
to authenticated
with check (
  public.current_profile_role() in ('Administrator','HR Staff')
);

-- No client-side audit-log updates/deletes.
drop policy if exists hr_audit_update on public.hr_audit_logs;
drop policy if exists hr_audit_delete on public.hr_audit_logs;

-- ---------------------------------------------------------------------------
-- LEGACY PHASE-1 STATE
-- ---------------------------------------------------------------------------
-- The current application uses hr_records/hr_settings, but the legacy table
-- remains for one-time migration compatibility. Keep it read-only to clients.
drop policy if exists legacy_state_select on public.hr_app_state;
create policy legacy_state_select
on public.hr_app_state
for select
to authenticated
using (true);

drop policy if exists legacy_state_write on public.hr_app_state;
drop policy if exists legacy_state_insert on public.hr_app_state;
drop policy if exists legacy_state_update on public.hr_app_state;
drop policy if exists legacy_state_delete on public.hr_app_state;

-- ---------------------------------------------------------------------------
-- STORAGE: private HR documents
-- ---------------------------------------------------------------------------
-- Signed-in users can read documents through the private bucket.
drop policy if exists hr_documents_select on storage.objects;
create policy hr_documents_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hr-documents'
);

-- Administrator + HR Staff can upload to their own user folder.
drop policy if exists hr_documents_insert on storage.objects;
create policy hr_documents_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hr-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.current_profile_role() in ('Administrator','HR Staff')
);

-- Users may delete files in their own folder; Administrators may delete any HR file.
drop policy if exists hr_documents_delete on storage.objects;
create policy hr_documents_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hr-documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_profile_role() = 'Administrator'
  )
);

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------
-- Run these separately after the migration if desired:
--
-- select id, full_name, username, email, role
-- from public.profiles
-- order by created_at;
--
-- select policyname, tablename, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname in ('public','storage')
--   and tablename in ('profiles','hr_records','hr_settings','hr_audit_logs','hr_app_state','objects')
-- order by schemaname, tablename, policyname;
