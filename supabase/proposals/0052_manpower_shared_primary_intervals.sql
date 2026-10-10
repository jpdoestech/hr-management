-- Gated transfer prerequisite. No public transfer mutation or legacy conversion.
begin;
set local lock_timeout='5s';
set local search_path=public,extensions;
create table manpower_private.primary_intervals (
  tenant_id uuid not null references public.hr_tenants(id),source_kind text not null check(source_kind in ('reservation','operational')),
  source_id uuid not null,employee_id text not null,actual_date date not null,ended_date date,
  primary key(tenant_id,source_kind,source_id),
  check(isfinite(actual_date) and (ended_date is null or (isfinite(ended_date) and ended_date>actual_date))),
  exclude using gist(tenant_id with =,employee_id with =,(daterange(actual_date,ended_date,'[)')) with &&)
);
alter table manpower_private.primary_intervals enable row level security;
revoke all on manpower_private.primary_intervals from public,anon,authenticated;
create table manpower_private.operational_intents (
  transaction_id bigint not null,tenant_id uuid not null,source_id uuid not null,
  before_row jsonb,after_row jsonb not null,primary key(transaction_id,tenant_id,source_id)
);
alter table manpower_private.operational_intents enable row level security;
revoke all on manpower_private.operational_intents from public,anon,authenticated;

create table public.hr_manpower_operational_deployments (
  tenant_id uuid not null references public.hr_tenants(id),id uuid not null default gen_random_uuid(),employee_id text not null,candidate_id text,
  origin_kind text not null check(origin_kind in ('reservation','operational')),origin_id uuid not null,
  client_id uuid,branch_reporting text not null check(length(branch_reporting) between 1 and 60),
  department text not null check(length(department) between 1 and 60),position text not null check(length(position) between 1 and 80),
  state text not null default 'Deployed' check(state in ('Deployed','Ended')),
  actual_date date not null,ended_date date,
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  audit_id uuid not null references public.hr_audit_logs(id),end_audit_id uuid references public.hr_audit_logs(id),end_reason text,
  primary key(tenant_id,id),foreign key(tenant_id,client_id) references public.hr_manpower_clients(tenant_id,id),
  check((state='Deployed' and ended_date is null and end_audit_id is null and end_reason is null)
    or (state='Ended' and ended_date is not null and end_audit_id is not null and end_reason is not null and length(btrim(end_reason)) between 1 and 1000))
);
alter table public.hr_manpower_operational_deployments enable row level security;
revoke all on public.hr_manpower_operational_deployments from public,anon,authenticated;
grant select on public.hr_manpower_operational_deployments to authenticated;
create policy manpower_operational_read on public.hr_manpower_operational_deployments for select to authenticated using(
  tenant_id=public.current_tenant_id() and public.current_user_has_permission('employees.view') and public.current_user_has_permission('manpower.view')
  and public.current_user_scope_allows(id::text,jsonb_build_object('department',department,'branchReporting',branch_reporting))
  and exists(select 1 from public.hr_records e where e.tenant_id=hr_manpower_operational_deployments.tenant_id
    and e.module='employees' and e.record_id=hr_manpower_operational_deployments.employee_id and public.current_user_scope_allows(e.record_id,e.data)));

