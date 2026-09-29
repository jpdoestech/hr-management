-- SLSC HRIS operational data reset
-- DESTRUCTIVE: removes employee/applicant/HR records, cases, requests, and audit history.
-- PRESERVED: auth.users, public.profiles, public.hr_settings, and public.hr_user_preferences.
--
-- Required file cleanup before running:
-- 1. Supabase Dashboard > Storage > hr-documents > Empty bucket.
-- 2. If Google Drive storage was used, delete the HRIS-created module folders/files
--    below the configured Google Drive root folder.
--
-- Never delete directly from storage.objects. That removes only metadata and can
-- orphan the physical file. This script aborts while the Supabase bucket is nonempty.

begin;

do $$
begin
  if exists (
    select 1
    from storage.objects
    where bucket_id = 'hr-documents'
  ) then
    raise exception
      'Reset stopped: empty the hr-documents bucket through Supabase Storage first.';
  end if;
end
$$;

-- Preserve login/profile rows, but remove links to employee records being deleted.
update public.profiles
set employee_record_id = null,
    updated_at = now()
where employee_record_id is not null;

-- Delete dependent operational data before the master HR records.
delete from public.hr_case_activity;
delete from public.hr_case_links;
delete from public.hr_cases;
delete from public.hr_service_requests;

-- All module records live here, including employees, applicants, memos, NTE,
-- NOD, leave, PRF, ATD, incidents, evaluations, documents, and checklists.
delete from public.hr_records;

-- Remove legacy state and operational audit history.
delete from public.hr_app_state;
delete from public.hr_audit_logs;

commit;

-- Verification: all counts should be zero.
select 'hr_records' as table_name, count(*) as remaining_rows from public.hr_records
union all
select 'hr_cases', count(*) from public.hr_cases
union all
select 'hr_case_links', count(*) from public.hr_case_links
union all
select 'hr_case_activity', count(*) from public.hr_case_activity
union all
select 'hr_service_requests', count(*) from public.hr_service_requests
union all
select 'hr_audit_logs', count(*) from public.hr_audit_logs
union all
select 'hr_app_state', count(*) from public.hr_app_state;

-- User verification: these rows are intentionally preserved.
select count(*) as preserved_profiles from public.profiles;

