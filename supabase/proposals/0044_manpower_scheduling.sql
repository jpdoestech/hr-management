-- Gated planning transactions. Scheduling is not actual deployment or fulfillment.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_manpower_reservations in share row exclusive mode;
do $$ begin
  if to_regclass('public.hr_manpower_reservation_intents') is null
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_manpower_reservations'::regclass
      and tgname='manpower_reservation_change_guard' and tgenabled='O') then
    raise exception 'Verified reservation ledger and transition guards are required';
  end if;
end $$;
alter table public.hr_manpower_reservations add column schedule_revision bigint not null default 0 check(schedule_revision>=0);
create table public.hr_manpower_schedule_history (
  tenant_id uuid not null,
  reservation_id uuid not null,
  schedule_revision bigint not null check(schedule_revision>0),
  previous_state text not null check(previous_state in ('Reserved','Scheduled')),
  current_state text not null check(current_state in ('Reserved','Scheduled')),
  previous_date date,
  scheduled_date date,
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  audit_id uuid not null references public.hr_audit_logs(id),
  primary key(tenant_id,reservation_id,schedule_revision),
  foreign key(tenant_id,reservation_id) references public.hr_manpower_reservations(tenant_id,id),
  check(previous_date is distinct from scheduled_date),
  check((current_state='Reserved' and scheduled_date is null) or (current_state='Scheduled' and scheduled_date is not null))
);
alter table public.hr_manpower_schedule_history enable row level security;
revoke all on public.hr_manpower_schedule_history from public,anon,authenticated;
grant select on public.hr_manpower_schedule_history to authenticated;
create policy manpower_schedule_history_read on public.hr_manpower_schedule_history for select to authenticated
  using(tenant_id=public.current_tenant_id() and exists(select 1 from public.hr_manpower_reservations reservation
    where reservation.tenant_id=hr_manpower_schedule_history.tenant_id and reservation.id=hr_manpower_schedule_history.reservation_id));
create trigger manpower_schedule_history_guard before update or delete on public.hr_manpower_schedule_history
  for each row execute function public.guard_manpower_submitted_record();

create function public.schedule_manpower_reservation(p_id uuid,p_expected_revision bigint,p_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;
  previous public.hr_manpower_reservations;saved public.hr_manpower_reservations;
  request_id text;request_state text;candidate jsonb;employee jsonb;audit_event uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or tenant is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('onboarding.update'),false)
    or not coalesce(public.current_user_has_permission('onboarding.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false) then
    raise exception 'Reservation scheduling access denied' using errcode='42501';end if;
  if p_expected_revision is null or p_expected_revision<0 or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A saved schedule revision and reason (1-1000 characters) are required' using errcode='23514';end if;
  if p_date is not null and (not isfinite(p_date) or p_date<(now() at time zone 'Asia/Manila')::date) then
    raise exception 'A new planning date cannot be in the past; historical dates require reconciliation' using errcode='23514';end if;
  select * into previous from public.hr_manpower_reservations where tenant_id=tenant and id=p_id;
  if not found then raise exception 'Reservation unavailable' using errcode='42501';end if;
  select line.request_id into request_id from public.hr_manpower_lines line where line.tenant_id=tenant and line.id=previous.line_id;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
  select state into request_state from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':identity:'||previous.candidate_id,0));
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:'||previous.worker_key,0));
  select * into previous from public.hr_manpower_reservations where tenant_id=tenant and id=p_id for update;
  select data into candidate from public.hr_records where tenant_id=tenant and module='onboardingCandidates' and record_id=previous.candidate_id for share;
  if candidate is null or not coalesce(public.current_user_scope_allows(previous.candidate_id,candidate),false)
    or not coalesce(public.can_read_manpower_draft(request_id),false) then
    raise exception 'Reservation outside your access' using errcode='42501';end if;
  if previous.employee_id is not null then
    select data into employee from public.hr_records where tenant_id=tenant and module='employees' and record_id=previous.employee_id for share;
    if employee is null or not coalesce(public.current_user_has_permission('employees.view'),false)
      or not coalesce(public.current_user_scope_allows(previous.employee_id,employee),false) then
      raise exception 'Resolved employee outside your access' using errcode='42501';end if;
  end if;
  if request_state is distinct from 'Open' or previous.state not in ('Reserved','Scheduled') then
    raise exception 'Only an unconfirmed reservation on an open request can be scheduled' using errcode='23514';end if;
  if previous.schedule_revision<>p_expected_revision then
    raise exception 'Schedule changed. Reload before changing the plan.' using errcode='40001';end if;
  if previous.scheduled_date is not distinct from p_date then
    raise exception 'The planning date has not changed' using errcode='23514';end if;
  if candidate->>'stage' in ('Rejected','Withdrawn') or candidate->>'recommendation'='Reject' then
    raise exception 'Applicant is no longer eligible; resolve the reservation before scheduling' using errcode='23514';end if;
  perform public.manpower_line_capacity(previous.line_id);
  saved:=previous;saved.state:=case when p_date is null then 'Reserved' else 'Scheduled' end;
  saved.scheduled_date:=p_date;saved.schedule_revision:=previous.schedule_revision+1;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
      format('Reservation schedule changed [%s], revision %s: %s -> %s. Reason: %s',p_id,saved.schedule_revision,
        coalesce(previous.scheduled_date::text,'Not scheduled'),coalesce(p_date::text,'Not scheduled'),btrim(p_reason))) returning id into audit_event;
  insert into public.hr_manpower_reservation_intents values(txid_current(),tenant,p_id,to_jsonb(previous),to_jsonb(saved));
  update public.hr_manpower_reservations set state=saved.state,scheduled_date=saved.scheduled_date,schedule_revision=saved.schedule_revision
    where tenant_id=tenant and id=p_id;
  insert into public.hr_manpower_schedule_history values(tenant,p_id,saved.schedule_revision,previous.state,saved.state,
    previous.scheduled_date,p_date,btrim(p_reason),audit_event);
  delete from public.hr_manpower_reservation_intents where transaction_id=txid_current() and tenant_id=tenant and reservation_id=p_id;
  return jsonb_build_object('reservation_id',p_id,'state',saved.state,'scheduled_date',p_date,'schedule_revision',saved.schedule_revision);
end $$;
revoke all on function public.schedule_manpower_reservation(uuid,bigint,date,text) from public,anon;
grant execute on function public.schedule_manpower_reservation(uuid,bigint,date,text) to authenticated;
commit;
