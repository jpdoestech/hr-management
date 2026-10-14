-- Direct month/cutoff matrix with optional location filters. Preserve canonical writes.
begin;
create or replace function public.attendance_preparation_options() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.hr_manpower_clients c where c.tenant_id=public.current_tenant_id() and c.active and public.attendance_client_access(c.id::text,false) and public.current_user_has_permission('attendance.view') and (public.current_user_has_permission('attendance.manage') or exists(select 1 from public.hr_attendance_configuration s where s.tenant_id=c.tenant_id and s.kind='schedule' and s.data->>'clientId'=c.id::text and public.current_user_scope_allows(s.data->>'employeeId',s.data)))),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.branch,l.client_id) from (select distinct s.data->>'branchReporting' branch,s.data->>'clientId' client_id from public.hr_attendance_configuration s where s.tenant_id=public.current_tenant_id() and s.kind='schedule' and public.current_user_has_permission('attendance.view') and public.current_user_has_permission('employees.view') and public.attendance_client_access(s.data->>'clientId',false) and public.current_user_scope_allows(s.data->>'employeeId',s.data) and exists(select 1 from public.hr_records e where e.tenant_id=s.tenant_id and e.module='employees' and e.record_id=s.data->>'employeeId' and public.current_user_scope_allows(e.record_id,e.data))) l),'[]'::jsonb));
$$;

create or replace function public.query_attendance_matrix(p_cutoff jsonb,p_search text default '',p_department text default '',p_position text default '',p_offset integer default 0,p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();a date:=(p_cutoff->>'start')::date;b date:=(p_cutoff->>'end')::date;result jsonb;client_filter text:=coalesce(p_cutoff->>'clientId','');branch_filter text:=coalesce(p_cutoff->>'branch','');
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.view'),false) or not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Attendance and employee view permissions required' using errcode='42501';end if;
  if client_filter<>'' and not public.attendance_client_access(client_filter,false) then raise exception 'Client outside assigned access' using errcode='42501';end if;
  if a is null or b is null or b<a or b-a>30 then raise exception 'Select a cutoff of 1 to 31 days' using errcode='23514';end if;
  with roster as materialized (
    select e.record_id,jsonb_build_object('name',e.data->>'name','employeeNo',e.data->>'employeeNo') data from public.hr_records e where e.tenant_id=tenant and e.module='employees' and public.current_user_scope_allows(e.record_id,e.data)
    and not exists(select 1 from regexp_split_to_table(lower(regexp_replace(btrim(p_search),'[,[:space:]]+',' ','g')),' ') word where word<>'' and strpos(lower(concat_ws(' ',e.data->>'name',e.data->>'employeeNo')),word)=0)
    and exists(select 1 from public.hr_attendance_configuration c where c.tenant_id=tenant and c.kind='schedule' and c.data->>'employeeId'=e.record_id and (client_filter='' or c.data->>'clientId'=client_filter) and (branch_filter='' or c.data->>'branchReporting'=branch_filter) and public.attendance_client_access(c.data->>'clientId',false) and public.current_user_scope_allows(e.record_id,c.data) and (p_department='' or c.data->>'department'=p_department) and (p_position='' or c.data->>'position'=p_position) and daterange((c.data->>'effectiveFrom')::date,nullif(c.data->>'effectiveTo','')::date,'[)') && daterange(a,b+1,'[)'))
  ), page as (select * from roster order by lower(data->>'name'),record_id offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)), days as materialized (
    select e.record_id,e.data,d::date work_date,attendance_private.day_context(e.record_id,d::date) context from page e cross join generate_series(a,b,'1 day'::interval) d
  ), scoped as materialized (
    select d.*,coalesce(public.current_user_scope_allows(d.record_id,d.context->'assignment') and public.attendance_client_access(d.context->'assignment'->>'clientId',false) and (client_filter='' or d.context->'assignment'->>'clientId'=client_filter) and (branch_filter='' or d.context->'assignment'->>'branchReporting'=branch_filter) and (p_department='' or d.context->'assignment'->>'department'=p_department) and (p_position='' or d.context->'assignment'->>'position'=p_position),false) visible from days d
  ), cells as (
    select d.record_id,d.data,d.work_date,case when d.visible then d.context||jsonb_build_object('writable',public.attendance_client_access(d.context->'assignment'->>'clientId',true)) else jsonb_build_object('ready',false,'writable',false,'reason','Outside selected assignment or access scope') end context,
      r.data||jsonb_build_object('reviewState',coalesce((select state from attendance_private.review_registry v where v.tenant_id=tenant and v.employee_id=d.record_id and v.work_date=d.work_date),'Draft')) attendance,md5(r.data::text) attendance_hash,
      d.visible and exists(select 1 from attendance_private.posting_locks l where l.tenant_id=tenant and l.employee_id=d.record_id and l.work_date=d.work_date) posted
    from scoped d left join public.hr_records r on d.visible and r.tenant_id=tenant and r.module='attendance' and r.data->>'employeeId'=d.record_id and r.data->>'workDate'=d.work_date::text and public.current_user_scope_allows(r.record_id,r.data) and public.attendance_client_access(coalesce(r.data->>'clientId',''),false)
  ), employees as (
    select record_id,jsonb_build_object('id',record_id,'name',data->>'name','employeeNo',data->>'employeeNo','days',jsonb_object_agg(work_date::text,jsonb_build_object('employeeId',record_id,'date',work_date,'context',context,'record',attendance,'hash',coalesce(attendance_hash,''),'posted',posted))) row_data from cells group by record_id,data
  ) select jsonb_build_object('total',(select count(*) from roster),'rows',coalesce((select jsonb_agg(row_data order by lower(row_data->>'name'),record_id) from employees),'[]'::jsonb)) into result;
  return result;
