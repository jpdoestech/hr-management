-- Additive attendance preparation. No production backfill, automatic holiday inference or payroll posting.
begin;
create schema attendance_private;
revoke all on schema attendance_private from public,anon,authenticated;
-- Optional client restrictions use the existing Access Control resource-assignment model.
-- They narrow legacy employee/branch scopes; they never grant access on their own.
create function public.attendance_client_access(p_client text,p_write boolean default false) returns boolean language sql stable security definer set search_path=public as $$
  select not exists(select 1 from public.access_resource_assignments a where a.tenant_id=public.current_tenant_id() and a.user_id=auth.uid() and a.resource_type='attendance_client') or exists(select 1 from public.access_resource_assignments a where a.tenant_id=public.current_tenant_id() and a.user_id=auth.uid() and a.resource_type='attendance_client' and a.resource_id=p_client and (not p_write or a.access_level in ('edit','manage')));
$$;
revoke all on function public.attendance_client_access(text,boolean) from public,anon;
grant execute on function public.attendance_client_access(text,boolean) to authenticated;
create function attendance_private.lock_writers(p_tenant uuid) returns void language plpgsql set search_path=public as $$
begin
  if to_regprocedure('manpower_private.lock_source_snapshot(uuid)') is not null then execute 'select manpower_private.lock_source_snapshot($1)' using p_tenant;end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance:'||p_tenant::text,0));
end;$$;
create policy attendance_client_select on public.hr_records as restrictive for select to authenticated using(module<>'attendance' or public.attendance_client_access(coalesce(data->>'clientId',''),false));
create policy attendance_client_insert on public.hr_records as restrictive for insert to authenticated with check(module<>'attendance' or public.attendance_client_access(coalesce(data->>'clientId',''),true));
create policy attendance_client_update on public.hr_records as restrictive for update to authenticated using(module<>'attendance' or public.attendance_client_access(coalesce(data->>'clientId',''),true)) with check(module<>'attendance' or public.attendance_client_access(coalesce(data->>'clientId',''),true));
create policy attendance_client_delete on public.hr_records as restrictive for delete to authenticated using(module<>'attendance' or public.attendance_client_access(coalesce(data->>'clientId',''),true));

create table public.hr_attendance_configuration(
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  id uuid not null default gen_random_uuid(),kind text not null check(kind in ('schedule','rest_override','holiday','calendar_review','client_policy','statutory')),
  identity_key text not null check(length(identity_key) between 1 and 180),revision integer not null default 1,
  data jsonb not null,updated_at timestamptz not null default now(),updated_by uuid references auth.users(id),
  primary key(tenant_id,id),unique(tenant_id,kind,identity_key)
);
create table attendance_private.configuration_history(tenant_id uuid,id uuid,revision integer,data jsonb,actor uuid,at timestamptz default now());
create table attendance_private.record_history(tenant_id uuid,record_id text,previous_data jsonb,next_data jsonb,actor uuid,at timestamptz default now());
create table attendance_private.write_intents(tx bigint,tenant_id uuid,employee_id text,work_date date,primary key(tx,tenant_id,employee_id,work_date));
create table attendance_private.posting_locks(tenant_id uuid,employee_id text,work_date date,external_reference text not null,posted_at timestamptz not null default now(),primary key(tenant_id,employee_id,work_date));
create table attendance_private.review_registry(tenant_id uuid,employee_id text,work_date date,state text not null check(state in ('Draft','Approved')),actor uuid,at timestamptz not null default now(),primary key(tenant_id,employee_id,work_date));
create table public.hr_attendance_preferences(tenant_id uuid not null default public.current_tenant_id(),user_id uuid not null references auth.users(id),blank_mode text not null check(blank_mode in ('present','absent')),primary key(tenant_id,user_id));
create table public.hr_attendance_cutoffs(tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),id uuid not null default gen_random_uuid(),data jsonb not null,created_at timestamptz not null default now(),created_by uuid references auth.users(id),primary key(tenant_id,id));
alter table public.hr_attendance_cutoffs enable row level security;
create policy attendance_cutoff_client_restriction on public.hr_attendance_cutoffs as restrictive for select to authenticated using(public.attendance_client_access(data->>'clientId',false));
create policy attendance_cutoffs_read on public.hr_attendance_cutoffs for select to authenticated using(tenant_id=public.current_tenant_id() and public.current_user_has_permission('attendance.view') and (public.current_user_scope_allows(id::text,data) or exists(select 1 from public.hr_attendance_configuration s where s.tenant_id=hr_attendance_cutoffs.tenant_id and s.kind='schedule' and s.data->>'clientId'=hr_attendance_cutoffs.data->>'clientId' and s.data->>'branchReporting'=hr_attendance_cutoffs.data->>'branchReporting' and public.current_user_scope_allows(s.data->>'employeeId',s.data))));
revoke all on public.hr_attendance_cutoffs from public,anon,authenticated;
grant select on public.hr_attendance_cutoffs to authenticated;
create function public.create_attendance_cutoff(p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();saved public.hr_attendance_cutoffs;a date;b date;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.create'),false) or not (coalesce(public.current_user_scope_allows('',p_data),false) or exists(select 1 from public.hr_attendance_configuration s where s.tenant_id=tenant and s.kind='schedule' and s.data->>'clientId'=p_data->>'clientId' and s.data->>'branchReporting'=p_data->>'branchReporting' and public.current_user_scope_allows(s.data->>'employeeId',s.data))) then raise exception 'Attendance cutoff outside permission/scope' using errcode='42501';end if;
  a:=(p_data->>'start')::date;b:=(p_data->>'end')::date;
  if not public.attendance_client_access(p_data->>'clientId',true) then raise exception 'Cutoff outside assigned client edit access' using errcode='42501';end if;
  if a is null or b is null or b<a or b-a>30 or coalesce(p_data->>'branchReporting','')='' or not exists(select 1 from public.hr_manpower_clients where tenant_id=tenant and id::text=p_data->>'clientId' and active) or nullif(p_data->>'payout','') is not null and (p_data->>'payout')::date<b then raise exception 'Invalid cutoff dates, payout, branch or client' using errcode='23514';end if;
  insert into public.hr_attendance_cutoffs(tenant_id,data,created_by) values(tenant,jsonb_build_object('start',a,'end',b,'branch',p_data->>'branchReporting','branchReporting',p_data->>'branchReporting','clientId',p_data->>'clientId','payout',p_data->>'payout'),auth.uid()) returning * into saved;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),'Attendance preparation','Created attendance cutoff '||saved.id);
  return to_jsonb(saved);
