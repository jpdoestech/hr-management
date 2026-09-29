-- SLSC HRIS operational data reset
-- DESTRUCTIVE: removes employee/applicant/HR records, cases, requests, and audit history.
-- PRESERVED: auth.users, public.profiles, public.hr_settings, and public.hr_user_preferences.
--
-- Run this entire file in Supabase Dashboard > SQL Editor as the project owner.
-- The reset is migration-tolerant: optional tables that do not exist are skipped.
--
-- Uploaded files require separate cleanup:
-- 1. Supabase Dashboard > Storage > hr-documents > Empty bucket.
-- 2. For Google Drive, delete the HRIS-created module folders below the configured root.
-- SQL must not delete directly from storage.objects because that can leave physical
-- files orphaned. The result table reports how many Supabase files still need cleanup.

begin;

create temporary table if not exists reset_hr_results (
  table_name text primary key,
  deleted_rows bigint not null default 0,
  remaining_rows bigint not null default 0,
  note text
) on commit preserve rows;

truncate table reset_hr_results;

do $$
declare
  target_table text;
  affected bigint;
  remaining bigint;
  storage_files bigint := 0;
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
      insert into reset_hr_results(table_name, deleted_rows, remaining_rows, note)
      values (target_table, affected, remaining, 'Reset completed')
      on conflict (table_name) do update
      set deleted_rows = excluded.deleted_rows,
          remaining_rows = excluded.remaining_rows,
          note = excluded.note;
    else
      insert into reset_hr_results(table_name, note)
      values (target_table, 'Skipped because this optional table is not installed')
      on conflict (table_name) do update set note = excluded.note;
    end if;
  end loop;

  if to_regclass('storage.objects') is not null then
    select count(*) into storage_files
    from storage.objects
    where bucket_id = 'hr-documents';
  end if;

  insert into reset_hr_results(table_name, remaining_rows, note)
  values (
    'storage:hr-documents',
    storage_files,
    case when storage_files = 0
      then 'Bucket is empty'
      else 'Manual cleanup required in Supabase Storage to remove physical files'
    end
  )
  on conflict (table_name) do update
  set remaining_rows = excluded.remaining_rows,
      note = excluded.note;
end
$$;

commit;

-- Every installed database table should show remaining_rows = 0.
-- A nonzero storage row is a cleanup reminder and does not roll back the reset.
select table_name, deleted_rows, remaining_rows, note
from reset_hr_results
order by case when table_name like 'storage:%' then 2 else 1 end, table_name;

-- These user/profile rows are intentionally preserved.
select count(*) as preserved_profiles from public.profiles;

