-- Gated deployment ending. Retains historical fulfillment and employment status.
begin;
set local lock_timeout='5s';
do $$ begin
  if to_regprocedure('manpower_private.lock_source_snapshot(uuid)') is null
    or to_regclass('public.hr_manpower_confirmation_history') is null
    or not exists(select 1 from pg_constraint where conrelid='public.hr_manpower_reservations'::regclass
      and conname='manpower_primary_deployment_no_overlap')
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_manpower_reservations'::regclass
      and tgname='manpower_deployment_dates_guard' and tgenabled='O') then
    raise exception 'Verified source interlock, confirmation and deployment interval guards are required';end if;
end $$;
create table manpower_private.ending_batches (
  tenant_id uuid not null references public.hr_tenants(id),actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),payload jsonb not null,
  audit_id uuid not null references public.hr_audit_logs(id),created_at timestamptz not null default now(),
  primary key(tenant_id,actor_id,token)
);
create table public.hr_manpower_ending_history (
  tenant_id uuid not null,reservation_id uuid not null,actor_id uuid not null,batch_token text not null,
  actual_date date not null,ended_date date not null,confirmation_audit_id uuid not null references public.hr_audit_logs(id),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  audit_id uuid not null references public.hr_audit_logs(id),recorded_at timestamptz not null default now(),
  primary key(tenant_id,reservation_id),check(isfinite(actual_date) and isfinite(ended_date) and ended_date>actual_date),
  foreign key(tenant_id,reservation_id) references public.hr_manpower_reservations(tenant_id,id),
  foreign key(tenant_id,actor_id,batch_token) references manpower_private.ending_batches(tenant_id,actor_id,token)
);
alter table manpower_private.ending_batches enable row level security;
alter table public.hr_manpower_ending_history enable row level security;
revoke all on manpower_private.ending_batches,public.hr_manpower_ending_history from public,anon,authenticated;
grant select on public.hr_manpower_ending_history to authenticated;
create policy manpower_ending_history_read on public.hr_manpower_ending_history for select to authenticated using(
  tenant_id=public.current_tenant_id() and public.current_user_has_permission('employees.view')
  and public.current_user_has_permission('onboarding.view') and public.current_user_has_permission('manpower.view')
  and exists(select 1 from public.hr_manpower_reservations r
    join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.id=r.line_id
    join public.hr_records e on e.tenant_id=r.tenant_id and e.module='employees' and e.record_id=r.employee_id
    join public.hr_records c on c.tenant_id=r.tenant_id and c.module='onboardingCandidates' and c.record_id=r.candidate_id
    where r.tenant_id=hr_manpower_ending_history.tenant_id and r.id=hr_manpower_ending_history.reservation_id
      and public.can_read_manpower_draft(l.request_id) and public.current_user_scope_allows(e.record_id,e.data)
      and public.current_user_scope_allows(c.record_id,c.data)));
create trigger manpower_ending_batch_guard before update or delete on manpower_private.ending_batches
  for each row execute function public.guard_manpower_reservation_batch();
create trigger manpower_ending_history_guard before update or delete on public.hr_manpower_ending_history
  for each row execute function public.guard_manpower_submitted_record();

