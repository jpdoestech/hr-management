-- Gated standalone operational ending. No PRF credit or employee-master changes.
begin;
set local lock_timeout='5s';
create table manpower_private.operational_ending_batches (
  tenant_id uuid not null references public.hr_tenants(id),actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),payload jsonb not null,
  audit_id uuid not null references public.hr_audit_logs(id),created_at timestamptz not null default now(),
  primary key(tenant_id,actor_id,token)
);
create table public.hr_manpower_operational_ending_history (
  tenant_id uuid not null,deployment_id uuid not null,actor_id uuid not null,batch_token text not null,
  actual_date date not null,ended_date date not null,reason text not null check(length(btrim(reason)) between 1 and 1000),
  audit_id uuid not null references public.hr_audit_logs(id),recorded_at timestamptz not null default now(),
  primary key(tenant_id,deployment_id),check(isfinite(actual_date) and isfinite(ended_date) and ended_date>actual_date),
  foreign key(tenant_id,deployment_id) references public.hr_manpower_operational_deployments(tenant_id,id),
  foreign key(tenant_id,actor_id,batch_token) references manpower_private.operational_ending_batches(tenant_id,actor_id,token)
);
alter table manpower_private.operational_ending_batches enable row level security;
alter table public.hr_manpower_operational_ending_history enable row level security;
revoke all on manpower_private.operational_ending_batches,public.hr_manpower_operational_ending_history from public,anon,authenticated;
grant select on public.hr_manpower_operational_ending_history to authenticated;
create policy manpower_operational_ending_read on public.hr_manpower_operational_ending_history for select to authenticated using(
  tenant_id=public.current_tenant_id() and public.can_read_manpower_primary('operational',deployment_id));
create trigger manpower_operational_ending_batch_guard before update or delete on manpower_private.operational_ending_batches
  for each row execute function public.guard_manpower_reservation_batch();
create trigger manpower_operational_ending_history_guard before update or delete on public.hr_manpower_operational_ending_history
  for each row execute function public.guard_manpower_submitted_record();

