-- Employee-first attendance, without inventing reviewed schedules or payroll evidence.
begin;

create function attendance_private.employee_day_context(p_employee text,p_date date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare e jsonb;snapshot jsonb;allowed boolean;
begin
  select data into e from public.hr_records where tenant_id=public.current_tenant_id() and module='employees' and record_id=p_employee;
  if e is null or not coalesce(public.current_user_scope_allows(p_employee,e),false) or not public.attendance_client_access('',false) then
    return jsonb_build_object('ready',false,'recordingReady',false,'reason','Employee outside attendance scope');
  end if;
  -- A dated assignment always owns its days, including unreviewed assignments.
  if exists(select 1 from public.hr_attendance_configuration where tenant_id=public.current_tenant_id() and kind='schedule' and data->>'employeeId'=p_employee and (data->>'effectiveFrom')::date<=p_date and (nullif(data->>'effectiveTo','') is null or p_date<(data->>'effectiveTo')::date)) then
    return jsonb_build_object('ready',false,'recordingReady',false,'reason','Use dated assignment attendance');
  end if;
  snapshot:=jsonb_build_object('employeeId',p_employee,'dateHired',e->>'dateHired','status',e->>'status','statusDate',e->>'statusDate','department',e->>'department','position',e->>'position','branchReporting',e->>'branchReporting');
  allowed:=p_date<=(now() at time zone 'Asia/Manila')::date and coalesce(nullif(e->>'dateHired',''),'9999-12-31')<=p_date::text and not (coalesce(e->>'status','')='Separated' and coalesce(nullif(e->>'statusDate',''),'0001-01-01')<=p_date::text);
  return jsonb_build_object('basic',true,'ready',false,'recordingReady',allowed,'writable',public.attendance_client_access('',true),'scheduledMinutes',480,'hash',md5(snapshot::text),'reason',case when allowed then 'Attendance only; no verified duty or pay calculation' else 'Outside employment dates or in the future' end);
end;$$;
revoke all on function attendance_private.employee_day_context(text,date) from public,anon,authenticated;

create or replace function public.attendance_preparation_options() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.hr_manpower_clients c where c.tenant_id=public.current_tenant_id() and c.active and public.attendance_client_access(c.id::text,false) and public.current_user_has_permission('attendance.view') and (public.current_user_has_permission('attendance.manage') or exists(select 1 from public.hr_attendance_configuration s where s.tenant_id=c.tenant_id and s.kind='schedule' and s.data->>'clientId'=c.id::text and public.current_user_scope_allows(s.data->>'employeeId',s.data)))),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.branch,l.client_id) from (
      select distinct s.data->>'branchReporting' branch,s.data->>'clientId' client_id from public.hr_attendance_configuration s where s.tenant_id=public.current_tenant_id() and s.kind='schedule' and public.current_user_has_permission('attendance.view') and public.current_user_has_permission('employees.view') and public.attendance_client_access(s.data->>'clientId',false) and public.current_user_scope_allows(s.data->>'employeeId',s.data) and exists(select 1 from public.hr_records e where e.tenant_id=s.tenant_id and e.module='employees' and e.record_id=s.data->>'employeeId' and public.current_user_scope_allows(e.record_id,e.data))
      union
      select distinct e.data->>'branchReporting' branch,'' client_id from public.hr_records e where e.tenant_id=public.current_tenant_id() and e.module='employees' and coalesce(e.data->>'branchReporting','')<>'' and public.current_user_has_permission('attendance.view') and public.current_user_has_permission('employees.view') and public.attendance_client_access('',false) and public.current_user_scope_allows(e.record_id,e.data)
    ) l),'[]'::jsonb));
$$;

