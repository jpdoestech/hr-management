-- Phase 16: server-side search, filtering, sorting, and pagination for hr_records.
-- Safe additive migration. Existing records and policies are unchanged.

create or replace function public.search_hr_records(
  p_module text,
  p_search text default '',
  p_search_fields text[] default array[]::text[],
  p_filters jsonb default '{}'::jsonb,
  p_classification text default '',
  p_probation_days integer default 180,
  p_sort_key text default '',
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
    where record.module = p_module
      and (
        nullif(trim(p_search), '') is null
        or exists (
          select 1
          from unnest(p_search_fields) field_name
          where coalesce(record.data ->> field_name, '') ilike '%' || trim(p_search) || '%'
        )
      )
      and not exists (
        select 1
        from jsonb_each_text(coalesce(p_filters, '{}'::jsonb)) filter_item
        where nullif(filter_item.value, '') is not null
          and coalesce(record.data ->> filter_item.key, '') <> filter_item.value
      )
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
  )
  select filtered.record_id,
         filtered.data,
         filtered.updated_at,
         count(*) over() as total_count
  from filtered
  order by
    case when nullif(p_sort_key, '') is not null then filtered.data ->> p_sort_key end desc nulls last,
    filtered.updated_at desc,
    filtered.record_id
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.search_hr_records(text,text,text[],jsonb,text,integer,text,integer,integer) from public;
grant execute on function public.search_hr_records(text,text,text[],jsonb,text,integer,text,integer,integer) to authenticated;

create index if not exists hr_records_module_department_idx
  on public.hr_records(module, (data ->> 'department'));
create index if not exists hr_records_module_status_idx
  on public.hr_records(module, (data ->> 'status'));
create index if not exists hr_records_module_branch_idx
  on public.hr_records(module, (data ->> 'branchReporting'));

comment on function public.search_hr_records(text,text,text[],jsonb,text,integer,text,integer,integer)
  is 'RLS-aware server-side search and pagination for HR record tables.';
