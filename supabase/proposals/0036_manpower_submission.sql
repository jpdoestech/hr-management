-- Stage A5 proposal: deploy only after the 0035 registry gate is verified.
-- Does not submit/backfill any existing request or enable application buttons.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_manpower_requests,public.hr_manpower_lines in share row exclusive mode;
do $$
declare constraint_name text;
begin
  if to_regclass('public.hr_manpower_prf_registry') is null
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_manpower_requests'::regclass and tgname='manpower_prf_number_guard' and tgenabled='O')
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_records'::regclass and tgname='manpower_prf_number_guard' and tgenabled='O') then
    raise exception 'Verified cross-model PRF registry is required before submission';
  end if;
  if exists(select 1 from public.hr_manpower_requests where state<>'Draft')
    or exists(select 1 from public.hr_manpower_lines where original_requested is not null) then
    raise exception 'Unexpected submitted baseline; review schema compatibility before applying';
  end if;
  select conname into strict constraint_name from pg_constraint
    where conrelid='public.hr_manpower_lines'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%original_requested IS NULL%';
  execute format('alter table public.hr_manpower_lines drop constraint %I',constraint_name);
end;
$$;
alter table public.hr_manpower_requests drop constraint hr_manpower_requests_state_check;
alter table public.hr_manpower_requests add constraint hr_manpower_requests_state_check check(state in ('Draft','Open'));
alter table public.hr_manpower_requests add column submitted_at timestamptz;
alter table public.hr_manpower_requests add column submitted_by uuid references auth.users(id);
alter table public.hr_manpower_requests add constraint hr_manpower_submission_metadata check(
  (state='Draft' and submitted_at is null and submitted_by is null)
  or (state='Open' and submitted_at is not null and submitted_by is not null));

-- Typed quantity facts reference the existing critical audit event, not a second timeline.
create table public.hr_manpower_quantity_history (
  tenant_id uuid not null,
  line_id text not null,
  event_type text not null check(event_type='Submitted'),
  original_requested integer not null check(original_requested>0),
  current_authorized integer not null check(current_authorized>0),
  cancelled_unfilled integer not null default 0 check(cancelled_unfilled=0),
  request_revision bigint not null check(request_revision>0),
  audit_id uuid not null references public.hr_audit_logs(id),
  check(original_requested=current_authorized),
  primary key(tenant_id,line_id,event_type),
  foreign key(tenant_id,line_id) references public.hr_manpower_lines(tenant_id,id)
);
alter table public.hr_manpower_quantity_history enable row level security;
revoke all on public.hr_manpower_quantity_history from public,anon,authenticated;
grant select on public.hr_manpower_quantity_history to authenticated;
create policy hr_manpower_quantity_history_read on public.hr_manpower_quantity_history for select to authenticated
  using(tenant_id=public.current_tenant_id() and exists(
    select 1 from public.hr_manpower_lines line where line.tenant_id=hr_manpower_quantity_history.tenant_id
      and line.id=hr_manpower_quantity_history.line_id and public.can_read_manpower_draft(line.request_id)));

create function public.guard_manpower_submitted_record() returns trigger
language plpgsql security definer set search_path=public as $$
declare parent_state text;
begin
  if tg_table_name='hr_manpower_requests' then
    if old.state<>'Draft' then
      raise exception 'Submitted requests require a controlled amendment transaction' using errcode='23514';
    end if;
  elsif tg_table_name='hr_manpower_lines' then
    select state into parent_state from public.hr_manpower_requests
      where tenant_id=case when tg_op='INSERT' then new.tenant_id else old.tenant_id end
        and id=case when tg_op='INSERT' then new.request_id else old.request_id end for update;
    if parent_state is distinct from 'Draft' then
      raise exception 'Submitted requisition lines cannot be replaced or deleted' using errcode='23514';
    end if;
    if tg_op='UPDATE' and (new.tenant_id,new.id,new.request_id) is distinct from (old.tenant_id,old.id,old.request_id) then
      raise exception 'Requisition line identity cannot be changed' using errcode='23514';
    end if;
    if tg_op='UPDATE' and old.original_requested is not null and new.original_requested is distinct from old.original_requested then
      raise exception 'Original submitted headcount is immutable' using errcode='23514';
    end if;
  else
    raise exception 'Quantity history is append-only' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