create function public.end_manpower_deployments(p_token text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;payload jsonb;retry jsonb;item jsonb;ids jsonb;
  request_id text;key text;previous public.hr_manpower_reservations;saved public.hr_manpower_reservations;
  candidate jsonb;employee jsonb;audit_event uuid;today date:=(now() at time zone 'Asia/Manila')::date;
begin
  perform manpower_private.lock_source_snapshot(tenant);
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('employees.view'),false)
    or not coalesce(public.current_user_has_permission('onboarding.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Deployment ending outside your access' using errcode='42501';end if;
  if p_token is null or length(p_token) not between 1 and 100 or btrim(p_token)=''
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'An ending token and deployment selections are required' using errcode='23514';end if;
  if jsonb_array_length(p_items)=0 or exists(select 1 from jsonb_array_elements(p_items) value
    where jsonb_typeof(value) is distinct from 'object'
      or jsonb_typeof(value->'reservation_id') is distinct from 'string'
      or coalesce(value->>'reservation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(value->'confirmation_audit_id') is distinct from 'string'
      or coalesce(value->>'confirmation_audit_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(value->'actual_date') is distinct from 'string'
      or coalesce(value->>'actual_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(value->'ended_date') is distinct from 'string'
      or coalesce(value->>'ended_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(value->'reason') is distinct from 'string'
      or length(btrim(coalesce(value->>'reason',''))) not between 1 and 1000
      or value-array['reservation_id','confirmation_audit_id','actual_date','ended_date','reason']<>'{}'::jsonb) then
    raise exception 'Each deployment needs its saved confirmation, start, first unassigned day and reason' using errcode='23514';end if;
  begin
    select jsonb_agg(jsonb_build_object('reservation_id',(value->>'reservation_id')::uuid,
      'confirmation_audit_id',(value->>'confirmation_audit_id')::uuid,'actual_date',(value->>'actual_date')::date,
      'ended_date',(value->>'ended_date')::date,'reason',btrim(value->>'reason')) order by (value->>'reservation_id')::uuid)
      into payload from jsonb_array_elements(p_items) value;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Use valid ISO deployment dates' using errcode='23514';
  end;
  if (select count(distinct value->>'reservation_id') from jsonb_array_elements(payload) value)<>jsonb_array_length(payload)
    or exists(select 1 from jsonb_array_elements(payload) value where (value->>'ended_date')::date>today
      or (value->>'ended_date')::date<=(value->>'actual_date')::date) then
    raise exception 'Select each deployment once; first unassigned day must follow start and cannot be future' using errcode='23514';end if;
  select batch.payload into retry from manpower_private.ending_batches batch where batch.tenant_id=tenant and batch.actor_id=auth.uid() and batch.token=p_token;
  if retry is not null and retry<>payload then raise exception 'Ending token was used for different facts' using errcode='23514';end if;
  for request_id in select distinct l.request_id from jsonb_array_elements(payload) value
    join public.hr_manpower_reservations r on r.tenant_id=tenant and r.id=(value->>'reservation_id')::uuid
    join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.id=r.line_id order by l.request_id loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
    perform 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  end loop;
  for key in select distinct r.candidate_id from jsonb_array_elements(payload) value
    join public.hr_manpower_reservations r on r.tenant_id=tenant and r.id=(value->>'reservation_id')::uuid order by r.candidate_id loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':identity:'||key,0));end loop;
  for key in select distinct r.worker_key from jsonb_array_elements(payload) value
    join public.hr_manpower_reservations r on r.tenant_id=tenant and r.id=(value->>'reservation_id')::uuid order by r.worker_key loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:'||key,0));end loop;
  for item in select value from jsonb_array_elements(payload) value loop
    select * into previous from public.hr_manpower_reservations where tenant_id=tenant and id=(item->>'reservation_id')::uuid for update;
    if not found then raise exception 'Deployment unavailable or outside your access' using errcode='42501';end if;
    select l.request_id into request_id from public.hr_manpower_lines l where l.tenant_id=tenant and l.id=previous.line_id;
    select data into candidate from public.hr_records where tenant_id=tenant and module='onboardingCandidates' and record_id=previous.candidate_id for share;
    select data into employee from public.hr_records where tenant_id=tenant and module='employees' and record_id=previous.employee_id for share;
    if candidate is null or employee is null or not coalesce(public.can_read_manpower_draft(request_id),false)
      or not coalesce(public.current_user_scope_allows(previous.candidate_id,candidate),false)
      or not coalesce(public.current_user_scope_allows(previous.employee_id,employee),false) then
      raise exception 'Deployment sources outside your access' using errcode='42501';end if;
    if retry is not null then continue;end if;
    if previous.state<>'Deployed' then raise exception 'Only an active confirmed deployment can end' using errcode='23514';end if;
    if previous.actual_date is distinct from (item->>'actual_date')::date
      or previous.confirmation_audit_id is distinct from (item->>'confirmation_audit_id')::uuid then
      raise exception 'Deployment changed. Reload before ending.' using errcode='40001';end if;
    if candidate->>'id' is distinct from previous.candidate_id or employee->>'id' is distinct from previous.employee_id then
      raise exception 'Reconcile source identity before ending this deployment' using errcode='23514';end if;
    if exists(select 1 from public.hr_records where tenant_id=tenant and module='manpowerSlots'
      and (data->>'requestId'=request_id or data->>'candidateId'=previous.candidate_id or data->>'employeeId'=previous.employee_id))
      or exists(select 1 from public.hr_records where tenant_id=tenant and module='oncall'
        and (data->>'candidateId'=previous.candidate_id or data->>'employeeId'=previous.employee_id
          or public.manpower_identity_name_key(jsonb_build_object('name',data->>'employeeName'))=public.manpower_identity_name_key(employee))) then
      raise exception 'Reconcile legacy or on-call assignments before ending this deployment' using errcode='23514';end if;
    perform public.manpower_line_capacity(previous.line_id);
    if audit_event is null then
      insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
        format('Deployments ended: batch %s, %s worker(s)',p_token,jsonb_array_length(payload))) returning id into audit_event;
      insert into manpower_private.ending_batches(tenant_id,actor_id,token,payload,audit_id) values(tenant,auth.uid(),p_token,payload,audit_event);
    end if;
    saved:=previous;saved.state:='Ended';saved.ended_date:=(item->>'ended_date')::date;
    insert into public.hr_manpower_reservation_intents values(txid_current(),tenant,previous.id,to_jsonb(previous),to_jsonb(saved));
    update public.hr_manpower_reservations set state=saved.state,ended_date=saved.ended_date where tenant_id=tenant and id=previous.id;
    insert into public.hr_manpower_ending_history(tenant_id,reservation_id,actor_id,batch_token,actual_date,ended_date,confirmation_audit_id,reason,audit_id)
      values(tenant,previous.id,auth.uid(),p_token,previous.actual_date,saved.ended_date,previous.confirmation_audit_id,item->>'reason',audit_event);
    delete from public.hr_manpower_reservation_intents where transaction_id=txid_current() and tenant_id=tenant and reservation_id=previous.id;
    perform public.manpower_line_capacity(previous.line_id);
  end loop;
  select jsonb_agg(value->>'reservation_id' order by value->>'reservation_id') into ids from jsonb_array_elements(payload) value;
  return jsonb_build_object('reservation_ids',ids,'replayed',retry is not null);
end $$;
revoke all on function public.end_manpower_deployments(text,jsonb) from public,anon;
grant execute on function public.end_manpower_deployments(text,jsonb) to authenticated;
commit;