end;$$;
revoke all on function public.create_attendance_cutoff(jsonb) from public,anon;
grant execute on function public.create_attendance_cutoff(jsonb) to authenticated;
alter table public.hr_attendance_configuration enable row level security;
alter table public.hr_attendance_preferences enable row level security;
create policy attendance_configuration_read on public.hr_attendance_configuration for select to authenticated using(
  tenant_id=public.current_tenant_id() and public.current_user_has_permission('attendance.view') and (not (data ? 'clientId') or public.attendance_client_access(data->>'clientId',false)) and
  (kind in ('holiday','calendar_review','statutory') or (public.current_user_has_permission('employees.view') and public.current_user_scope_allows(coalesce(data->>'employeeId',''),data))));
create policy attendance_preferences_own on public.hr_attendance_preferences for all to authenticated using(tenant_id=public.current_tenant_id() and user_id=auth.uid() and public.current_user_has_permission('attendance.view')) with check(tenant_id=public.current_tenant_id() and user_id=auth.uid() and public.current_user_has_permission('attendance.view'));
revoke all on public.hr_attendance_configuration,public.hr_attendance_preferences from anon,authenticated;
grant select on public.hr_attendance_configuration to authenticated;
grant select,insert,update on public.hr_attendance_preferences to authenticated;
create index attendance_schedule_employee on public.hr_attendance_configuration(tenant_id,(data->>'employeeId')) where kind='schedule';
create index attendance_configuration_scope_dates on public.hr_attendance_configuration(tenant_id,kind,(data->>'clientId'),(data->>'branchReporting'),(data->>'effectiveFrom'));

create function attendance_private.segments_valid(p jsonb) returns boolean language plpgsql immutable set search_path=public as $$
declare s jsonb;previous_end integer:=-1;a integer;b integer;pause integer;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 12 then return false;end if;
  for s in select value from jsonb_array_elements(p) order by (value->>'start')::integer loop
    if coalesce(s->>'start','')!~'^[0-9]+$' or coalesce(s->>'end','')!~'^[0-9]+$' or coalesce(s->>'breakMinutes','')!~'^[0-9]+$' then return false;end if;
    a:=(s->>'start')::integer;b:=(s->>'end')::integer;pause:=(s->>'breakMinutes')::integer;
    if a<previous_end or a>=2880 or b<=a or b>2880 or b-a>1440 or pause<0 or pause>=b-a then return false;end if;
    previous_end:=b;
  end loop;return (select sum((elem.value->>'end')::integer-(elem.value->>'start')::integer-(elem.value->>'breakMinutes')::integer)<=1440 from jsonb_array_elements(p) elem(value));
exception when others then return false;
end;$$;
create function attendance_private.minutes(p jsonb) returns integer language sql immutable as $$select coalesce(sum((s->>'end')::integer-(s->>'start')::integer-(s->>'breakMinutes')::integer),0)::integer from jsonb_array_elements(p) s$$;
create function attendance_private.deployment_match(p_employee text,p_date date,p_assignment jsonb) returns jsonb language plpgsql stable set search_path=public as $$
declare source jsonb;assignment jsonb;
begin
  if to_regclass('manpower_private.primary_intervals') is null then
    return jsonb_build_object('matches',to_regclass('public.hr_manpower_reservations') is null,'mode','Reviewed attendance assignment; no promoted deployment ledger');
  end if;
  execute 'select to_jsonb(i) from manpower_private.primary_intervals i where tenant_id=$1 and employee_id=$2 and actual_date<=$3 and (ended_date is null or $3<ended_date)' into source using public.current_tenant_id(),p_employee,p_date;
  if source is null then return jsonb_build_object('matches',false);end if;
  if source->>'source_kind'='operational' then
    execute 'select jsonb_build_object(''clientId'',client_id,''branchReporting'',branch_reporting,''department'',department,''position'',position) from public.hr_manpower_operational_deployments where tenant_id=$1 and id::text=$2 and state in (''Deployed'',''Ended'')' into assignment using public.current_tenant_id(),source->>'source_id';
  else
    execute 'select jsonb_build_object(''clientId'',q.client_id,''branchReporting'',q.branch_reporting,''department'',l.department,''position'',l.position) from public.hr_manpower_reservations r join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.id=r.line_id join public.hr_manpower_requests q on q.tenant_id=l.tenant_id and q.id=l.request_id where r.tenant_id=$1 and r.id::text=$2 and r.state in (''Deployed'',''Ended'')' into assignment using public.current_tenant_id(),source->>'source_id';
  end if;
  if assignment is null or exists(select 1 from unnest(array['clientId','branchReporting','department','position']) key where assignment->>key is distinct from p_assignment->>key) then return jsonb_build_object('matches',false);end if;
  return jsonb_build_object('matches',true,'kind',source->>'source_kind','id',source->>'source_id','actualDate',source->>'actual_date','endedDate',source->>'ended_date');
end;$$;
create function attendance_private.metrics(duties jsonb,actual jsonb) returns jsonb language plpgsql immutable as $$
declare d jsonb;s jsonb;first_min integer;last_min integer;cursor_min integer;late integer:=0;under_min integer:=0;pause integer;scheduled integer;
begin
  if not attendance_private.segments_valid(duties) or not attendance_private.segments_valid(actual) then raise exception 'Invalid duty segments' using errcode='23514';end if;
  scheduled:=attendance_private.minutes(duties);
  for d in select value from jsonb_array_elements(duties) loop
    select min((value->>'start')::integer),max((value->>'end')::integer),coalesce(sum((value->>'breakMinutes')::integer),0) into first_min,last_min,pause
      from jsonb_array_elements(actual) where (value->>'start')::integer<(d->>'end')::integer and (value->>'end')::integer>(d->>'start')::integer;
    if first_min is null then under_min:=under_min+(d->>'end')::integer-(d->>'start')::integer-(d->>'breakMinutes')::integer;
    else
      first_min:=greatest(first_min,(d->>'start')::integer);last_min:=least(last_min,(d->>'end')::integer);
      late:=late+first_min-(d->>'start')::integer;under_min:=under_min+(d->>'end')::integer-last_min;cursor_min:=first_min;
      for s in select value from jsonb_array_elements(actual) where (value->>'start')::integer<(d->>'end')::integer and (value->>'end')::integer>(d->>'start')::integer order by (value->>'start')::integer loop
        if (s->>'start')::integer>cursor_min then under_min:=under_min+(s->>'start')::integer-cursor_min;end if;cursor_min:=greatest(cursor_min,(s->>'end')::integer);
      end loop;
      under_min:=under_min+greatest(0,pause-(d->>'breakMinutes')::integer);
    end if;
  end loop;
  late:=least(late,scheduled);under_min:=least(under_min,scheduled-late);
  return jsonb_build_object('scheduledMinutes',scheduled,'workedMinutes',attendance_private.minutes(actual),'lateMinutes',late,'undertimeMinutes',under_min);