create or replace function public.query_attendance_matrix(p_cutoff jsonb,p_search text default '',p_department text default '',p_position text default '',p_offset integer default 0,p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();a date:=(p_cutoff->>'start')::date;b date:=(p_cutoff->>'end')::date;result jsonb;client_filter text:=coalesce(p_cutoff->>'clientId','');branch_filter text:=coalesce(p_cutoff->>'branch','');
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.view'),false) or not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Attendance and employee view permissions required' using errcode='42501';end if;
  if client_filter<>'' and not public.attendance_client_access(client_filter,false) then raise exception 'Client outside assigned access' using errcode='42501';end if;
  if a is null or b is null or b<a or b-a>30 then raise exception 'Select a cutoff of 1 to 31 days' using errcode='23514';end if;
  with roster as materialized (
    select e.record_id,jsonb_build_object('name',e.data->>'name','employeeNo',e.data->>'employeeNo','department',e.data->>'department','position',e.data->>'position','branchReporting',e.data->>'branchReporting') data
    from public.hr_records e where e.tenant_id=tenant and e.module='employees' and public.current_user_scope_allows(e.record_id,e.data)
    and not exists(select 1 from regexp_split_to_table(lower(regexp_replace(btrim(p_search),'[,[:space:]]+',' ','g')),' ') word where word<>'' and strpos(lower(concat_ws(' ',e.data->>'name',e.data->>'employeeNo')),word)=0)
    and (exists(select 1 from public.hr_attendance_configuration c where c.tenant_id=tenant and c.kind='schedule' and c.data->>'employeeId'=e.record_id and (client_filter='' or c.data->>'clientId'=client_filter) and (branch_filter='' or c.data->>'branchReporting'=branch_filter) and public.attendance_client_access(c.data->>'clientId',false) and public.current_user_scope_allows(e.record_id,c.data) and (p_department='' or c.data->>'department'=p_department) and (p_position='' or c.data->>'position'=p_position) and daterange((c.data->>'effectiveFrom')::date,nullif(c.data->>'effectiveTo','')::date,'[)') && daterange(a,b+1,'[)'))
      or (client_filter='' and public.attendance_client_access('',false) and (branch_filter='' or e.data->>'branchReporting'=branch_filter) and (p_department='' or e.data->>'department'=p_department) and (p_position='' or e.data->>'position'=p_position)
        and exists(select 1 from generate_series(a,b,'1 day'::interval) d where not exists(select 1 from public.hr_attendance_configuration c where c.tenant_id=tenant and c.kind='schedule' and c.data->>'employeeId'=e.record_id and (c.data->>'effectiveFrom')::date<=d::date and (nullif(c.data->>'effectiveTo','') is null or d::date<(c.data->>'effectiveTo')::date)))))
  ), page as (select * from roster order by lower(data->>'name'),record_id offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)), days as materialized (
    select e.record_id,e.data,d::date work_date,attendance_private.day_context(e.record_id,d::date) context from page e cross join generate_series(a,b,'1 day'::interval) d
  ), contexts as materialized (
    select d.*,case when context ? 'assignment' then context else attendance_private.employee_day_context(record_id,work_date) end resolved from days d
  ), scoped as materialized (
    select d.*,case when resolved->>'basic'='true' then client_filter='' and public.attendance_client_access('',false) and (branch_filter='' or data->>'branchReporting'=branch_filter) and (p_department='' or data->>'department'=p_department) and (p_position='' or data->>'position'=p_position)
      else coalesce(public.current_user_scope_allows(record_id,resolved->'assignment') and public.attendance_client_access(resolved->'assignment'->>'clientId',false) and (client_filter='' or resolved->'assignment'->>'clientId'=client_filter) and (branch_filter='' or resolved->'assignment'->>'branchReporting'=branch_filter) and (p_department='' or resolved->'assignment'->>'department'=p_department) and (p_position='' or resolved->'assignment'->>'position'=p_position),false) end visible from contexts d
  ), cells as (
    select d.record_id,d.data,d.work_date,case when d.visible then d.resolved||jsonb_build_object('writable',public.attendance_client_access(coalesce(d.resolved->'assignment'->>'clientId',''),true) and not (coalesce(d.resolved->>'basic','false')='true' and (coalesce(r.data ? 'preparation',false) or exists(select 1 from attendance_private.review_registry v where v.tenant_id=tenant and v.employee_id=d.record_id and v.work_date=d.work_date and v.state='Approved')))) else jsonb_build_object('ready',false,'writable',false,'reason','Outside selected assignment or access scope') end context,
      r.data||jsonb_build_object('reviewState',coalesce((select state from attendance_private.review_registry v where v.tenant_id=tenant and v.employee_id=d.record_id and v.work_date=d.work_date),'Draft')) attendance,md5(r.data::text) attendance_hash,
      d.visible and exists(select 1 from attendance_private.posting_locks l where l.tenant_id=tenant and l.employee_id=d.record_id and l.work_date=d.work_date) posted
    from scoped d left join public.hr_records r on d.visible and r.tenant_id=tenant and r.module='attendance' and r.data->>'employeeId'=d.record_id and r.data->>'workDate'=d.work_date::text and public.current_user_scope_allows(r.record_id,r.data) and public.attendance_client_access(coalesce(r.data->>'clientId',''),false)
  ), employees as (
    select record_id,jsonb_build_object('id',record_id,'name',data->>'name','employeeNo',data->>'employeeNo','days',jsonb_object_agg(work_date::text,jsonb_build_object('employeeId',record_id,'date',work_date,'context',context,'record',attendance,'hash',coalesce(attendance_hash,''),'posted',posted))) row_data from cells group by record_id,data
  ) select jsonb_build_object('total',(select count(*) from roster),'rows',coalesce((select jsonb_agg(row_data order by lower(row_data->>'name'),record_id) from employees),'[]'::jsonb)) into result;
  return result;
