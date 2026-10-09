-- Gated follow-on to 0041; no production backfill or mutation UI enablement.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_manpower_requests,public.hr_manpower_lines in share row exclusive mode;
do $$ begin
  if to_regprocedure('public.amend_manpower_quantity(text,text,bigint,integer,text)') is null
    or not exists(select 1 from pg_constraint where conrelid='public.hr_manpower_requests'::regclass
      and conname='hr_manpower_submission_metadata' and contype='c'
      and pg_get_constraintdef(oid)=$definition$CHECK ((((state = 'Draft'::text) AND (submitted_at IS NULL) AND (submitted_by IS NULL)) OR ((state = 'Open'::text) AND (submitted_at IS NOT NULL) AND (submitted_by IS NOT NULL))))$definition$)
    or not exists(select 1 from pg_constraint where conrelid='public.hr_manpower_requests'::regclass
      and conname='hr_manpower_requests_state_check' and contype='c'
      and pg_get_constraintdef(oid)=$definition$CHECK ((state = ANY (ARRAY['Draft'::text, 'Open'::text])))$definition$) then
    raise exception 'Verified quantity amendment and submission foundations are required';
  end if;
end $$;
alter table public.hr_manpower_requests drop constraint hr_manpower_requests_state_check;
alter table public.hr_manpower_requests add constraint hr_manpower_requests_state_check
  check(state in ('Draft','Open','Closed','Cancelled'));
alter table public.hr_manpower_requests drop constraint hr_manpower_submission_metadata;
alter table public.hr_manpower_requests add constraint hr_manpower_submission_metadata check(
  (state='Draft' and submitted_at is null and submitted_by is null)
  or (state in ('Open','Closed','Cancelled') and submitted_at is not null and submitted_by is not null));

create table public.hr_manpower_lifecycle_history (
  tenant_id uuid not null,
  request_id text not null,
  request_revision bigint not null check(request_revision>0),
  operation text not null check(operation in ('CancelLine','Close','Cancel','Reopen')),
  previous_state text not null check(previous_state in ('Open','Closed','Cancelled')),
  current_state text not null check(current_state in ('Open','Closed','Cancelled')),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  line_changes jsonb not null check(jsonb_typeof(line_changes)='array'),
  audit_id uuid not null references public.hr_audit_logs(id),
  primary key(tenant_id,request_id,request_revision),
  foreign key(tenant_id,request_id) references public.hr_manpower_requests(tenant_id,id)
);
alter table public.hr_manpower_lifecycle_history enable row level security;
revoke all on public.hr_manpower_lifecycle_history from public,anon,authenticated;
grant select on public.hr_manpower_lifecycle_history to authenticated;
create policy manpower_lifecycle_history_read on public.hr_manpower_lifecycle_history for select to authenticated
  using(tenant_id=public.current_tenant_id() and public.can_read_manpower_draft(request_id));
create trigger manpower_lifecycle_history_guard before update or delete on public.hr_manpower_lifecycle_history
  for each row execute function public.guard_manpower_submitted_record();