create trigger manpower_submitted_record_guard before update or delete on public.hr_manpower_requests
  for each row execute function public.guard_manpower_submitted_record();
create trigger manpower_submitted_record_guard before insert or update or delete on public.hr_manpower_lines
  for each row execute function public.guard_manpower_submitted_record();
create trigger manpower_quantity_history_guard before update or delete on public.hr_manpower_quantity_history
  for each row execute function public.guard_manpower_submitted_record();
revoke all on function public.guard_manpower_submitted_record() from public,anon,authenticated;

create function public.submit_manpower_request(p_id text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  active_tenant uuid:=public.current_tenant_id();
  actor public.profiles;
  previous public.hr_manpower_requests;
  saved public.hr_manpower_requests;
  header jsonb;
  lines jsonb;
  audit_event uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or active_tenant is null or actor.tenant_id is distinct from active_tenant
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Manpower submission access denied' using errcode='42501';
  end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<1 then
    raise exception 'A saved draft and revision are required' using errcode='23514';
  end if;
  -- Same serialization key/order as draft saves; recheck revision under the lock.
  perform pg_advisory_xact_lock(hashtextextended(active_tenant::text||':draft:'||p_id,0));
  select * into previous from public.hr_manpower_requests where tenant_id=active_tenant and id=p_id for update;
  if not found or not public.can_read_manpower_draft(p_id) then
    raise exception 'Request is unavailable or outside your scope' using errcode='42501';
  end if;
  if previous.revision<>p_expected_revision then raise exception 'Draft changed. Reload before submitting.' using errcode='40001';end if;
  if previous.state<>'Draft' then raise exception 'Only a draft can be submitted' using errcode='23514';end if;
  if previous.normalized_prf='' or previous.client_id is null or previous.branch_reporting=''
    or previous.requested_by='' or previous.date_requested is null or previous.target_date is null then
    raise exception 'Complete PRF number, client, branch, requested by and request/target dates' using errcode='23514';
  end if;
  perform 1 from public.hr_manpower_clients where tenant_id=active_tenant and id=previous.client_id and active for share;
  if not found then raise exception 'Select an active Client Account before submitting' using errcode='23514';end if;
  perform 1 from public.hr_manpower_lines where tenant_id=active_tenant and request_id=p_id for update;
  if not found or exists(select 1 from public.hr_manpower_lines where tenant_id=active_tenant and request_id=p_id
    and (department='' or position='' or current_authorized is null)) then
    raise exception 'At least one complete requisition line with positive headcount is required' using errcode='23514';
  end if;
  -- Reuse authoritative draft catalog/date/scope checks; revalidation is transactional.
  header:=to_jsonb(previous)-array['state','revision','submitted_at','submitted_by'];
  select jsonb_agg(to_jsonb(line)-array['original_requested','cancelled_unfilled'] order by ordinal)
    into lines from public.hr_manpower_lines line where tenant_id=active_tenant and request_id=p_id;
  perform public.save_manpower_draft(p_id,p_expected_revision,header,lines);
  update public.hr_manpower_lines set original_requested=current_authorized
    where tenant_id=active_tenant and request_id=p_id;
  update public.hr_manpower_requests set state='Open',submitted_at=now(),submitted_by=auth.uid()
    where tenant_id=active_tenant and id=p_id returning * into saved;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(active_tenant,auth.uid(),coalesce(actor.full_name,'HR user'),format('Manpower request submitted [%s], revision %s',p_id,saved.revision))
    returning id into audit_event;
  insert into public.hr_manpower_quantity_history(tenant_id,line_id,event_type,original_requested,current_authorized,request_revision,audit_id)
    select tenant_id,id,'Submitted',original_requested,current_authorized,saved.revision,audit_event
    from public.hr_manpower_lines where tenant_id=active_tenant and request_id=p_id;
  return jsonb_build_object('request',to_jsonb(saved),'lines',coalesce((select jsonb_agg(to_jsonb(line) order by ordinal)
    from public.hr_manpower_lines line where tenant_id=active_tenant and request_id=p_id),'[]'::jsonb));
end;
$$;
revoke all on function public.submit_manpower_request(text,bigint) from public,anon;
grant execute on function public.submit_manpower_request(text,bigint) to authenticated;
comment on table public.hr_manpower_quantity_history is 'Immutable initial submitted quantities linked to the existing audit timeline. Amendments/cancellation remain gated.';
commit;