create function public.guard_manpower_operational_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare catalogs jsonb;source_employee text;source_candidate text;source_end date;
begin
  if tg_op='DELETE' then raise exception 'Operational deployment history cannot be deleted' using errcode='23514';end if;
  perform manpower_private.lock_source_snapshot(new.tenant_id);
  if not exists(select 1 from manpower_private.operational_intents intent where intent.transaction_id=txid_current()
    and intent.tenant_id=new.tenant_id and intent.source_id=new.id and intent.after_row=to_jsonb(new)
    and ((tg_op='INSERT' and intent.before_row is null) or (tg_op='UPDATE' and intent.before_row=to_jsonb(old)))) then
    raise exception 'Operational deployments require an exact controlled transaction' using errcode='23514';end if;
  if tg_op='UPDATE' then
    if old.state<>'Deployed' or new.state<>'Ended'
      or (to_jsonb(old)-array['state','ended_date','end_audit_id','end_reason'])<>(to_jsonb(new)-array['state','ended_date','end_audit_id','end_reason']) then
      raise exception 'Only a genuine operational ending is supported; original facts remain immutable' using errcode='23514';end if;
    if not exists(select 1 from public.hr_audit_logs where id=new.end_audit_id and tenant_id=new.tenant_id and user_id=auth.uid()) then
      raise exception 'Operational ending requires current actor audit evidence' using errcode='23514';end if;
    return new;
  end if;
  if new.state<>'Deployed' then raise exception 'New operational transfers must be confirmed deployments' using errcode='23514';end if;
  if new.created_by is distinct from auth.uid() or not exists(select 1 from public.hr_audit_logs
    where id=new.audit_id and tenant_id=new.tenant_id and user_id=new.created_by) then
    raise exception 'Operational transfer requires matching actor audit evidence' using errcode='23514';end if;
  if new.origin_kind='reservation' then
    select employee_id,candidate_id,ended_date into source_employee,source_candidate,source_end from public.hr_manpower_reservations
      where tenant_id=new.tenant_id and id=new.origin_id and state='Ended';
  else
    select employee_id,candidate_id,ended_date into source_employee,source_candidate,source_end from public.hr_manpower_operational_deployments
      where tenant_id=new.tenant_id and id=new.origin_id and state='Ended';
  end if;
  if source_employee is distinct from new.employee_id or source_candidate is distinct from new.candidate_id or source_end is distinct from new.actual_date then
    raise exception 'Operational transfer must retain the source worker and start on its first unassigned day' using errcode='23514';end if;
  if not exists(select 1 from public.hr_records where tenant_id=new.tenant_id and module='employees' and record_id=new.employee_id and data->>'id'=new.employee_id) then
    raise exception 'Operational employee requires reconciliation' using errcode='23514';end if;
  select data into catalogs from public.hr_settings where tenant_id=new.tenant_id and id='singleton' for share;
  if not exists(select 1 from jsonb_array_elements_text(coalesce(catalogs->'branchLocations','[]')) value where value=new.branch_reporting)
    or not exists(select 1 from jsonb_array_elements(coalesce(catalogs->'departments','[]')) value where value->>'name'=new.department and value->>'active'='true')
    or not exists(select 1 from jsonb_array_elements(coalesce(catalogs->'positions','[]')) value where value->>'name'=new.position and value->>'department'=new.department and value->>'active'='true')
    or (new.client_id is not null and not exists(select 1 from public.hr_manpower_clients where tenant_id=new.tenant_id and id=new.client_id and active)) then
    raise exception 'Select active operational destination catalog values' using errcode='23514';end if;
  if exists(select 1 from public.hr_manpower_reservations where tenant_id=new.tenant_id and employee_id=new.employee_id and state in ('Reserved','Scheduled','Deployed')) then
    raise exception 'Resolve existing effective reservations before an operational transfer' using errcode='23514';end if;
  return new;
end $$;
create trigger manpower_operational_00_change_guard before insert or update or delete on public.hr_manpower_operational_deployments
  for each row execute function public.guard_manpower_operational_change();
create trigger manpower_operational_dates_guard before insert or update on public.hr_manpower_operational_deployments
  for each row execute function public.guard_manpower_deployment_dates();
revoke all on function public.guard_manpower_operational_change() from public,anon,authenticated;

create function public.sync_manpower_primary_interval() returns trigger
language plpgsql security definer set search_path=public as $$
declare kind text:=case when tg_table_name='hr_manpower_reservations' then 'reservation' else 'operational' end;
begin
  if tg_op<>'INSERT' then delete from manpower_private.primary_intervals where tenant_id=old.tenant_id and source_kind=kind and source_id=old.id;end if;
  if tg_op<>'DELETE' and new.state in ('Deployed','Ended') then
    insert into manpower_private.primary_intervals values(new.tenant_id,kind,new.id,new.employee_id,new.actual_date,new.ended_date);
  end if;
  return null;