end;$$;

create function public.save_attendance_configuration(p_id uuid,p_kind text,p_key text,p_expected integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();previous public.hr_attendance_configuration;saved public.hr_attendance_configuration;e jsonb;d jsonb;v text;minimum jsonb;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.manage'),false) then raise exception 'Attendance management permission required' using errcode='42501';end if;
  perform attendance_private.lock_writers(tenant);
  if p_id is null or p_expected is null or p_kind not in ('schedule','rest_override','holiday','calendar_review','client_policy','statutory') or length(btrim(p_key)) not between 1 and 180 or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid configuration' using errcode='23514';end if;
  if p_kind in ('client_policy','statutory') and not coalesce(public.current_user_has_permission('settings.manage'),false) then raise exception 'Settings management permission required' using errcode='42501';end if;
  if p_kind in ('holiday','calendar_review','statutory') and not public.attendance_client_access('',true) then raise exception 'Shared calendar/statutory configuration requires unrestricted client management' using errcode='42501';end if;
  if p_data ? 'clientId' and not public.attendance_client_access(p_data->>'clientId',true) then raise exception 'Client configuration outside assigned access' using errcode='42501';end if;
  if p_kind='statutory' and not exists(select 1 from public.profiles where id=auth.uid() and tenant_id=tenant and is_super_admin) then raise exception 'Only the system superadministrator can review statutory versions' using errcode='42501';end if;
  if coalesce(p_data->>'reference','')='' or jsonb_typeof(p_data->'reviewed') is distinct from 'boolean' or coalesce(p_data->>'effectiveFrom','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Reference, review state and effective start are required' using errcode='23514';end if;
  perform (p_data->>'effectiveFrom')::date;
  if nullif(p_data->>'effectiveTo','') is not null and (p_data->>'effectiveTo')::date<=(p_data->>'effectiveFrom')::date then raise exception 'End date must be the first day no longer effective' using errcode='23514';end if;
  if p_kind='rest_override' then
    select data into d from public.hr_attendance_configuration where tenant_id=tenant and kind='schedule' and data->>'employeeId'=p_data->>'employeeId' and (data->>'effectiveFrom')::date<=(p_data->>'effectiveFrom')::date and (nullif(data->>'effectiveTo','') is null or (p_data->>'effectiveFrom')::date<(data->>'effectiveTo')::date) limit 1;
    if d is null or not public.attendance_client_access(d->>'clientId',true) or not public.current_user_scope_allows(p_data->>'employeeId',d) then raise exception 'Override outside dated assignment access' using errcode='42501';end if;
    p_data:=p_data||jsonb_build_object('clientId',d->>'clientId','branchReporting',d->>'branchReporting','department',d->>'department');
  end if;
  if not coalesce(public.current_user_scope_allows(coalesce(p_data->>'employeeId',''),p_data),false) then raise exception 'Configuration outside your scope' using errcode='42501';end if;
  if p_kind in ('schedule','rest_override') then
    if not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Employee view permission required' using errcode='42501';end if;
    select data into e from public.hr_records where tenant_id=tenant and module='employees' and record_id=p_data->>'employeeId';
    if e is null or not coalesce(public.current_user_scope_allows(p_data->>'employeeId',e),false) then raise exception 'Employee outside your scope' using errcode='42501';end if;
  end if;
  if p_kind='schedule' then
    if exists(select 1 from unnest(array['region','province','city']) key where coalesce(btrim(p_data->'geography'->>key),'')='') then raise exception 'Reviewed worksite region, province and city scope codes are required; explicitly record N/A for an inapplicable province' using errcode='23514';end if;
    if p_data ? 'basicDailyCentavos' and (coalesce(p_data->>'basicDailyCentavos','')!~'^[0-9]{1,12}$' or (p_data->>'basicDailyCentavos')::bigint<=0) then raise exception 'Daily rate requires positive integer centavos' using errcode='23514';end if;
    if coalesce(p_data->>'branchReporting','')='' or coalesce(p_data->>'department','')='' or coalesce(p_data->>'position','')='' or coalesce(p_data->>'worksite','')='' or not exists(select 1 from public.hr_manpower_clients where tenant_id=tenant and id::text=p_data->>'clientId' and active) then raise exception 'Select client, dated worksite, branch, department and position' using errcode='23514';end if;
    if jsonb_typeof(p_data->'week') is distinct from 'array' or jsonb_array_length(p_data->'week')<>7 then raise exception 'Configure all seven weekdays' using errcode='23514';end if;
    for d in select value from jsonb_array_elements(p_data->'week') loop
      if jsonb_typeof(d->'restDay') is distinct from 'boolean' or not attendance_private.segments_valid(d->'segments') then raise exception 'Invalid weekday duty schedule' using errcode='23514';end if;
    end loop;
    if exists(select 1 from public.hr_attendance_configuration c where c.tenant_id=tenant and c.kind='schedule' and c.id<>p_id and c.data->>'employeeId'=p_data->>'employeeId' and daterange((c.data->>'effectiveFrom')::date,nullif(c.data->>'effectiveTo','')::date,'[)') && daterange((p_data->>'effectiveFrom')::date,nullif(p_data->>'effectiveTo','')::date,'[)')) then raise exception 'Overlapping employee assignment schedules' using errcode='23514';end if;
  end if;
  if p_kind='rest_override' and (jsonb_typeof(p_data->'restDay') is distinct from 'boolean' or coalesce(p_data->>'effectiveTo','')<>((p_data->>'effectiveFrom')::date+1)::text) then raise exception 'Rest-day override must cover exactly one day' using errcode='23514';end if;
  if p_kind in ('holiday','calendar_review') then
    if p_kind='holiday' then p_data:=p_data||jsonb_build_object('holidayId',lower(btrim(regexp_replace(p_data->>'holidayId','[[:space:]]+',' ','g'))));end if;
    if coalesce(p_data->>'scopeType','') not in ('national','region','province','city') or (p_data->>'scopeType'<>'national' and coalesce(p_data->>'scopeCode','')='') then raise exception 'Geographic scope required' using errcode='23514';end if;
    if p_kind='holiday' and (coalesce(p_data->>'classification','') not in ('special_working','special_non_working','regular_holiday') or coalesce(p_data->>'holidayId','')='' or coalesce(p_data->>'effectiveTo','')<>((p_data->>'effectiveFrom')::date+1)::text) then raise exception 'Configure one holiday date and stable declaration identity' using errcode='23514';end if;
    if p_kind='holiday' and exists(select 1 from public.hr_attendance_configuration c where c.tenant_id=tenant and c.kind='holiday' and c.id<>p_id and c.data->>'effectiveFrom'=p_data->>'effectiveFrom' and lower(c.data->>'holidayId')=lower(p_data->>'holidayId') and c.data->>'scopeType'=p_data->>'scopeType' and coalesce(c.data->>'scopeCode','')=coalesce(p_data->>'scopeCode','')) then raise exception 'Declaration already registered; update its existing version' using errcode='23505';end if;
  end if;
  if p_kind in ('client_policy','statutory') then
    if p_kind='client_policy' then
      select data into minimum from public.hr_attendance_configuration where tenant_id=tenant and kind='statutory' and id::text=p_data->>'statutoryId';
      if minimum is null or not exists(select 1 from public.hr_manpower_clients where tenant_id=tenant and id::text=p_data->>'clientId') then raise exception 'Client and statutory version required' using errcode='23514';end if;
    end if;
    foreach v in array array['ordinary','rest_day','special_non_working','special_non_working_rest_day','regular_holiday','regular_holiday_rest_day','double_regular_holiday','double_regular_holiday_rest_day'] loop
      if coalesce(p_data->'worked'->>v,'')!~'^[0-9]{1,7}$' or coalesce(p_data->'unworked'->>v,'')!~'^[0-9]{1,7}$' then raise exception 'Configure all worked/unworked basis points' using errcode='23514';end if;
      if minimum is not null and ((p_data->'worked'->>v)::integer<(minimum->'worked'->>v)::integer or (p_data->'unworked'->>v)::integer<(minimum->'unworked'->>v)::integer) then raise exception 'Client rates cannot be below statutory minimums' using errcode='23514';end if;
    end loop;
  end if;
  select * into previous from public.hr_attendance_configuration where tenant_id=tenant and id=p_id for update;
  if found and previous.data ? 'clientId' and not public.attendance_client_access(previous.data->>'clientId',true) then raise exception 'Existing client configuration outside assigned access' using errcode='42501';end if;
  if found and not coalesce(public.current_user_scope_allows(coalesce(previous.data->>'employeeId',''),previous.data),false) then raise exception 'Existing configuration outside your scope' using errcode='42501';end if;
  if found and (previous.revision<>p_expected or previous.kind<>p_kind) or not found and p_expected<>0 then raise exception 'Configuration changed; reload' using errcode='40001';end if;
  if previous.id is not null and previous.data->>'reviewed'='true' and p_kind in ('client_policy','statutory') then raise exception 'Reviewed wage versions are immutable; create a new effective-dated version' using errcode='23514';end if;
  insert into public.hr_attendance_configuration(tenant_id,id,kind,identity_key,revision,data,updated_by) values(tenant,p_id,p_kind,lower(btrim(p_key)),p_expected+1,p_data,auth.uid())
    on conflict(tenant_id,id) do update set revision=excluded.revision,data=excluded.data,identity_key=excluded.identity_key,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into saved;
  insert into attendance_private.configuration_history values(tenant,saved.id,saved.revision,saved.data,auth.uid(),now());
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),'Attendance configuration',format('Reviewed configuration %s, version %s, kind %s',saved.id,saved.revision,p_kind));
  return to_jsonb(saved);
