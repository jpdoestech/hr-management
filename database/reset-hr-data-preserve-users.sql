-- SLSC HRIS operational data reset
-- DESTRUCTIVE: removes employee/applicant/HR records, cases, requests, and audit history.
-- PRESERVED: auth.users, public.profiles, public.hr_settings, and public.hr_user_preferences.
--
-- Run this entire file in Supabase Dashboard > SQL Editor as the project owner.
-- The reset is migration-tolerant: optional tables that do not exist are skipped.
-- This version creates no helper table, so Supabase will not show an RLS warning.
--
-- IMPORTANT: deploy the current app version and close every open HRIS browser tab
-- before running this reset. The reset marker below prevents current clients from
-- writing a pre-reset in-memory copy back to the database.
--
-- Uploaded files require separate cleanup:
-- 1. Supabase Dashboard > Storage > hr-documents > Empty bucket.
-- 2. For Google Drive, delete the HRIS-created module folders below the configured root.
-- SQL must not delete directly from storage.objects because that can leave physical
-- files orphaned. The final notice reports how many Supabase files still need cleanup.

begin;

do $$
declare
  target_table text;
  affected bigint;
  remaining bigint;
  storage_files bigint := 0;
  reset_at text := clock_timestamp()::text;
begin
  -- Preserve login/profile rows while removing links to deleted employee records.
  if to_regclass('public.profiles') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'profiles'
         and column_name = 'employee_record_id'
     ) then
    update public.profiles
    set employee_record_id = null,
        updated_at = now()
    where employee_record_id is not null;
  end if;

  -- Stamp the preserved settings row. The app compares this marker before every
  -- write so an already-open page cannot silently restore the deleted records.
  if to_regclass('public.hr_settings') is not null then
    update public.hr_settings
    set data = jsonb_set(coalesce(data, '{}'::jsonb), '{dataResetAt}', to_jsonb(reset_at), true),
        updated_at = now(),
        updated_by = null
    where id = 'singleton';
  end if;

  -- Dependency order matters. Each table is optional so the script also works
  -- when only part of the migration set has been installed.
  foreach target_table in array array[
    'hr_case_activity',
    'hr_case_links',
    'hr_cases',
    'hr_service_requests',
    'hr_records',
    'hr_app_state',
    'hr_audit_logs'
  ] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('delete from public.%I', target_table);
      get diagnostics affected = row_count;
      execute format('select count(*) from public.%I', target_table) into remaining;
      if remaining <> 0 then
        raise exception 'Reset failed: public.% still contains % row(s)', target_table, remaining;
      end if;
      raise notice 'RESET OK: public.% deleted % row(s); 0 remain', target_table, affected;
    else
      raise notice 'RESET SKIPPED: optional table public.% is not installed', target_table;
    end if;
  end loop;

  if to_regclass('storage.objects') is not null then
    select count(*) into storage_files
    from storage.objects
    where bucket_id = 'hr-documents';
  end if;

  raise notice 'RESET MARKER: %', reset_at;
  raise notice 'STORAGE: % file(s) remain in hr-documents and require Storage cleanup', storage_files;
end
$$;

commit;

-- A successful result means the transaction committed. Any nonzero operational
-- table count raises an exception above and rolls the entire reset back.
select
  'HR operational data reset completed' as result,
  (select count(*) from public.profiles) as preserved_profiles,
  (select data ->> 'dataResetAt' from public.hr_settings where id = 'singleton') as reset_marker;

