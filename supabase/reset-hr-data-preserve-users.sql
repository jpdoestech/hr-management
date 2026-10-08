-- SLSC HRIS operational data reset (default SLSC tenant only)
-- DESTRUCTIVE: removes employee/applicant/HR records, cases, requests, and audit history.
-- PRESERVED: auth.users, public.profiles, public.hr_settings, and public.hr_user_preferences.
--
-- Run this entire file in Supabase Dashboard > SQL Editor as the project owner.
-- The reset is migration-tolerant: optional tables that do not exist are skipped.
-- This version creates no helper table, so Supabase will not show an RLS warning.
--
-- IMPORTANT: deploy the current app version before running this reset. The
-- database trigger below blocks old open tabs from restoring pre-reset data.
--
-- Uploaded files require separate cleanup:
-- 1. Supabase Dashboard > Storage > hr-documents > Empty bucket.
-- 2. For Google Drive, delete the HRIS-created module folders below the configured root.
-- SQL must not delete directly from storage.objects because that can leave physical
-- files orphaned. The final notice reports how many Supabase files still need cleanup.

begin;

-- Enforce the reset epoch inside PostgreSQL. This closes the race where a stale
-- browser starts a save before the reset and finishes its upsert afterward.
create or replace function public.enforce_hr_record_reset_epoch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  server_reset_at text;
  client_reset_at text;
begin
  select data ->> 'dataResetAt'
  into server_reset_at
  from public.hr_settings
  where id = 'singleton'
    and tenant_id = new.tenant_id;

  if coalesce(server_reset_at, '') = '' then
    return new;
  end if;

  client_reset_at := coalesce(new.data ->> '_dataResetAt', '');
  if client_reset_at <> server_reset_at then
    raise exception 'Stale HRIS session blocked after data reset. Reload the application.';
  end if;

  return new;
end
$$;

drop trigger if exists hr_records_reset_epoch on public.hr_records;
create trigger hr_records_reset_epoch
before insert or update on public.hr_records
for each row execute function public.enforce_hr_record_reset_epoch();

do $$
declare
  target_table text;
  affected bigint;
  remaining bigint;
  storage_files bigint := 0;
  reset_at text := clock_timestamp()::text;
  target_tenant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
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
    where employee_record_id is not null
      and tenant_id = target_tenant;
  end if;

  -- Stamp the preserved settings row. The app compares this marker before every
  -- write so an already-open page cannot silently restore the deleted records.
  if to_regclass('public.hr_settings') is not null then
    insert into public.hr_settings (tenant_id, id, data, updated_at, updated_by)
    values (target_tenant, 'singleton', jsonb_build_object('dataResetAt', reset_at), now(), null)
    on conflict (tenant_id,id) do update
    set data = jsonb_set(coalesce(public.hr_settings.data, '{}'::jsonb), '{dataResetAt}', to_jsonb(reset_at), true),
        updated_at = now(),
        updated_by = null;
  end if;

  -- Dependency order matters. Each table is optional so the script also works
  -- when only part of the migration set has been installed.
  foreach target_table in array array[
    'hr_case_evidence',
    'hr_case_intake',
    'hr_case_implementations',
    'hr_case_interim_measures',
    'hr_disciplinary_history',
    'hr_case_correspondence',
    'hr_case_responses',
    'hr_case_hearings',
    'hr_case_decisions',
    'hr_case_allegations',
    'hr_case_activity',
    'hr_case_links',
    'hr_cases',
    'hr_service_requests',
    'hr_records',
    'hr_app_state',
    'hr_audit_logs'
  ] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('delete from public.%I where tenant_id=$1', target_table) using target_tenant;
      get diagnostics affected = row_count;
      execute format('select count(*) from public.%I where tenant_id=$1', target_table) into remaining using target_tenant;
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
    where bucket_id = 'hr-documents'
      and (
        (storage.foldername(name))[1] = target_tenant::text
        or exists (
          select 1 from public.profiles profile
          where profile.tenant_id=target_tenant
            and profile.id::text=(storage.foldername(name))[1]
        )
      );
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
  (select count(*) from public.profiles where tenant_id='00000000-0000-0000-0000-000000000001'::uuid) as preserved_profiles,
  (select count(*) from public.hr_records where tenant_id='00000000-0000-0000-0000-000000000001'::uuid) as remaining_hr_records,
  (select count(*) from public.hr_app_state where tenant_id='00000000-0000-0000-0000-000000000001'::uuid) as remaining_legacy_states,
  (select data ->> 'dataResetAt' from public.hr_settings where id = 'singleton' and tenant_id='00000000-0000-0000-0000-000000000001'::uuid) as reset_marker;