end;$$;

create function attendance_private.day_context(p_employee text,p_date date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();assignment public.hr_attendance_configuration;override_row public.hr_attendance_configuration;week_day jsonb;holidays jsonb;coverage jsonb;holiday text:='ordinary';regular_count integer;special_count integer;unreviewed boolean;ready boolean;e jsonb;snapshot jsonb;deployment jsonb;
begin
  select data into e from public.hr_records where tenant_id=tenant and module='employees' and record_id=p_employee;
  select * into assignment from public.hr_attendance_configuration where tenant_id=tenant and kind='schedule' and data->>'employeeId'=p_employee and (data->>'effectiveFrom')::date<=p_date and (nullif(data->>'effectiveTo','') is null or p_date<(data->>'effectiveTo')::date) order by data->>'effectiveFrom' desc limit 1;
  if assignment.id is null then return jsonb_build_object('ready',false,'reason','No dated assignment schedule');end if;
  week_day:=assignment.data->'week'->extract(dow from p_date)::integer;
  select * into override_row from public.hr_attendance_configuration where tenant_id=tenant and kind='rest_override' and data->>'employeeId'=p_employee and data->>'effectiveFrom'=p_date::text order by updated_at desc limit 1;
  if override_row.id is not null then week_day:=week_day||jsonb_build_object('restDay',override_row.data->'restDay');end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'data',c.data) order by c.id),'[]') into holidays from public.hr_attendance_configuration c where tenant_id=tenant and kind='holiday' and data->>'effectiveFrom'=p_date::text and (data->>'scopeType'='national' or data->>'scopeCode'=assignment.data->'geography'->>(data->>'scopeType'));
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'data',c.data) order by c.id),'[]') into coverage from public.hr_attendance_configuration c where tenant_id=tenant and kind='calendar_review' and data->>'reviewed'='true' and (data->>'effectiveFrom')::date<=p_date and (nullif(data->>'effectiveTo','') is null or p_date<(data->>'effectiveTo')::date) and (data->>'scopeType'='national' or data->>'scopeCode'=assignment.data->'geography'->>(data->>'scopeType'));
  select count(distinct lower(value->'data'->>'holidayId')) filter(where value->'data'->>'classification'='regular_holiday'),count(distinct lower(value->'data'->>'holidayId')) filter(where value->'data'->>'classification'='special_non_working'),coalesce(bool_or(value->'data'->>'reviewed' is distinct from 'true'),false) into regular_count,special_count,unreviewed from jsonb_array_elements(holidays);
  if regular_count=2 then holiday:='double_regular_holiday';elsif regular_count=1 then holiday:='regular_holiday';elsif special_count=1 then holiday:='special_non_working';elsif jsonb_array_length(holidays)>0 then holiday:='special_working';end if;
  ready:=assignment.data->>'reviewed'='true' and p_date<=(now() at time zone 'Asia/Manila')::date and jsonb_array_length(coverage)>0 and not unreviewed and regular_count<=2 and special_count<=1 and not (regular_count>0 and special_count>0) and (override_row.id is null or override_row.data->>'reviewed'='true') and coalesce(e->>'dateHired','9999-12-31')<=p_date::text and coalesce(public.current_user_scope_allows(p_employee,assignment.data),false);
  if not public.attendance_client_access(assignment.data->>'clientId',false) or (e->>'status'='Separated' and coalesce(nullif(e->>'statusDate',''),'0001-01-01')<=p_date::text) then ready:=false;end if;
  deployment:=attendance_private.deployment_match(p_employee,p_date,assignment.data);
  if deployment->>'matches' is distinct from 'true' then ready:=false;end if;
  snapshot:=jsonb_build_object('assignment',jsonb_build_object('id',assignment.id,'revision',assignment.revision,'data',assignment.data),'deployment',deployment,'override',to_jsonb(override_row),'holidays',holidays,'coverage',coverage,'employeeStatus',jsonb_build_object('dateHired',e->>'dateHired','status',e->>'status','statusDate',e->>'statusDate'));
  return jsonb_build_object('ready',coalesce(ready,false),'reason',case when ready then '' else 'Schedule, calendar, employment dates or scope need review' end,'holiday',holiday,'restDay',(week_day->>'restDay')::boolean,'segments',week_day->'segments','assignment',assignment.data,'snapshot',snapshot,'hash',md5(snapshot::text));
