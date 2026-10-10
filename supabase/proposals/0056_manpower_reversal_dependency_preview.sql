-- Gated read-only prerequisite. This does not authorize or execute reversal.
begin;
create function manpower_private.reversal_reference_date(p_value text) returns date
language plpgsql immutable set search_path=public as $$ begin
  if coalesce(p_value,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null;end if;
  return p_value::date;
exception when invalid_datetime_format or datetime_field_overflow then return null;end $$;
revoke all on function manpower_private.reversal_reference_date(text) from public,anon,authenticated;

create function manpower_private.reversal_dependencies(p_kind text,p_id uuid)
returns table(code text,module_key text,reference_count bigint,can_inspect boolean)
language plpgsql stable set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();source jsonb;employee jsonb;request_id text;
begin
  if p_kind='reservation' then
    select to_jsonb(r) into source from public.hr_manpower_reservations r where tenant_id=tenant and id=p_id;
    select l.request_id into request_id from public.hr_manpower_lines l where l.tenant_id=tenant and l.id=source->>'line_id';
  else select to_jsonb(o) into source from public.hr_manpower_operational_deployments o where tenant_id=tenant and id=p_id;end if;
  select data into employee from public.hr_records where tenant_id=tenant and module='employees' and record_id=source->>'employee_id';
  return query
    select 'transfer_chain'::text,'manpower'::text,count(*),bool_and(public.can_read_manpower_primary(h.source_kind,h.source_id) and public.can_read_manpower_primary(h.target_kind,h.target_id)) from public.hr_manpower_transfer_history h where h.tenant_id=tenant
      and ((h.source_kind=p_kind and h.source_id=p_id) or (h.target_kind=p_kind and h.target_id=p_id)) having count(*)>0;
  return query
    select 'operational_descendants'::text,'manpower'::text,count(*),bool_and(public.can_read_manpower_primary('operational',o.id)) from public.hr_manpower_operational_deployments o
      where o.tenant_id=tenant and o.origin_kind=p_kind and o.origin_id=p_id having count(*)>0;
  if p_kind='operational' then
    -- Every current operational source has a linked origin; coordinated reversal is required.
    return query select 'linked_operational_origin'::text,'manpower'::text,1::bigint,
      public.can_read_manpower_primary(source->>'origin_kind',(source->>'origin_id')::uuid) where source is not null;
  end if;
  return query
    select 'replacement_references'::text,'manpower'::text,count(*),bool_and(public.can_read_manpower_draft(l.request_id))
      from public.hr_manpower_replacement_sources r join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.id=r.line_id
      where r.tenant_id=tenant and r.source_kind=p_kind and r.source_id=p_id having count(*)>0;
  return query
    select 'explicit_record_references'::text,
      case when r.module in ('payroll','payrollEntries','payrollRuns') then 'payroll.view' else public.hr_record_permission_key(r.module,'view') end,
      count(*),bool_and(coalesce(public.current_user_scope_allows(r.record_id,r.data),false))
      from public.hr_records r where r.tenant_id=tenant and r.module not in ('employees','onboardingCandidates')
      and jsonb_path_exists(r.data,'$.** ? (@ == $deployment)',jsonb_build_object('deployment',p_id::text))
      group by case when r.module in ('payroll','payrollEntries','payrollRuns') then 'payroll.view' else public.hr_record_permission_key(r.module,'view') end;
  return query
    select case when r.module='attendance' then 'attendance_interval' else 'financial_review' end,
      case when r.module in ('payroll','payrollEntries','payrollRuns') then 'payroll.view' else public.hr_record_permission_key(r.module,'view') end,
      count(*),bool_and(coalesce(public.current_user_scope_allows(r.record_id,r.data),false))
      from public.hr_records r where r.tenant_id=tenant and r.module in ('attendance','atd','payroll','payrollEntries','payrollRuns')
      and (jsonb_path_exists(r.data,'$.**.employeeId ? (@ == $worker)',jsonb_build_object('worker',source->>'employee_id'))
        or jsonb_path_exists(r.data,'$.**.employee_record_id ? (@ == $worker)',jsonb_build_object('worker',source->>'employee_id'))
        or jsonb_path_exists(r.data,'$.**.employee_id ? (@ == $worker)',jsonb_build_object('worker',source->>'employee_id'))
        or (coalesce(r.data->>'employeeId',r.data->>'employee_record_id',r.data->>'employee_id','')=''
          and public.manpower_identity_name_key(jsonb_build_object('name',r.data->>'employeeName'))<>''
          and public.manpower_identity_name_key(jsonb_build_object('name',r.data->>'employeeName'))=public.manpower_identity_name_key(employee)))
      and (r.module<>'attendance' or manpower_private.reversal_reference_date(r.data->>'workDate') is null
        or (manpower_private.reversal_reference_date(r.data->>'workDate')>=(source->>'actual_date')::date
          and (source->>'ended_date' is null or manpower_private.reversal_reference_date(r.data->>'workDate')<(source->>'ended_date')::date)))
      group by r.module,public.hr_record_permission_key(r.module,'view');
  return query
    select 'legacy_assignment_review'::text,'manpower'::text,count(*),bool_and(coalesce(public.current_user_scope_allows(r.record_id,r.data),false)) from public.hr_records r where r.tenant_id=tenant
      and r.module in ('manpowerSlots','oncall') and (r.data->>'employeeId'=source->>'employee_id'
        or r.data->>'candidateId'=source->>'candidate_id' or (r.module='manpowerSlots' and r.data->>'requestId'=request_id)
        or (r.module='oncall' and public.manpower_identity_name_key(jsonb_build_object('name',r.data->>'employeeName'))<>''
          and public.manpower_identity_name_key(jsonb_build_object('name',r.data->>'employeeName'))=public.manpower_identity_name_key(employee))) having count(*)>0;
end $$;
revoke all on function manpower_private.reversal_dependencies(text,uuid) from public,anon,authenticated;

create function public.preview_manpower_reversal(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare preview jsonb;dependency record;blockers jsonb:='[]';restricted boolean:=false;
begin
  if not coalesce(public.current_user_has_permission('manpower.approve'),false)
    or not coalesce(public.can_read_manpower_primary(p_kind,p_id),false) then
    raise exception 'Reversal review outside your access' using errcode='42501';end if;
  preview:=public.preview_manpower_transfer(p_kind,p_id);
  for dependency in select * from manpower_private.reversal_dependencies(p_kind,p_id) order by code,module_key loop
    if coalesce(dependency.can_inspect,false) and coalesce(public.current_user_has_permission(case when dependency.module_key like '%.view' then dependency.module_key else dependency.module_key||'.view' end),false) then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code',dependency.code,'reference_count',dependency.reference_count));
    else restricted:=true;end if;
  end loop;
  if restricted then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','restricted_dependency_review'));end if;
  return preview||jsonb_build_object('blockers',blockers,'dependency_clear',jsonb_array_length(blockers)=0,
    'reversal_enabled',false,'requires_fresh_transaction_check',true);
end $$;
revoke all on function public.preview_manpower_reversal(text,uuid) from public,anon;
grant execute on function public.preview_manpower_reversal(text,uuid) to authenticated;
commit;
