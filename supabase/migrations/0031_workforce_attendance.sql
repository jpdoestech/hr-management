-- Attendance uses the existing tenant-scoped record, RBAC and audit architecture.
begin;

insert into public.access_permissions(permission_key,module_key,action_key,label)
select 'attendance.'||action,'attendance',action,'Attendance '||action
from unnest(array['view','create','update','delete','export','manage']) action
on conflict(permission_key) do nothing;

insert into public.access_role_permissions(role_id,permission_key)
select role.id,permission.permission_key
from public.access_roles role cross join public.access_permissions permission
where permission.module_key='attendance'
  and (role.system_key in ('Administrator','HR Staff') or (role.system_key='Viewer' and permission.action_key='view'))
on conflict do nothing;

create or replace function public.hr_record_permission_key(p_module text,p_action text)
returns text language sql immutable as $$
  select (case
    when p_module='employees' then 'employees'
    when p_module='attendance' then 'attendance'
    when p_module='onboardingCandidates' then 'onboarding'
    when p_module='leaves' then 'leave'
    when p_module in ('evaluations','transfers','lifecycleChecklists') then 'lifecycle'
    when p_module in ('prf','manpowerRequests','manpowerRequirements','manpowerSlots','oncall') then 'manpower'
    when p_module in ('disciplinary','nte','memos','nod','offenseCatalog','cvr','incidents','atd') then 'employee_relations'
    when p_module='documents' then 'documents'
    when p_module='workflowTasks' then 'workflow'
    when p_module='automationRuns' then 'automation'
    else 'employees'
  end)||'.'||p_action;
$$;

create unique index if not exists hr_records_attendance_employee_date_idx
on public.hr_records(tenant_id,(data->>'employeeId'),(data->>'workDate'))
where module='attendance';
create index if not exists hr_records_attendance_date_idx
on public.hr_records(tenant_id,(data->>'workDate') desc) where module='attendance';

create or replace function public.validate_workforce_attendance()
returns trigger language plpgsql set search_path=public as $$
declare
  field text;
  scheduled integer;
  late integer;
  undertime integer;
  employee_data jsonb;