end;$$;

create function public.query_attendance_matrix(p_cutoff jsonb,p_search text default '',p_department text default '',p_position text default '',p_offset integer default 0,p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();a date:=(p_cutoff->>'start')::date;b date:=(p_cutoff->>'end')::date;result jsonb;total integer;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.view'),false) or not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Attendance and employee view permissions required' using errcode='42501';end if;
  if not public.attendance_client_access(p_cutoff->>'clientId',false) then raise exception 'Client outside assigned access' using errcode='42501';end if;
  if a is null or b is null or b<a or b-a>30 or coalesce(p_cutoff->>'branch','')='' or coalesce(p_cutoff->>'clientId','')='' then raise exception 'Select branch, client and a cutoff of 1 to 31 days' using errcode='23514';end if;
  with roster as materialized (
    select e.record_id,jsonb_build_object('name',e.data->>'name','employeeNo',e.data->>'employeeNo') data from public.hr_records e where e.tenant_id=tenant and e.module='employees' and public.current_user_scope_allows(e.record_id,e.data)
    and not exists(select 1 from regexp_split_to_table(lower(regexp_replace(btrim(p_search),'[,[:space:]]+',' ','g')),' ') word where word<>'' and strpos(lower(concat_ws(' ',e.data->>'name',e.data->>'employeeNo')),word)=0)
    and exists(select 1 from public.hr_attendance_configuration c where c.tenant_id=tenant and c.kind='schedule' and c.data->>'employeeId'=e.record_id and c.data->>'clientId'=p_cutoff->>'clientId' and c.data->>'branchReporting'=p_cutoff->>'branch' and public.current_user_scope_allows(e.record_id,c.data) and (p_department='' or c.data->>'department'=p_department) and (p_position='' or c.data->>'position'=p_position) and daterange((c.data->>'effectiveFrom')::date,nullif(c.data->>'effectiveTo','')::date,'[)') && daterange(a,b+1,'[)'))
  ), page as (select * from roster order by lower(data->>'name'),record_id offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)), days as materialized (
    select e.record_id,e.data,d::date work_date,attendance_private.day_context(e.record_id,d::date) context from page e cross join generate_series(a,b,'1 day'::interval) d
  ), cells as (
    select d.*,r.data||jsonb_build_object('reviewState',coalesce((select state from attendance_private.review_registry v where v.tenant_id=tenant and v.employee_id=d.record_id and v.work_date=d.work_date),'Draft')) attendance,md5(r.data::text) attendance_hash,r.record_id attendance_id,exists(select 1 from attendance_private.posting_locks l where l.tenant_id=tenant and l.employee_id=d.record_id and l.work_date=d.work_date) posted
    from days d left join public.hr_records r on r.tenant_id=tenant and r.module='attendance' and r.data->>'employeeId'=d.record_id and r.data->>'workDate'=d.work_date::text and public.current_user_scope_allows(r.record_id,r.data) and public.attendance_client_access(coalesce(r.data->>'clientId',''),false)
    where d.context->'assignment'->>'clientId'=p_cutoff->>'clientId' and d.context->'assignment'->>'branchReporting'=p_cutoff->>'branch'
  ), employees as (
    select record_id,jsonb_build_object('id',record_id,'name',data->>'name','employeeNo',data->>'employeeNo','days',jsonb_object_agg(work_date::text,jsonb_build_object('employeeId',record_id,'date',work_date,'context',context,'record',attendance,'hash',coalesce(attendance_hash,''),'posted',posted))) row_data from cells group by record_id,data
  ) select jsonb_build_object('total',(select count(*) from roster),'rows',coalesce((select jsonb_agg(row_data order by lower(row_data->>'name'),record_id) from employees),'[]'::jsonb)) into result;
  return result;
end;$$;
create function public.attendance_preparation_options() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.hr_manpower_clients c where c.tenant_id=public.current_tenant_id() and c.active and public.attendance_client_access(c.id::text,false) and public.current_user_has_permission('attendance.view') and (public.current_user_has_permission('attendance.manage') or exists(select 1 from public.hr_attendance_configuration s where s.tenant_id=c.tenant_id and s.kind='schedule' and s.data->>'clientId'=c.id::text and public.current_user_scope_allows(s.data->>'employeeId',s.data)))),'[]'::jsonb));
$$;