end;$$;

-- Keep the tested, scoped canonical writer private. The wrapper groups by trusted dated
-- assignment inside ONE transaction; any group's failure rolls back all earlier groups.
alter function public.save_attendance_matrix(jsonb,jsonb,text) set schema attendance_private;
revoke all on function attendance_private.save_attendance_matrix(jsonb,jsonb,text) from public,anon,authenticated;
create function public.save_attendance_matrix(p_cutoff jsonb,p_edits jsonb,p_reference text) returns jsonb language plpgsql security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();a date:=(p_cutoff->>'start')::date;b date:=(p_cutoff->>'end')::date;item jsonb;context jsonb;batch jsonb:='[]';grouped record;employee text;result jsonb;count_saved integer:=0;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.view'),false) or not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Attendance access required' using errcode='42501';end if;
  if a is null or b is null or b<a or b-a>30 or jsonb_typeof(p_edits) is distinct from 'array' or coalesce(length(btrim(p_reference)),0) not between 1 and 1000 then raise exception 'Invalid cutoff, changes or attendance reference' using errcode='23514';end if;
  if jsonb_array_length(p_edits) not between 1 and 3100 or (select count(distinct value->>'employeeId') from jsonb_array_elements(p_edits))>100 or (select count(distinct (value->>'employeeId',value->>'workDate')) from jsonb_array_elements(p_edits))<>jsonb_array_length(p_edits) then raise exception 'Duplicate days or oversized batch' using errcode='23514';end if;
  perform attendance_private.lock_writers(tenant);
  for employee in select distinct value->>'employeeId' from jsonb_array_elements(p_edits) order by 1 loop
    perform 1 from public.hr_records where tenant_id=tenant and module='employees' and record_id=employee for update;
  end loop;
  for item in select value from jsonb_array_elements(p_edits) order by value->>'employeeId',value->>'workDate' loop
    context:=attendance_private.day_context(item->>'employeeId',(item->>'workDate')::date);
    if not public.attendance_client_access(context->'assignment'->>'clientId',true) then raise exception 'Client outside assigned edit access' using errcode='42501';end if;
    if context->>'ready' is distinct from 'true' or (coalesce(p_cutoff->>'clientId','')<>'' and context->'assignment'->>'clientId' is distinct from p_cutoff->>'clientId') or (coalesce(p_cutoff->>'branch','')<>'' and context->'assignment'->>'branchReporting' is distinct from p_cutoff->>'branch') then raise exception 'Review dated assignment and calendar' using errcode='23514';end if;
    batch:=batch||jsonb_build_array(jsonb_build_object('client',context->'assignment'->>'clientId','branch',context->'assignment'->>'branchReporting','edit',item));
  end loop;
  for grouped in select value->>'client' client,value->>'branch' branch,jsonb_agg(value->'edit' order by value->'edit'->>'employeeId',value->'edit'->>'workDate') edits from jsonb_array_elements(batch) group by 1,2 order by 1,2 loop
    result:=attendance_private.save_attendance_matrix(p_cutoff||jsonb_build_object('clientId',grouped.client,'branch',grouped.branch),grouped.edits,p_reference);
    count_saved:=count_saved+(result->>'saved')::integer;
  end loop;
  return jsonb_build_object('saved',count_saved);
end;$$;
revoke all on function public.save_attendance_matrix(jsonb,jsonb,text) from public,anon;
grant execute on function public.save_attendance_matrix(jsonb,jsonb,text) to authenticated;
commit;