create function public.end_manpower_operational_deployments(p_token text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;payload jsonb;retry jsonb;item jsonb;key text;
  previous public.hr_manpower_operational_deployments;saved public.hr_manpower_operational_deployments;
  employee jsonb;audit_event uuid;
begin
  perform manpower_private.lock_source_snapshot(tenant);
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('employees.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Operational ending outside your access' using errcode='42501';end if;
  if p_token is null or length(p_token) not between 1 and 100 or btrim(p_token)=''
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Provide an ending token and selected operational deployments' using errcode='23514';end if;
  if jsonb_array_length(p_items)=0 or exists(select 1 from jsonb_array_elements(p_items) value where
    jsonb_typeof(value) is distinct from 'object'
    or jsonb_typeof(value->'deployment_id') is distinct from 'string'
    or coalesce(value->>'deployment_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(value->'source_fingerprint') is distinct from 'string'
    or coalesce(value->>'source_fingerprint','') !~ '^[0-9a-f]{32}$'
    or jsonb_typeof(value->'ended_date') is distinct from 'string'
    or coalesce(value->>'ended_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(value->'reason') is distinct from 'string'
    or length(btrim(coalesce(value->>'reason',''))) not between 1 and 1000
    or value-array['deployment_id','source_fingerprint','ended_date','reason']<>'{}'::jsonb) then
    raise exception 'Each selection needs its saved preview, first unassigned day and reason' using errcode='23514';end if;
  begin
    select jsonb_agg(jsonb_build_object('deployment_id',(value->>'deployment_id')::uuid,
      'source_fingerprint',value->>'source_fingerprint','ended_date',(value->>'ended_date')::date,'reason',btrim(value->>'reason'))
      order by (value->>'deployment_id')::uuid) into payload from jsonb_array_elements(p_items) value;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Use valid ISO ending dates' using errcode='23514';end;
  if (select count(distinct value->>'deployment_id') from jsonb_array_elements(payload) value)<>jsonb_array_length(payload)
    or exists(select 1 from jsonb_array_elements(payload) value where (value->>'ended_date')::date>(now() at time zone 'Asia/Manila')::date) then
    raise exception 'Select each deployment once; ending cannot be future' using errcode='23514';end if;
  select b.payload into retry from manpower_private.operational_ending_batches b where b.tenant_id=tenant and b.actor_id=auth.uid() and b.token=p_token;
  if retry is not null and retry<>payload then raise exception 'Ending token was used for different facts' using errcode='23514';end if;
  for key in select distinct o.employee_id from jsonb_array_elements(payload) value
    join public.hr_manpower_operational_deployments o on o.tenant_id=tenant and o.id=(value->>'deployment_id')::uuid order by o.employee_id loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:employee:'||key,0));end loop;
  for item in select value from jsonb_array_elements(payload) value loop
    if not coalesce(public.can_read_manpower_primary('operational',(item->>'deployment_id')::uuid),false) then
      raise exception 'Operational deployment outside your access' using errcode='42501';end if;
    select * into previous from public.hr_manpower_operational_deployments where tenant_id=tenant and id=(item->>'deployment_id')::uuid for update;
    if retry is not null then continue;end if;
    if md5(to_jsonb(previous)::text) is distinct from item->>'source_fingerprint' then
      raise exception 'Deployment changed. Reload its preview before ending.' using errcode='40001';end if;
    if previous.state<>'Deployed' or (item->>'ended_date')::date<=previous.actual_date then
      raise exception 'Only an active deployment can end after its start' using errcode='23514';end if;
    select data into employee from public.hr_records where tenant_id=tenant and module='employees' and record_id=previous.employee_id for share;
    if employee->>'id' is distinct from previous.employee_id then raise exception 'Reconcile the worker identity before ending' using errcode='23514';end if;
    if exists(select 1 from public.hr_records where tenant_id=tenant and module in ('manpowerSlots','oncall') and
      (data->>'employeeId'=previous.employee_id or data->>'candidateId'=previous.candidate_id
        or (module='oncall' and public.manpower_identity_name_key(jsonb_build_object('name',data->>'employeeName'))=public.manpower_identity_name_key(employee)))) then
      raise exception 'Reconcile legacy or on-call dependencies before ending' using errcode='23514';end if;
    if audit_event is null then
      insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
        format('Operational deployments ended: batch %s, %s worker(s)',p_token,jsonb_array_length(payload))) returning id into audit_event;
      insert into manpower_private.operational_ending_batches(tenant_id,actor_id,token,payload,audit_id) values(tenant,auth.uid(),p_token,payload,audit_event);
    end if;
    saved:=previous;saved.state:='Ended';saved.ended_date:=(item->>'ended_date')::date;saved.end_audit_id:=audit_event;saved.end_reason:=item->>'reason';
    insert into manpower_private.operational_intents values(txid_current(),tenant,previous.id,to_jsonb(previous),to_jsonb(saved));
    update public.hr_manpower_operational_deployments set state=saved.state,ended_date=saved.ended_date,end_audit_id=audit_event,end_reason=saved.end_reason where tenant_id=tenant and id=previous.id;
    insert into public.hr_manpower_operational_ending_history(tenant_id,deployment_id,actor_id,batch_token,actual_date,ended_date,reason,audit_id)
      values(tenant,previous.id,auth.uid(),p_token,previous.actual_date,saved.ended_date,saved.end_reason,audit_event);
    delete from manpower_private.operational_intents where transaction_id=txid_current() and tenant_id=tenant and source_id=previous.id;
  end loop;
  return jsonb_build_object('deployment_ids',(select jsonb_agg(value->>'deployment_id' order by value->>'deployment_id') from jsonb_array_elements(payload) value),'replayed',retry is not null);
end $$;
revoke all on function public.end_manpower_operational_deployments(text,jsonb) from public,anon;
grant execute on function public.end_manpower_operational_deployments(text,jsonb) to authenticated;
commit;