-- This guard participates in normal hr_records writes; existing triggers/interlocks still run.
create function attendance_private.guard_record() returns trigger language plpgsql security definer set search_path=public as $$
declare tenant uuid;employee text;day date;allowed boolean;
begin
  if tg_op='UPDATE' and old.module='attendance' and (new.module<>old.module or new.data->>'employeeId' is distinct from old.data->>'employeeId' or new.data->>'workDate' is distinct from old.data->>'workDate') then raise exception 'Attendance identity is immutable; use an authorized correction' using errcode='23514';end if;
  if (case when tg_op='DELETE' then old.module else new.module end)<>'attendance' then if tg_op='DELETE' then return old;end if;return new;end if;
  tenant:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  employee:=case when tg_op='DELETE' then old.data->>'employeeId' else new.data->>'employeeId' end;
  day:=(case when tg_op='DELETE' then old.data->>'workDate' else new.data->>'workDate' end)::date;
  perform attendance_private.lock_writers(tenant);
  perform 1 from public.hr_records where tenant_id=tenant and module='employees' and record_id=employee for update;
  if exists(select 1 from attendance_private.posting_locks where tenant_id=tenant and employee_id=employee and work_date=day) or (tg_op='UPDATE' and exists(select 1 from attendance_private.posting_locks where tenant_id=old.tenant_id and employee_id=old.data->>'employeeId' and work_date=(old.data->>'workDate')::date)) then raise exception 'Posted attendance requires a controlled adjustment' using errcode='23514';end if;
  select exists(select 1 from attendance_private.write_intents where tx=txid_current() and tenant_id=tenant and employee_id=employee and work_date=day) into allowed;
  if not allowed then
    if tg_op='INSERT' and (new.data ?| array['preparation','segments','reviewState','reviewedAt','reviewedBy','payrollPosted','postedAt']) then raise exception 'Use the guarded attendance preparation workflow' using errcode='42501';end if;
    if tg_op='UPDATE' then
      if (new.data->'reviewState') is distinct from (old.data->'reviewState') or (new.data->'reviewedBy') is distinct from (old.data->'reviewedBy') or (new.data->'reviewedAt') is distinct from (old.data->'reviewedAt') or (new.data->'preparation') is distinct from (old.data->'preparation') or new.data ?| array['payrollPosted','postedAt'] then raise exception 'Protected attendance metadata' using errcode='42501';end if;
      if new.data->'segments' is distinct from old.data->'segments' then raise exception 'Use the guarded duty time editor' using errcode='42501';end if;
      if old.data ? 'preparation' and (new.data-array['remarks','attachment','attachmentData','factor','absenceClassification','employeeName','department','branchReporting','updatedAt','updatedBy','updatedByName','_dataResetAt']) is distinct from (old.data-array['remarks','attachment','attachmentData','factor','absenceClassification','employeeName','department','branchReporting','updatedAt','updatedBy','updatedByName','_dataResetAt']) then raise exception 'Correct prepared duty through Attendance preparation; documents, factors and remarks remain editable here' using errcode='23514';end if;
      if old.data ? 'preparation' then
        insert into attendance_private.record_history(tenant_id,record_id,previous_data,next_data,actor) values(tenant,old.record_id,old.data,new.data,auth.uid());
        insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),'Attendance annotation','Corrected attendance annotations: '||old.record_id);
      end if;
    end if;
  end if;
  if tg_op='DELETE' then
    insert into attendance_private.record_history(tenant_id,record_id,previous_data,next_data,actor) values(tenant,old.record_id,old.data,null,auth.uid());
    delete from attendance_private.review_registry where tenant_id=tenant and employee_id=employee and work_date=day;
    return old;
  end if;return new;
end;$$;
create trigger attendance_00_preparation_guard before insert or update or delete on public.hr_records for each row execute function attendance_private.guard_record();
create function attendance_private.dated_assignment_labels() returns trigger language plpgsql as $$
begin
  if new.module='attendance' and new.data ? 'preparation' then new.data:=new.data||jsonb_build_object('department',new.data->'preparation'->'assignment'->>'department','branchReporting',new.data->'preparation'->'assignment'->>'branchReporting');end if;return new;
end;$$;
create trigger zz_attendance_dated_labels before insert or update on public.hr_records for each row execute function attendance_private.dated_assignment_labels();

