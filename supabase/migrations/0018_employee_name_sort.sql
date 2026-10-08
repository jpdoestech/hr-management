-- Phase 21: make Employee Information default to employee name A-Z.
-- Safe additive migration. Run once after Phase 18 on an existing project.

create index if not exists hr_records_employee_name_idx
  on public.hr_records (
    lower(coalesce(nullif(trim(data ->> 'lastName'), ''), nullif(trim(data ->> 'name'), ''), '')),
    lower(coalesce(data ->> 'firstName', '')),
    (data ->> 'employeeNo')
  )
  where module = 'employees';

create or replace function public.search_employee_directory(
  p_search text default '',
  p_department text default '',
  p_branch text default '',
  p_status text default '',
  p_classification text default '',
  p_probation_days integer default 180,
  p_fields text[] default array[]::text[],
  p_offset integer default 0,
  p_limit integer default 10
)
returns table (
  record_id text,
  data jsonb,
  updated_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select record.record_id, record.data, record.updated_at
    from public.hr_records record
    where record.module = 'employees'
      and (
        nullif(trim(p_search), '') is null
        or public.employee_directory_search_text(record.data) like '%' || lower(trim(p_search)) || '%'
      )
      and (nullif(p_department, '') is null or record.data ->> 'department' = p_department)
      and (nullif(p_branch, '') is null or record.data ->> 'branchReporting' = p_branch)
      and (nullif(p_status, '') is null or record.data ->> 'status' = p_status)
      and (
        nullif(p_classification, '') is null
        or case
          when coalesce(record.data ->> 'classOverride', 'Auto') <> 'Auto'
            then record.data ->> 'classOverride'
          when coalesce(record.data ->> 'dateHired', '') !~ '^\d{4}-\d{2}-\d{2}$' then '—'
          when record.data ->> 'dateHired' <= to_char(current_date - greatest(p_probation_days, 0), 'YYYY-MM-DD')
            then 'Regular'
          else 'Probationary'
        end = p_classification
      )
  ), paged as (
    select filtered.*,
           count(*) over() as total_count
    from filtered
    order by lower(coalesce(nullif(trim(filtered.data ->> 'lastName'), ''), nullif(trim(filtered.data ->> 'name'), ''), '')) asc,
             lower(coalesce(filtered.data ->> 'firstName', '')) asc,
             filtered.data ->> 'employeeNo' asc nulls last,
             filtered.record_id
    offset greatest(p_offset, 0)
    limit least(greatest(p_limit, 1), 100)
  )
  select paged.record_id,
         jsonb_build_object('id', coalesce(paged.data -> 'id', to_jsonb(paged.record_id))) ||
           coalesce((
             select jsonb_object_agg(field.key, field.value)
             from jsonb_each(paged.data) field
             where field.key = any(coalesce(p_fields, array[]::text[]))
           ), '{}'::jsonb) as data,
         paged.updated_at,
         paged.total_count
  from paged;
$$;

revoke all on function public.search_employee_directory(text,text,text,text,text,integer,text[],integer,integer) from public;
grant execute on function public.search_employee_directory(text,text,text,text,text,integer,text[],integer,integer) to authenticated;

comment on function public.search_employee_directory(text,text,text,text,text,integer,text[],integer,integer)
  is 'RLS-aware indexed employee directory search, projected pagination, and default employee-name A-Z ordering.';