create function public.change_manpower_lifecycle(p_id text,p_expected_revision bigint,p_operation text,p_reason text,
  p_line_id text default null,p_cancel_quantity integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;
  previous public.hr_manpower_requests;saved public.hr_manpower_requests;
  line public.hr_manpower_lines;changed_line public.hr_manpower_lines;
  capacity jsonb;cancel_quantity integer;changes jsonb:='[]'::jsonb;audit_event uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or tenant is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Manpower lifecycle access denied' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision<1 or p_operation is null
    or p_operation not in ('CancelLine','Close','Cancel','Reopen') or p_reason is null
    or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A saved revision, lifecycle operation and reason (1-1000 characters) are required' using errcode='23514';
  end if;
  if (p_operation='CancelLine' and (p_line_id is null or btrim(p_line_id)='' or p_cancel_quantity is null or p_cancel_quantity<1))
    or (p_operation<>'CancelLine' and (p_line_id is not null or p_cancel_quantity is not null)) then
    raise exception 'Only line cancellation accepts a line and positive cancelled quantity' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||p_id,0));
  select * into previous from public.hr_manpower_requests where tenant_id=tenant and id=p_id for update;
  if not found or not coalesce(public.can_read_manpower_draft(p_id),false) then
    raise exception 'Request unavailable or outside your scope' using errcode='42501';end if;
  if previous.revision<>p_expected_revision then
    raise exception 'Request changed. Reload before changing lifecycle.' using errcode='40001';end if;
  if (p_operation='Reopen' and previous.state not in ('Closed','Cancelled'))
    or (p_operation<>'Reopen' and previous.state<>'Open') then
    raise exception 'Lifecycle operation is not valid for the current request state' using errcode='23514';end if;
  if p_operation='CancelLine' and not exists(select 1 from public.hr_manpower_lines
    where tenant_id=tenant and request_id=p_id and id=p_line_id) then
    raise exception 'Requisition line unavailable' using errcode='42501';end if;
  saved:=previous;saved.revision:=previous.revision+1;saved.updated_at:=now();saved.updated_by:=auth.uid();
  saved.state:=case p_operation when 'Close' then 'Closed' when 'Cancel' then 'Cancelled' when 'Reopen' then 'Open' else 'Open' end;
  for line in select * from public.hr_manpower_lines where tenant_id=tenant and request_id=p_id
    and (p_operation<>'CancelLine' or id=p_line_id) order by id for update loop
    capacity:=public.manpower_line_capacity(line.id);
    if p_operation<>'Reopen' and (capacity->>'reserved')::bigint>0 then
      raise exception 'Release or reassign all reservations on affected lines before cancellation or closure' using errcode='23514';
    end if;
    if p_operation='Reopen' then continue;end if;
    cancel_quantity:=case when p_operation='CancelLine' then p_cancel_quantity else (capacity->>'available')::integer end;
    if cancel_quantity>(capacity->>'available')::bigint then
      raise exception 'Cancellation exceeds outstanding unfilled demand' using errcode='23514';end if;
    if cancel_quantity=0 then continue;end if;
    changed_line:=line;changed_line.cancelled_unfilled:=line.cancelled_unfilled+cancel_quantity;
    insert into public.hr_manpower_amendment_intents values(txid_current(),tenant,p_id,line.id,
      to_jsonb(previous),to_jsonb(saved),to_jsonb(line),to_jsonb(changed_line));
    update public.hr_manpower_lines set cancelled_unfilled=changed_line.cancelled_unfilled where tenant_id=tenant and id=line.id;
    delete from public.hr_manpower_amendment_intents where transaction_id=txid_current() and tenant_id=tenant and request_id=p_id;
    changes:=changes||jsonb_build_array(jsonb_build_object('line_id',line.id,'previous_cancelled',line.cancelled_unfilled,
      'current_cancelled',changed_line.cancelled_unfilled,'current_authorized',line.current_authorized,
      'original_requested',line.original_requested,'fulfilled',(capacity->>'fulfilled')::bigint));
  end loop;
  -- Header-only exact intent: line quantities have already been updated atomically above.
  select * into line from public.hr_manpower_lines where tenant_id=tenant and request_id=p_id order by id limit 1;
  if not found then raise exception 'Submitted request has no lines; reconcile before lifecycle changes' using errcode='23514';end if;
  insert into public.hr_manpower_amendment_intents values(txid_current(),tenant,p_id,line.id,
    to_jsonb(previous),to_jsonb(saved),to_jsonb(line),to_jsonb(line));
  update public.hr_manpower_requests set state=saved.state,revision=saved.revision,updated_at=saved.updated_at,updated_by=saved.updated_by
    where tenant_id=tenant and id=p_id;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
      format('Manpower lifecycle %s [%s], revision %s: %s -> %s. Reason: %s',p_operation,p_id,saved.revision,
        previous.state,saved.state,btrim(p_reason))) returning id into audit_event;
  insert into public.hr_manpower_lifecycle_history values(tenant,p_id,saved.revision,p_operation,previous.state,saved.state,
    btrim(p_reason),changes,audit_event);
  delete from public.hr_manpower_amendment_intents where transaction_id=txid_current() and tenant_id=tenant and request_id=p_id;
  return jsonb_build_object('request',to_jsonb(saved),'line_changes',changes);
end $$;
revoke all on function public.change_manpower_lifecycle(text,bigint,text,text,text,integer) from public,anon;
grant execute on function public.change_manpower_lifecycle(text,bigint,text,text,text,integer) to authenticated;
commit;