create function public.save_attendance_matrix(p_cutoff jsonb,p_edits jsonb,p_reference text) returns jsonb language plpgsql security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();item jsonb;context jsonb;previous public.hr_records;saved jsonb;metrics jsonb;actual jsonb;transaction_name text;classification text;expected text;status text;record_identifier text;key_name text;span_a numeric;span_b numeric;peer record;part jsonb;employee_data jsonb;review_state text;count_saved integer:=0;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.view'),false) or not coalesce(public.current_user_has_permission('employees.view'),false) then raise exception 'Attendance access required' using errcode='42501';end if;
  if not public.attendance_client_access(p_cutoff->>'clientId',true) then raise exception 'Client outside assigned edit access' using errcode='42501';end if;
  if jsonb_typeof(p_edits) is distinct from 'array' or jsonb_array_length(p_edits) not between 1 and 3100 or length(btrim(p_reference)) not between 1 and 1000 then raise exception 'Provide 1 to 3100 changes and an attendance reference' using errcode='23514';end if;
  if (p_cutoff->>'end')::date<(p_cutoff->>'start')::date or (p_cutoff->>'end')::date-(p_cutoff->>'start')::date>30 then raise exception 'Invalid cutoff' using errcode='23514';end if;
  if (select count(distinct value->>'employeeId') from jsonb_array_elements(p_edits))>100 or (select count(distinct (value->>'employeeId',value->>'workDate')) from jsonb_array_elements(p_edits))<>jsonb_array_length(p_edits) then raise exception 'Duplicate days or more than 100 employees' using errcode='23514';end if;
  perform attendance_private.lock_writers(tenant);
  for item in select value from jsonb_array_elements(p_edits) order by value->>'employeeId',value->>'workDate' loop
    if (item->>'workDate')::date not between (p_cutoff->>'start')::date and (p_cutoff->>'end')::date or (item->>'workDate')::date>(now() at time zone 'Asia/Manila')::date then raise exception 'Attendance outside cutoff or in the future' using errcode='23514';end if;
    select data into employee_data from public.hr_records where tenant_id=tenant and module='employees' and record_id=item->>'employeeId' for update;
    if employee_data is null or not coalesce(public.current_user_scope_allows(item->>'employeeId',employee_data),false) then raise exception 'Employee outside access scope' using errcode='42501';end if;
    context:=attendance_private.day_context(item->>'employeeId',(item->>'workDate')::date);
    if context->>'ready' is distinct from 'true' or context->'assignment'->>'clientId' is distinct from p_cutoff->>'clientId' or context->'assignment'->>'branchReporting' is distinct from p_cutoff->>'branch' then raise exception 'Review dated assignment and calendar' using errcode='23514';end if;
    if context->>'hash' is distinct from item->>'sourceHash' then raise exception 'Schedule/calendar changed; reload and review' using errcode='40001';end if;
    select * into previous from public.hr_records where tenant_id=tenant and module='attendance' and data->>'employeeId'=item->>'employeeId' and data->>'workDate'=item->>'workDate' for update;
    if previous.record_id is not null and not public.attendance_client_access(coalesce(previous.data->>'clientId',''),true) then raise exception 'Existing attendance outside assigned client access' using errcode='42501';end if;
    if coalesce(md5(previous.data::text),'') is distinct from item->>'expectedHash' then raise exception 'Attendance changed; reload before saving' using errcode='40001';end if;
    if not coalesce(public.current_user_has_permission(case when previous.record_id is null then 'attendance.create' else 'attendance.update' end),false) or not coalesce(public.current_user_scope_allows(coalesce(previous.record_id,item->>'employeeId'),coalesce(previous.data,context->'assignment')||jsonb_build_object('employeeId',item->>'employeeId')),false) then raise exception 'Attendance write outside permission or scope' using errcode='42501';end if;
    transaction_name:=item->>'transaction';actual:=coalesce(item->'segments','[]');classification:=case when context->>'holiday' in ('ordinary','special_working') then case when context->>'restDay'='true' then 'rest_day' else 'ordinary' end else context->>'holiday'||case when context->>'restDay'='true' then '_rest_day' else '' end end;
    expected:=case transaction_name when 'Present' then 'ordinary' when 'Rest-day Duty' then 'rest_day' when 'Special Non-working Holiday Duty' then 'special_non_working' when 'Regular Holiday Duty' then 'regular_holiday' when 'Double Regular Holiday Duty' then 'double_regular_holiday' when 'Special Non-working Holiday + Rest-day Duty' then 'special_non_working_rest_day' when 'Regular Holiday + Rest-day Duty' then 'regular_holiday_rest_day' when 'Double Regular Holiday + Rest-day Duty' then 'double_regular_holiday_rest_day' else null end;
    if expected is not null and expected<>classification then raise exception 'Duty classification conflicts with reviewed calendar/schedule' using errcode='23514';end if;
    if expected is not null or transaction_name='Late/Undertime' then
      status:='Present';metrics:=attendance_private.metrics(context->'segments',actual);
    else
      if transaction_name not in ('Absent','Paid Leave','Unpaid Leave','Day-off','Holiday (Unworked)','AWOL/AWOP') then raise exception 'Unknown transaction' using errcode='23514';end if;
      if transaction_name='Holiday (Unworked)' and context->>'holiday' in ('ordinary','special_working') then raise exception 'Not a non-working holiday' using errcode='23514';end if;
      if actual<>'[]'::jsonb or transaction_name='Day-off' and context->>'restDay'<>'true' then raise exception 'Invalid non-working duty selection' using errcode='23514';end if;
      status:=case when transaction_name in ('Paid Leave','Unpaid Leave') then 'Approved Leave' when transaction_name in ('Day-off','Holiday (Unworked)') then 'Rest Day / Holiday' else 'Absent' end;
      metrics:=jsonb_build_object('scheduledMinutes',attendance_private.minutes(context->'segments'),'workedMinutes',0,'lateMinutes',0,'undertimeMinutes',0);
    end if;
    -- Serialize existing dependency/assignment writers through ordinary hr_records triggers; never disable them.
    for part in select value from jsonb_array_elements(actual) loop
      span_a:=extract(epoch from (item->>'workDate')::date)/60+(part->>'start')::integer;span_b:=extract(epoch from (item->>'workDate')::date)/60+(part->>'end')::integer;
      if exists(select 1 from public.hr_records r cross join lateral jsonb_array_elements(coalesce(r.data->'segments','[]')) s where r.tenant_id=tenant and r.module='attendance' and r.data->>'employeeId'=item->>'employeeId' and r.data->>'workDate'<>item->>'workDate' and (r.data->>'workDate')::date between (item->>'workDate')::date-1 and (item->>'workDate')::date+1 and extract(epoch from (r.data->>'workDate')::date)/60+(s->>'start')::integer<span_b and extract(epoch from (r.data->>'workDate')::date)/60+(s->>'end')::integer>span_a) then raise exception 'Duty overlaps an adjacent attendance date' using errcode='23514';end if;
    end loop;
    record_identifier:=coalesce(previous.record_id,gen_random_uuid()::text);
    select state into review_state from attendance_private.review_registry where tenant_id=tenant and employee_id=item->>'employeeId' and work_date=(item->>'workDate')::date;
    insert into attendance_private.write_intents values(txid_current(),tenant,item->>'employeeId',(item->>'workDate')::date) on conflict do nothing;
    saved:=coalesce(previous.data,'{}')||metrics||jsonb_build_object('id',record_identifier,'employeeId',item->>'employeeId','workDate',item->>'workDate','status',status,'transaction',transaction_name,'segments',actual,'leaveTreatment',case transaction_name when 'Paid Leave' then 'Paid' when 'Unpaid Leave' then 'Unpaid' else '' end,'absenceClassification',case when transaction_name='AWOL/AWOP' then 'Unauthorized' when status='Absent' then 'Pending Validation' else '' end,'factor','Unknown / Not Disclosed','remarks',p_reference,'reviewState',coalesce(previous.data->>'reviewState','Draft'),'clientId',p_cutoff->>'clientId','preparation',context,'updatedAt',clock_timestamp(),'updatedBy',auth.uid(),'updatedByName',(select full_name from public.profiles where id=auth.uid()),'_dataResetAt',coalesce((select data->>'dataResetAt' from public.hr_settings where tenant_id=tenant and id='singleton'),''));
    if previous.record_id is null then saved:=saved||jsonb_build_object('createdAt',now(),'createdBy',auth.uid(),'createdByName',(select full_name from public.profiles where id=auth.uid()));end if;
    saved:=saved||jsonb_build_object('factor',coalesce(previous.data->>'factor','Unknown / Not Disclosed'));
    saved:=saved||jsonb_build_object('reviewState',coalesce(review_state,'Draft'));
    insert into public.hr_records(tenant_id,module,record_id,data,updated_at,updated_by) values(tenant,'attendance',record_identifier,saved,clock_timestamp(),auth.uid()) on conflict(module,record_id) do update set data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
    insert into attendance_private.record_history(tenant_id,record_id,previous_data,next_data,actor) values(tenant,record_identifier,previous.data,saved,auth.uid());
    insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),'Attendance preparation',format('Attendance %s employee %s date %s; %s; prior hash %s',record_identifier,item->>'employeeId',item->>'workDate',transaction_name,coalesce(md5(previous.data::text),'')));
    delete from attendance_private.write_intents where tx=txid_current() and tenant_id=tenant and employee_id=item->>'employeeId' and work_date=(item->>'workDate')::date;
    count_saved:=count_saved+1;
  end loop;
  return jsonb_build_object('saved',count_saved);
end;$$;

