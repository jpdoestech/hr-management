-- Enforce employee ID uniqueness per tenant and ID type without rewriting data.
begin;
set local lock_timeout='5s';
lock table public.hr_records in share row exclusive mode;

create or replace function public.employee_government_id_key(p_field text,p_value text)
returns text
language sql immutable parallel safe
set search_path=pg_catalog
as $$
  select case when p_field='tin'
    then left(regexp_replace(coalesce(p_value,''),'[^0-9]','','g'),9)
    else regexp_replace(coalesce(p_value,''),'[^0-9]','','g') end;
$$;

-- Fail with no identifiers in the message; an authorized HR review must resolve
-- existing duplicates before retrying. Never invent or erase government IDs.
do $$
begin
  if exists (
    select 1 from public.hr_records r
    cross join lateral (values ('sssNumber'),('philHealthNumber'),('pagIbigNumber'),('tin')) f(key)
    where r.module='employees'
      and public.employee_government_id_key(f.key,r.data->>f.key)<>''
    group by r.tenant_id,f.key,public.employee_government_id_key(f.key,r.data->>f.key)
    having count(*)>1
  ) then
    raise exception 'Duplicate employee government IDs require authorized review before migration 0065 can be applied. No records were changed.' using errcode='23505';
  end if;
end;
$$;

create unique index hr_records_employee_sss_unique_idx
  on public.hr_records (tenant_id,public.employee_government_id_key('sssNumber',data->>'sssNumber'))
  where module='employees' and public.employee_government_id_key('sssNumber',data->>'sssNumber')<>'';
create unique index hr_records_employee_philhealth_unique_idx
  on public.hr_records (tenant_id,public.employee_government_id_key('philHealthNumber',data->>'philHealthNumber'))
  where module='employees' and public.employee_government_id_key('philHealthNumber',data->>'philHealthNumber')<>'';
create unique index hr_records_employee_pagibig_unique_idx
  on public.hr_records (tenant_id,public.employee_government_id_key('pagIbigNumber',data->>'pagIbigNumber'))
  where module='employees' and public.employee_government_id_key('pagIbigNumber',data->>'pagIbigNumber')<>'';
create unique index hr_records_employee_tin_unique_idx
  on public.hr_records (tenant_id,public.employee_government_id_key('tin',data->>'tin'))
  where module='employees' and public.employee_government_id_key('tin',data->>'tin')<>'';
commit;
