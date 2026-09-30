-- Phase 15: Delegated organization structure management.
-- Administrators and HR Staff may update only department and position catalogs.
-- Other settings, including file storage, remain Administrator-only.

begin;

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
begin
  if public.current_profile_role() not in ('Administrator', 'HR Staff') then
    raise exception 'Only Administrators and HR Staff can manage organization structure.';
  end if;

  if jsonb_typeof(p_departments) is distinct from 'array'
     or jsonb_typeof(p_positions) is distinct from 'array' then
    raise exception 'Departments and positions must be JSON arrays.';
  end if;

  if jsonb_array_length(p_departments) > 200 or jsonb_array_length(p_positions) > 1000 then
    raise exception 'Organization structure exceeds the supported catalog size.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_departments) item
    where jsonb_typeof(item) <> 'object'
       or length(trim(coalesce(item ->> 'name', ''))) not between 1 and 60
       or jsonb_typeof(item -> 'active') is distinct from 'boolean'
  ) then
    raise exception 'Each department requires a valid name and active status.';
  end if;

  if (
    select count(*) <> count(distinct lower(trim(item ->> 'name')))
    from jsonb_array_elements(p_departments) item
  ) then
    raise exception 'Department names must be unique.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_positions) item
    where jsonb_typeof(item) <> 'object'
       or length(trim(coalesce(item ->> 'name', ''))) not between 1 and 80
       or length(trim(coalesce(item ->> 'department', ''))) not between 1 and 60
       or jsonb_typeof(item -> 'active') is distinct from 'boolean'
       or not exists (
         select 1 from jsonb_array_elements(p_departments) department
         where lower(trim(department ->> 'name')) = lower(trim(item ->> 'department'))
       )
  ) then
    raise exception 'Each position requires a valid name, active status, and existing department.';
  end if;

  if (
    select count(*) <> count(distinct lower(trim(item ->> 'department')) || '|' || lower(trim(item ->> 'name')))
    from jsonb_array_elements(p_positions) item
  ) then
    raise exception 'Position names must be unique within each department.';
  end if;

  insert into public.hr_settings (id, data, updated_at, updated_by)
  values (
    'singleton',
    jsonb_build_object('departments', p_departments, 'positions', p_positions),
    now(),
    auth.uid()
  )
  on conflict (id) do update
  set data = jsonb_set(
      jsonb_set(coalesce(public.hr_settings.data, '{}'::jsonb), '{departments}', p_departments, true),
      '{positions}', p_positions, true
    ),
    updated_at = now(),
    updated_by = auth.uid()
  returning data into next_data;

  return next_data;
end
$$;

revoke all on function public.save_organization_structure(jsonb, jsonb) from public;
grant execute on function public.save_organization_structure(jsonb, jsonb) to authenticated;

commit;