create function public.review_prepared_attendance(p_employee text,p_date date,p_hash text,p_state text) returns void language plpgsql security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();r public.hr_records;reviewed jsonb;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.manage'),false) or p_state not in ('Draft','Approved') then raise exception 'Attendance review permission/state required' using errcode='42501';end if;
  perform attendance_private.lock_writers(tenant);
  select * into r from public.hr_records where tenant_id=tenant and module='attendance' and data->>'employeeId'=p_employee and data->>'workDate'=p_date::text for update;
  if r.record_id is null or not coalesce(public.current_user_scope_allows(r.record_id,r.data),false) then raise exception 'Attendance outside scope' using errcode='42501';end if;
  if not public.attendance_client_access(coalesce(r.data->>'clientId',''),true) then raise exception 'Client outside assigned review access' using errcode='42501';end if;
  if md5(r.data::text) is distinct from p_hash then raise exception 'Attendance changed; reload' using errcode='40001';end if;
  insert into attendance_private.write_intents values(txid_current(),tenant,p_employee,p_date);
  update public.hr_records set data=data||jsonb_build_object('reviewState',p_state,'reviewedBy',auth.uid(),'reviewedAt',clock_timestamp()),updated_at=clock_timestamp(),updated_by=auth.uid() where module='attendance' and record_id=r.record_id returning data into reviewed;
  insert into attendance_private.review_registry(tenant_id,employee_id,work_date,state,actor) values(tenant,p_employee,p_date,p_state,auth.uid()) on conflict(tenant_id,employee_id,work_date) do update set state=excluded.state,actor=excluded.actor,at=clock_timestamp();
  insert into attendance_private.record_history(tenant_id,record_id,previous_data,next_data,actor) values(tenant,r.record_id,r.data,reviewed,auth.uid());
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),'Attendance reviewer',format('Attendance review %s: %s',r.record_id,p_state));
  delete from attendance_private.write_intents where tx=txid_current() and tenant_id=tenant and employee_id=p_employee and work_date=p_date;
end;$$;
create function public.review_attendance_matrix(p_items jsonb,p_state text) returns void language plpgsql security definer set search_path=public as $$
declare item jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 3100 then raise exception 'Select 1 to 3100 records' using errcode='23514';end if;
  for item in select value from jsonb_array_elements(p_items) order by value->>'employeeId',value->>'workDate' loop perform public.review_prepared_attendance(item->>'employeeId',(item->>'workDate')::date,item->>'hash',p_state);end loop;
end;$$;
create function public.query_attendance_entitlement_evidence(p_employee text,p_date date,p_days integer default 31) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();e jsonb;result jsonb;
begin
  select data into e from public.hr_records where tenant_id=tenant and module='employees' and record_id=p_employee;
  if auth.uid() is null or not coalesce(public.current_user_has_permission('attendance.view'),false) or not coalesce(public.current_user_has_permission('employees.view'),false) or e is null or not coalesce(public.current_user_scope_allows(p_employee,e),false) then raise exception 'Evidence outside access scope' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('employeeId',p_employee,'clientId',c->'assignment'->>'clientId','date',d::date,'holiday',c->>'holiday','restDay',c->'restDay','calendarReviewed',c->>'ready'='true','scheduleReviewed',c->>'ready'='true','scheduleVersion',c->'snapshot'->'assignment','calendarVersion',c->'snapshot'->'holidays','attendance',r.data||jsonb_build_object('version',md5(r.data::text),'reviewState',coalesce(v.state,'Draft'))) order by d),'[]') into result
  from generate_series(p_date-least(greatest(p_days,1),366),p_date-1,'1 day'::interval) d
  cross join lateral (select attendance_private.day_context(p_employee,d::date) c) ctx
  left join public.hr_records r on r.tenant_id=tenant and r.module='attendance' and r.data->>'employeeId'=p_employee and r.data->>'workDate'=(d::date)::text
    and public.current_user_scope_allows(r.record_id,r.data) and public.attendance_client_access(coalesce(r.data->>'clientId',''),false)
  left join attendance_private.review_registry v on v.tenant_id=tenant and v.employee_id=p_employee and v.work_date=d::date
  where c->>'ready'='true';
  return result;
end;$$;
-- Trusted integration only. No browser-controlled posting flag or unlock operation exists.
create function public.register_attendance_posting_lock(p_tenant uuid,p_employee text,p_date date,p_reference text) returns void language plpgsql security definer set search_path=public as $$
begin
  if length(btrim(p_reference)) not between 1 and 200 then raise exception 'Posting reference required';end if;
  perform attendance_private.lock_writers(p_tenant);
  perform 1 from public.hr_records where tenant_id=p_tenant and module='employees' and record_id=p_employee for update;
  if not exists(select 1 from public.hr_records r join attendance_private.review_registry v on v.tenant_id=r.tenant_id and v.employee_id=r.data->>'employeeId' and v.work_date=(r.data->>'workDate')::date where r.tenant_id=p_tenant and r.module='attendance' and r.data->>'employeeId'=p_employee and r.data->>'workDate'=p_date::text and v.state='Approved') then raise exception 'Approved attendance required';end if;
  insert into attendance_private.posting_locks(tenant_id,employee_id,work_date,external_reference) values(p_tenant,p_employee,p_date,p_reference);
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(p_tenant,null,'Trusted payroll integration',format('Attendance posting lock: employee %s date %s reference %s',p_employee,p_date,p_reference));
end;$$;

-- Registered, unreviewed configuration, not an automatic runtime fallback or employer coverage determination.
insert into public.hr_attendance_configuration(tenant_id,kind,identity_key,data)
select id,'statutory','dole-handbook-2024-baseline',jsonb_build_object('reviewed',false,'effectiveFrom','2026-10-14','reference','https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf; pp. 2, 16-22; employer applicability review required',
'worked',jsonb_build_object('ordinary',10000,'rest_day',13000,'special_non_working',13000,'special_non_working_rest_day',15000,'regular_holiday',20000,'regular_holiday_rest_day',26000,'double_regular_holiday',30000,'double_regular_holiday_rest_day',39000),
'unworked',jsonb_build_object('ordinary',0,'rest_day',0,'special_non_working',0,'special_non_working_rest_day',0,'regular_holiday',10000,'regular_holiday_rest_day',10000,'double_regular_holiday',20000,'double_regular_holiday_rest_day',20000)) from public.hr_tenants;

revoke all on all functions in schema attendance_private from public,anon,authenticated;
revoke all on all tables in schema attendance_private from public,anon,authenticated;
revoke all on function public.save_attendance_configuration(uuid,text,text,integer,jsonb),public.query_attendance_matrix(jsonb,text,text,text,integer,integer),public.save_attendance_matrix(jsonb,jsonb,text),public.review_prepared_attendance(text,date,text,text),public.register_attendance_posting_lock(uuid,text,date,text) from public,anon,authenticated;
grant execute on function public.save_attendance_configuration(uuid,text,text,integer,jsonb),public.query_attendance_matrix(jsonb,text,text,text,integer,integer),public.save_attendance_matrix(jsonb,jsonb,text),public.review_prepared_attendance(text,date,text,text) to authenticated;
grant execute on function public.register_attendance_posting_lock(uuid,text,date,text) to service_role;
revoke all on function public.attendance_preparation_options() from public,anon;
grant execute on function public.attendance_preparation_options() to authenticated;
revoke all on function public.review_attendance_matrix(jsonb,text),public.query_attendance_entitlement_evidence(text,date,integer) from public,anon;
grant execute on function public.review_attendance_matrix(jsonb,text),public.query_attendance_entitlement_evidence(text,date,integer) to authenticated;
commit;
