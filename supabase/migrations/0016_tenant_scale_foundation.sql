-- Phase 19: tenant isolation and enterprise-scale foundation.
-- Run after phase18-employee-directory-performance.sql.
-- Existing records are assigned to the default SLSC tenant. No HR records are deleted.

create table if not exists public.hr_tenants (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.hr_tenants(id,name,slug)
values ('00000000-0000-0000-0000-000000000001','Strellas Labor Service Cooperative','slsc')
on conflict (id) do update set name=excluded.name,slug=excluded.slug,updated_at=now();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','hr_records','hr_settings','hr_audit_logs','hr_app_state',
    'hr_cases','hr_case_links','hr_case_activity','hr_service_requests','hr_user_preferences'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I add column if not exists tenant_id uuid',table_name);
      execute format('update public.%I set tenant_id=$1 where tenant_id is null',table_name)
        using '00000000-0000-0000-0000-000000000001'::uuid;
      execute format('alter table public.%I alter column tenant_id set default %L::uuid',table_name,'00000000-0000-0000-0000-000000000001');
      execute format('alter table public.%I alter column tenant_id set not null',table_name);
      if not exists (
        select 1 from pg_constraint
        where conrelid=to_regclass('public.' || table_name)
          and conname=table_name || '_tenant_fkey'
      ) then
        execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.hr_tenants(id)',table_name,table_name || '_tenant_fkey');
      end if;
      execute format('create index if not exists %I on public.%I(tenant_id)',table_name || '_tenant_idx',table_name);
    end if;
  end loop;
end;
$$;

-- Security-definer workflow functions intentionally retain elevated write access.
-- This trigger is the final write boundary even when those functions bypass RLS.
create or replace function public.enforce_current_tenant_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_tenant uuid := public.current_tenant_id();
  row_tenant uuid;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  row_tenant := case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  if expected_tenant is null or row_tenant is distinct from expected_tenant then
    raise exception 'Tenant boundary violation';
  end if;
  if tg_op='UPDATE' and old.tenant_id is distinct from new.tenant_id then
    raise exception 'A record cannot be moved between tenants';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','hr_records','hr_settings','hr_audit_logs','hr_app_state',
    'hr_cases','hr_case_links','hr_case_activity','hr_service_requests','hr_user_preferences'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists enforce_tenant_write on public.%I',table_name);
      execute format('create trigger enforce_tenant_write before insert or update or delete on public.%I for each row execute function public.enforce_current_tenant_write()',table_name);
    end if;
  end loop;
end;
$$;

-- Settings use the same singleton id inside each tenant.
do $$
begin
  if to_regclass('public.hr_settings') is not null then
    alter table public.hr_settings drop constraint if exists hr_settings_pkey;
    alter table public.hr_settings add primary key (tenant_id,id);
  end if;
end;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profile.tenant_id
  from public.profiles profile
  where profile.id=auth.uid();
$$;

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hr_records','hr_settings','hr_audit_logs','hr_app_state','hr_cases',
    'hr_case_links','hr_case_activity','hr_service_requests','hr_user_preferences'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I alter column tenant_id set default public.current_tenant_id()',table_name);
    end if;
  end loop;
end;
$$;

alter table public.hr_tenants enable row level security;
drop policy if exists hr_tenants_select_current on public.hr_tenants;
create policy hr_tenants_select_current on public.hr_tenants
for select to authenticated
using (id=public.current_tenant_id());

-- Restrictive policies are combined with the existing role and ownership policies.
-- This preserves current permissions while adding a non-bypassable tenant boundary.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','hr_records','hr_settings','hr_audit_logs','hr_app_state',
    'hr_cases','hr_case_links','hr_case_activity','hr_service_requests','hr_user_preferences'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security',table_name);
      execute format('drop policy if exists tenant_isolation on public.%I',table_name);
      execute format(
        'create policy tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id=public.current_tenant_id()) with check (tenant_id=public.current_tenant_id())',
        table_name
      );
    end if;
  end loop;
end;
$$;

create or replace function public.storage_object_in_current_tenant(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public,storage
as $$
  select
    (storage.foldername(object_name))[1]=public.current_tenant_id()::text
    or exists (
      select 1
      from public.profiles profile
      where profile.tenant_id=public.current_tenant_id()
        and profile.id::text=(storage.foldername(object_name))[1]
    );
$$;

revoke all on function public.storage_object_in_current_tenant(text) from public;
grant execute on function public.storage_object_in_current_tenant(text) to authenticated;

drop policy if exists hr_documents_select on storage.objects;
create policy hr_documents_select on storage.objects for select to authenticated using (
  bucket_id='hr-documents'
  and public.storage_object_in_current_tenant(name)
  and (
    public.current_profile_role() in ('Administrator','HR Staff','Viewer')
    or (storage.foldername(name))[1]=auth.uid()::text
    or (storage.foldername(name))[2]=auth.uid()::text
  )
);

drop policy if exists hr_documents_insert on storage.objects;
create policy hr_documents_insert on storage.objects for insert to authenticated with check (
  bucket_id='hr-documents'
  and public.current_profile_role() in ('Administrator','HR Staff')
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
  and (storage.foldername(name))[2]=auth.uid()::text
);

drop policy if exists hr_documents_delete on storage.objects;
create policy hr_documents_delete on storage.objects for delete to authenticated using (
  bucket_id='hr-documents'
  and public.storage_object_in_current_tenant(name)
  and public.current_profile_role() in ('Administrator','HR Staff')
  and (
    public.current_profile_role()='Administrator'
    or (storage.foldername(name))[1]=auth.uid()::text
    or (storage.foldername(name))[2]=auth.uid()::text
  )
);

-- Replace the delegated organization writer so each tenant keeps its own catalogs.
create or replace function public.save_organization_structure(
  p_departments jsonb,
  p_positions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_data jsonb;
  active_tenant uuid := public.current_tenant_id();
begin
  if active_tenant is null or public.current_profile_role() not in ('Administrator','HR Staff') then
    raise exception 'Only Administrators and HR Staff can manage organization structure.';
  end if;
  if jsonb_typeof(p_departments) is distinct from 'array' or jsonb_typeof(p_positions) is distinct from 'array' then
    raise exception 'Departments and positions must be JSON arrays.';
  end if;
  if jsonb_array_length(p_departments)>200 or jsonb_array_length(p_positions)>1000 then
    raise exception 'Organization structure exceeds the supported catalog size.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_departments) item
    where jsonb_typeof(item)<>'object'
      or length(trim(coalesce(item->>'name',''))) not between 1 and 60
      or jsonb_typeof(item->'active') is distinct from 'boolean'
  ) then raise exception 'Each department requires a valid name and active status.'; end if;
  if (select count(*)<>count(distinct lower(trim(item->>'name'))) from jsonb_array_elements(p_departments) item) then
    raise exception 'Department names must be unique.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_positions) item
    where jsonb_typeof(item)<>'object'
      or length(trim(coalesce(item->>'name',''))) not between 1 and 80
      or length(trim(coalesce(item->>'department',''))) not between 1 and 60
      or jsonb_typeof(item->'active') is distinct from 'boolean'
      or not exists (
        select 1 from jsonb_array_elements(p_departments) department
        where lower(trim(department->>'name'))=lower(trim(item->>'department'))
      )
  ) then raise exception 'Each position requires a valid name, active status, and existing department.'; end if;
  if (
    select count(*)<>count(distinct lower(trim(item->>'department')) || '|' || lower(trim(item->>'name')))
    from jsonb_array_elements(p_positions) item
  ) then raise exception 'Position names must be unique within each department.'; end if;

  insert into public.hr_settings(tenant_id,id,data,updated_at,updated_by)
  values(active_tenant,'singleton',jsonb_build_object('departments',p_departments,'positions',p_positions),now(),auth.uid())
  on conflict (tenant_id,id) do update
  set data=jsonb_set(
      jsonb_set(coalesce(public.hr_settings.data,'{}'::jsonb),'{departments}',p_departments,true),
      '{positions}',p_positions,true
    ),
    updated_at=now(),
    updated_by=auth.uid()
  returning data into next_data;
  return next_data;
end;
$$;

revoke all on function public.save_organization_structure(jsonb,jsonb) from public;
grant execute on function public.save_organization_structure(jsonb,jsonb) to authenticated;

create index if not exists hr_records_tenant_module_updated_idx
  on public.hr_records(tenant_id,module,updated_at desc);
create index if not exists hr_records_tenant_employee_number_idx
  on public.hr_records(tenant_id,(data ->> 'employeeNo') desc,updated_at desc)
  where module='employees';

comment on table public.hr_tenants is 'Tenant registry for SaaS-ready HR data isolation.';
comment on function public.current_tenant_id() is 'Returns the authenticated profile tenant for restrictive RLS policies.';