begin
  if new.module<>'attendance' then return new; end if;
  select data into employee_data from public.hr_records
  where module='employees' and record_id=new.data->>'employeeId' and tenant_id=new.tenant_id;
  if employee_data is null then raise exception 'Select an existing employee' using errcode='23514'; end if;
  if coalesce(new.data->>'workDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Enter a valid attendance date' using errcode='23514';
  end if;
  perform (new.data->>'workDate')::date;
  if coalesce(new.data->>'status','') not in ('Present','Absent','Approved Leave','Rest Day / Holiday') then
    raise exception 'Invalid attendance status' using errcode='23514';
  end if;
  foreach field in array array['scheduledMinutes','lateMinutes','undertimeMinutes'] loop
    if coalesce(new.data->>field,'') !~ '^[0-9]{1,4}$' then
      raise exception 'Attendance minutes must be whole non-negative numbers' using errcode='23514';
    end if;
  end loop;
  scheduled:=(new.data->>'scheduledMinutes')::integer;
  late:=(new.data->>'lateMinutes')::integer;
  undertime:=(new.data->>'undertimeMinutes')::integer;
  if scheduled>1440 or (new.data->>'status'<>'Rest Day / Holiday' and scheduled=0) or late+undertime>scheduled then
    raise exception 'Invalid scheduled or lost minutes' using errcode='23514';
  end if;
  if new.data->>'status'<>'Present' and late+undertime>0 then
    raise exception 'Late and undertime apply only to present records' using errcode='23514';
  end if;
  if new.data->>'status'='Absent' and coalesce(new.data->>'absenceClassification','') not in ('Authorized','Unauthorized','Pending Validation') then
    raise exception 'Classify the absence' using errcode='23514';
  end if;
  if coalesce(new.data->>'factor','') not in ('Compensation / Benefits','Career Development','Workload / Schedule','Management / Workplace','Health / Medical','Family / Personal','Transport / Location','Attendance / Conduct','Contract / Assignment End','Retirement','Other','Unknown / Not Disclosed') then
    raise exception 'Select a valid attendance factor' using errcode='23514';
  end if;
  new.data:=new.data||jsonb_build_object('employeeName',employee_data->>'name','department',employee_data->>'department','branchReporting',employee_data->>'branchReporting');
  return new;
end;
$$;
drop trigger if exists hr_records_workforce_attendance on public.hr_records;
create trigger hr_records_workforce_attendance before insert or update on public.hr_records
for each row execute function public.validate_workforce_attendance();
create or replace function public.query_attendance_dashboard(
  p_start date,p_end date,p_department text default '',p_branch text default '',
  p_status text default '',p_search text default '',p_offset integer default 0,p_limit integer default 10
)
returns jsonb language sql stable security invoker set search_path=public as $$
with filtered as materialized (
  select record_id,data from public.hr_records
  where module='attendance' and public.current_user_has_permission('attendance.view')
    and data->>'workDate' between p_start::text and p_end::text
    and (p_department='' or data->>'department'=p_department)
    and (p_branch='' or data->>'branchReporting'=p_branch)
    and (p_status='' or data->>'status'=p_status)
    and (p_search='' or strpos(lower(concat_ws(' ',data->>'employeeName',data->>'department',data->>'branchReporting',data->>'factor',data->>'absenceClassification')),lower(p_search))>0)
), totals as (
  select count(*) filter(where data->>'status'<>'Rest Day / Holiday') scheduled,
    count(*) filter(where data->>'status'='Present') present,
    count(*) filter(where data->>'status'='Absent') absent,
    count(*) filter(where data->>'status'='Approved Leave') leave,
    count(*) filter(where data->>'status'='Absent' and data->>'absenceClassification'='Unauthorized') unauthorized,
    count(*) filter(where data->>'status'='Present' and (data->>'lateMinutes')::integer>0) late,
    count(*) filter(where data->>'status'='Present' and (data->>'undertimeMinutes')::integer>0) undertime,
    coalesce(sum((data->>'scheduledMinutes')::integer) filter(where data->>'status'<>'Rest Day / Holiday'),0) scheduled_minutes,
    coalesce(sum(case when data->>'status'='Absent' then (data->>'scheduledMinutes')::integer
      when data->>'status'='Present' then (data->>'lateMinutes')::integer+(data->>'undertimeMinutes')::integer else 0 end),0) lost_minutes
  from filtered
), page as (
  select data from filtered order by data->>'workDate' desc,record_id
  offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)
), absence_groups as (
  select data->>'absenceClassification' "absenceClassification",count(*) count
  from filtered where data->>'status'='Absent' group by data->>'absenceClassification'
), factor_groups as (
  select data->>'factor' factor,count(*) count from filtered
  where data->>'status'='Absent' or (data->>'lateMinutes')::integer>0 or (data->>'undertimeMinutes')::integer>0
  group by data->>'factor'
)
select jsonb_build_object(
  'total',(select count(*) from filtered),'records',coalesce((select jsonb_agg(data) from page),'[]'::jsonb),
  'absenceGroups',coalesce((select jsonb_agg(to_jsonb(absence_groups)) from absence_groups),'[]'::jsonb),
  'factorGroups',coalesce((select jsonb_agg(to_jsonb(factor_groups)) from factor_groups),'[]'::jsonb),
  'metrics',jsonb_build_object('scheduled',scheduled,'present',present,'absent',absent,'leave',leave,
    'late',late,'undertime',undertime,'unauthorized',unauthorized,'scheduledMinutes',scheduled_minutes,'lostMinutes',lost_minutes,
    'attendanceRate',round(present*100.0/nullif(scheduled,0),1),'absenceRate',round(absent*100.0/nullif(scheduled,0),1),
    'lateRate',round(late*100.0/nullif(present,0),1),'undertimeRate',round(undertime*100.0/nullif(present,0),1),
    'lostTimeRate',round(lost_minutes*100.0/nullif(scheduled_minutes,0),1))
) from totals;
$$;
revoke all on function public.query_attendance_dashboard(date,date,text,text,text,text,integer,integer) from public;
grant execute on function public.query_attendance_dashboard(date,date,text,text,text,text,integer,integer) to authenticated;
commit;