end $$;
revoke all on function public.sync_manpower_primary_interval() from public,anon,authenticated;
lock table public.hr_manpower_reservations in share row exclusive mode;
insert into manpower_private.primary_intervals select tenant_id,'reservation',id,employee_id,actual_date,ended_date
  from public.hr_manpower_reservations where state in ('Deployed','Ended');
create trigger manpower_shared_primary_interval after insert or update or delete on public.hr_manpower_reservations
  for each row execute function public.sync_manpower_primary_interval();
create trigger manpower_shared_primary_interval after insert or update or delete on public.hr_manpower_operational_deployments
  for each row execute function public.sync_manpower_primary_interval();

create function public.guard_manpower_operational_reservation() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  perform manpower_private.lock_source_snapshot(new.tenant_id);
  if new.state in ('Reserved','Scheduled') and exists(select 1 from manpower_private.primary_intervals
    where tenant_id=new.tenant_id and employee_id=new.employee_id and source_kind='operational' and ended_date is null) then
    raise exception 'End or atomically transfer the active operational assignment before reserving this worker' using errcode='23514';end if;
  return new;
end $$;
create trigger manpower_operational_reservation_guard before insert or update on public.hr_manpower_reservations
  for each row execute function public.guard_manpower_operational_reservation();
revoke all on function public.guard_manpower_operational_reservation() from public,anon,authenticated;

create function public.guard_manpower_operational_source() returns trigger
language plpgsql security definer set search_path=public as $$
declare source public.hr_records;
begin
  if tg_op='DELETE' then source:=old;else source:=new;end if;
  if source.module in ('employees','onboardingCandidates') or (tg_op='UPDATE' and old.module in ('employees','onboardingCandidates')) then
    if tg_op='UPDATE' then source:=old;end if;
    if exists(select 1 from public.hr_manpower_operational_deployments where tenant_id=source.tenant_id and state='Deployed'
      and ((source.module='employees' and employee_id=source.record_id) or (source.module='onboardingCandidates' and candidate_id=source.record_id))) then
      if tg_op='DELETE' or (tg_op='UPDATE' and ((new.tenant_id,new.module,new.record_id) is distinct from (old.tenant_id,old.module,old.record_id)
        or jsonb_build_array(new.data->'id',new.data->'name',new.data->'lastName',new.data->'firstName',new.data->'middleName',new.data->'employeeRecordId',new.data->'sourceCandidateId')
          is distinct from jsonb_build_array(old.data->'id',old.data->'name',old.data->'lastName',old.data->'firstName',old.data->'middleName',old.data->'employeeRecordId',old.data->'sourceCandidateId'))) then
        raise exception 'Resolve operational assignment identity before changing this source' using errcode='23514';end if;
    end if;
  end if;
  if tg_op<>'DELETE' and new.module in ('oncall','manpowerSlots') and exists(select 1 from public.hr_manpower_operational_deployments o
    join public.hr_records e on e.tenant_id=o.tenant_id and e.module='employees' and e.record_id=o.employee_id
    where o.tenant_id=new.tenant_id and o.state='Deployed' and (o.employee_id=new.data->>'employeeId' or o.candidate_id=new.data->>'candidateId'
      or (new.module='oncall' and public.manpower_identity_name_key(e.data)=public.manpower_identity_name_key(jsonb_build_object('name',new.data->>'employeeName'))))) then
    raise exception 'Resolve the active operational deployment before a legacy assignment write' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger manpower_01_operational_source_guard before insert or update or delete on public.hr_records
  for each row execute function public.guard_manpower_operational_source();
revoke all on function public.guard_manpower_operational_source() from public,anon,authenticated;
commit;
