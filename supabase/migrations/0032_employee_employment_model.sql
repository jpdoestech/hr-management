-- Separate contract type, operational status and reason without deleting history.
begin;
create or replace function public.normalize_employee_employment(p_data jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare
  result jsonb:=p_data;
  old_status text:=coalesce(nullif(p_data->>'status',''),'Active');
  new_status text;
  reason text;
  contract_type text:=coalesce(nullif(p_data->>'employmentType',''),nullif(p_data->>'classOverride',''),'');
begin
  new_status:=case when old_status in ('Active','Inactive','Separated') then old_status
    when old_status='Resigned' then 'Separated'
    when old_status in ('AWOL','Returned to Agency') then 'Inactive' else 'Active' end;
  reason:=coalesce(nullif(p_data->>'statusReason',''),case old_status
    when 'AWOL' then 'AWOL (Pending Review)' when 'Resigned' then 'Resigned'
    when 'Returned to Agency' then 'Returned to Agency' when 'Inactive' then 'Floating Status'
    when 'Separated' then 'Other / Review Required' else 'Active / Normal' end);
  contract_type:=case lower(btrim(contract_type)) when 'regular' then 'Regular / Permanent'
    when 'regular / permanent' then 'Regular / Permanent' when 'permanent' then 'Regular / Permanent'
    when 'probationary' then 'Probationary' when 'project-based' then 'Project-Based'
    when 'seasonal' then 'Seasonal' when 'casual' then 'Casual'
    when 'contractual' then 'Fixed-Term / Contractual' when 'fixed-term' then 'Fixed-Term / Contractual'
    when 'fixed-term / contractual' then 'Fixed-Term / Contractual'
    when 'fixed-term (contractual)' then 'Fixed-Term / Contractual' else contract_type end;
  if contract_type not in ('Regular / Permanent','Probationary','Project-Based','Seasonal','Fixed-Term / Contractual','Casual') then contract_type:='Unspecified / Review Required';end if;
  if old_status not in ('Active','Inactive','Separated') then
    result:=result||jsonb_build_object('legacyEmploymentStatus',coalesce(p_data->>'legacyEmploymentStatus',old_status));
  end if;
  return result||jsonb_build_object('status',new_status,'statusReason',reason,'employmentType',contract_type,
    'employmentTypeNeedsReview',contract_type='Unspecified / Review Required','employmentModelVersion',1);
end;$$;

-- Preserve original values for review. No date is invented or guessed.
update public.hr_records set data=public.normalize_employee_employment(data)||jsonb_build_object(
  'legacyEmploymentSnapshot',jsonb_build_object('status',data->'status','classOverride',data->'classOverride','statusDate',data->'statusDate'))
where module='employees' and coalesce(data->>'employmentModelVersion','')<>'1';

create or replace function public.validate_employee_employment_model()
returns trigger language plpgsql set search_path=public as $$
declare status text;reason text;contract_type text;allowed_reasons text[];
begin
  if new.module<>'employees' then return new;end if;
  status:=coalesce(new.data->>'status','');reason:=coalesce(new.data->>'statusReason','');contract_type:=coalesce(new.data->>'employmentType','');
  if status not in ('Active','Inactive','Separated') then raise exception 'Invalid Employment Status' using errcode='23514';end if;
  allowed_reasons:=case status when 'Active' then array['Active / Normal','Return to Agency','Reinstated','Rehired']
    when 'Inactive' then array['On Leave','Suspended','Floating Status','AWOL (Pending Review)','Returned to Agency']
    else array['Resigned','Dismissed / Terminated','Contract / Project Completed','Retired','Deceased','Other / Review Required'] end;
  if not(reason=any(allowed_reasons)) then raise exception 'Status Reason does not match Employment Status' using errcode='23514';end if;
  if contract_type not in ('Regular / Permanent','Probationary','Project-Based','Seasonal','Fixed-Term / Contractual','Casual') then
    if tg_op='INSERT' then raise exception 'Select a valid Employment Type' using errcode='23514';end if;
    if contract_type<>'Unspecified / Review Required' or old.data->>'employmentType'<>'Unspecified / Review Required' then
      raise exception 'Select a valid Employment Type' using errcode='23514';
    end if;
  end if;
  if status<>'Active' and coalesce(new.data->>'statusDate','')='' then raise exception 'Status Effective Date is required for inactive or separated employees' using errcode='23514';end if;
  if coalesce(new.data->>'statusDate','')<>'' then
    perform (new.data->>'statusDate')::date;
    if coalesce(new.data->>'dateHired','')<>'' and (new.data->>'statusDate')::date<(new.data->>'dateHired')::date then raise exception 'Status Effective Date cannot precede Date Hired' using errcode='23514';end if;
  end if;
  new.data:=new.data||jsonb_build_object('employmentModelVersion',1,'employmentTypeNeedsReview',contract_type='Unspecified / Review Required');
  return new;
end;$$;
drop trigger if exists hr_records_employee_employment on public.hr_records;
create trigger hr_records_employee_employment before insert or update on public.hr_records
for each row execute function public.validate_employee_employment_model();
create index if not exists hr_records_employee_employment_type_idx on public.hr_records(tenant_id,(data->>'employmentType')) where module='employees';
create index if not exists hr_records_employee_status_reason_idx on public.hr_records(tenant_id,(data->>'statusReason')) where module='employees';
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
        or coalesce(nullif(record.data ->> 'employmentType', ''), 'Unspecified / Review Required') = p_classification
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
        or coalesce(nullif(record.data ->> 'employmentType', ''), 'Unspecified / Review Required') = p_classification
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


commit;