end;$$;

-- Preserve the complete scheduled writer, including its mixed-client transaction.
alter function public.save_attendance_matrix(jsonb,jsonb,text) rename to save_scheduled_attendance_matrix;
alter function public.save_scheduled_attendance_matrix(jsonb,jsonb,text) set schema attendance_private;
revoke all on function attendance_private.save_scheduled_attendance_matrix(jsonb,jsonb,text) from public,anon,authenticated;

create function public.save_attendance_matrix(p_cutoff jsonb,p_edits jsonb,p_reference text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();a date:=(p_cutoff->>'start')::date;b date:=(p_cutoff->>'end')::date;item jsonb;context jsonb;e jsonb;previous public.hr_records;next_data jsonb;identifier text;employee text;day date;transaction_name text;status text;scheduled jsonb:='[]';result jsonb;count_saved integer:=0;minutes integer;late integer;under_minutes integer;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.view'),false) or not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Attendance access required' using errcode='42501';end if;
  if a is null or b is null or b<a or b-a>30 or jsonb_typeof(p_edits) is distinct from 'array' or coalesce(length(btrim(p_reference)),0) not between 1 and 1000 then raise exception 'Invalid cutoff, changes or attendance reference' using errcode='23514';end if;
  if jsonb_array_length(p_edits) not between 1 and 3100 or (select count(distinct value->>'employeeId') from jsonb_array_elements(p_edits))>100 or (select count(distinct (value->>'employeeId',value->>'workDate')) from jsonb_array_elements(p_edits))<>jsonb_array_length(p_edits) then raise exception 'Duplicate days or oversized batch' using errcode='23514';end if;
  perform attendance_private.lock_writers(tenant);
  for employee in select distinct value->>'employeeId' from jsonb_array_elements(p_edits) order by 1 loop
    perform 1 from public.hr_records where tenant_id=tenant and module='employees' and record_id=employee for update;
  end loop;
  for item in select value from jsonb_array_elements(p_edits) order by value->>'employeeId',value->>'workDate' loop
    day:=(item->>'workDate')::date;
    if day is null or day not between a and b then raise exception 'Attendance outside cutoff' using errcode='23514';end if;
    context:=attendance_private.day_context(item->>'employeeId',day);
    if context ? 'assignment' then scheduled:=scheduled||jsonb_build_array(item);continue;end if;
    context:=attendance_private.employee_day_context(item->>'employeeId',day);
    if context->>'recordingReady' is distinct from 'true' or not public.attendance_client_access('',true) or coalesce(p_cutoff->>'clientId','')<>'' then raise exception 'Employee attendance outside date or access scope' using errcode='42501';end if;
    select data into e from public.hr_records where tenant_id=tenant and module='employees' and record_id=item->>'employeeId';
    if coalesce(p_cutoff->>'branch','')<>'' and p_cutoff->>'branch' is distinct from e->>'branchReporting' then raise exception 'Employee outside selected branch' using errcode='42501';end if;
    if context->>'hash' is distinct from item->>'sourceHash' then raise exception 'Employee assignment changed; reload and review' using errcode='40001';end if;
    select * into previous from public.hr_records where tenant_id=tenant and module='attendance' and data->>'employeeId'=item->>'employeeId' and data->>'workDate'=item->>'workDate' for update;
    if not coalesce(public.current_user_has_permission(case when previous.record_id is null then 'attendance.create' else 'attendance.update' end),false)
      or (previous.record_id is not null and (not coalesce(public.current_user_scope_allows(previous.record_id,previous.data),false) or not public.attendance_client_access(coalesce(previous.data->>'clientId',''),true))) then raise exception 'Attendance write outside permission/scope' using errcode='42501';end if;
    if coalesce(md5(previous.data::text),'') is distinct from coalesce(item->>'expectedHash','') then raise exception 'Attendance changed; reload and review' using errcode='40001';end if;
    if previous.data ? 'preparation' or coalesce(previous.data->>'clientId','')<>'' then raise exception 'Existing attendance requires its dated assignment workflow' using errcode='23514';end if;
    if exists(select 1 from attendance_private.review_registry where tenant_id=tenant and employee_id=item->>'employeeId' and work_date=day and state='Approved') then raise exception 'Approved attendance requires controlled correction' using errcode='23514';end if;
    transaction_name:=item->>'transaction';
    if transaction_name is null or transaction_name not in ('Present','Absent','Paid Leave','Unpaid Leave','Day-off','AWOL/AWOP','Late/Undertime') then raise exception 'Premium duty requires reviewed schedule and calendar' using errcode='23514';end if;
    if coalesce(item->>'scheduledMinutes','')!~'^[0-9]{1,4}$' or coalesce(item->>'lateMinutes','')!~'^[0-9]{1,4}$' or coalesce(item->>'undertimeMinutes','')!~'^[0-9]{1,4}$' then raise exception 'Enter whole attendance minutes' using errcode='23514';end if;
    minutes:=(item->>'scheduledMinutes')::integer;late:=(item->>'lateMinutes')::integer;under_minutes:=(item->>'undertimeMinutes')::integer;
    if minutes not between (case when transaction_name='Day-off' then 0 else 1 end) and 1440 or late+under_minutes>minutes or (transaction_name<>'Late/Undertime' and late+under_minutes<>0) then raise exception 'Invalid scheduled or lost minutes' using errcode='23514';end if;
    status:=case when transaction_name in ('Present','Late/Undertime') then 'Present' when transaction_name in ('Paid Leave','Unpaid Leave') then 'Approved Leave' when transaction_name='Day-off' then 'Rest Day / Holiday' else 'Absent' end;
    identifier:=coalesce(previous.record_id,gen_random_uuid()::text);
    next_data:=coalesce(previous.data,'{}')-array['workedMinutes','segments']||jsonb_build_object('id',identifier,'employeeId',item->>'employeeId','workDate',item->>'workDate','status',status,'transaction',transaction_name,'scheduledMinutes',minutes,'lateMinutes',late,'undertimeMinutes',under_minutes,'leaveTreatment',case transaction_name when 'Paid Leave' then 'Paid' when 'Unpaid Leave' then 'Unpaid' else '' end,'absenceClassification',case when transaction_name='AWOL/AWOP' then 'Unauthorized' when status='Absent' then 'Pending Validation' else '' end,'factor',coalesce(previous.data->>'factor','Unknown / Not Disclosed'),'remarks',p_reference,'entryMode','employee','updatedAt',clock_timestamp(),'updatedBy',auth.uid(),'updatedByName',(select full_name from public.profiles where id=auth.uid()));
    if previous.record_id is null then next_data:=next_data||jsonb_build_object('createdAt',now(),'createdBy',auth.uid(),'createdByName',(select full_name from public.profiles where id=auth.uid()));end if;
    if not coalesce(public.current_user_scope_allows(identifier,next_data||jsonb_build_object('department',e->>'department','branchReporting',e->>'branchReporting')),false) then raise exception 'Attendance outside record scope' using errcode='42501';end if;
    -- Normal triggers still validate canonical records, posting locks and deployment dependencies.
    insert into public.hr_records(tenant_id,module,record_id,data,updated_at,updated_by) values(tenant,'attendance',identifier,next_data,clock_timestamp(),auth.uid()) on conflict(module,record_id) do update set data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning data into next_data;
    insert into attendance_private.record_history(tenant_id,record_id,previous_data,next_data,actor) values(tenant,identifier,previous.data,next_data,auth.uid());
    insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),'Employee attendance',format('Attendance %s employee %s date %s; %s',identifier,item->>'employeeId',day,transaction_name));
    count_saved:=count_saved+1;
  end loop;
  if jsonb_array_length(scheduled)>0 then result:=attendance_private.save_scheduled_attendance_matrix(p_cutoff,scheduled,p_reference);count_saved:=count_saved+(result->>'saved')::integer;end if;
  return jsonb_build_object('saved',count_saved);
end;$$;
revoke all on function public.save_attendance_matrix(jsonb,jsonb,text) from public,anon;
grant execute on function public.save_attendance_matrix(jsonb,jsonb,text) to authenticated;
commit;
