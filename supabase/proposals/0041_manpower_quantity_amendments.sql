-- Gated follow-on to 0037/0040. No UI enablement or legacy commitment backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_manpower_requests,public.hr_manpower_lines,
  public.hr_manpower_quantity_amendments in share row exclusive mode;
do $$ begin
  if to_regprocedure('public.manpower_line_capacity(text)') is null
    or to_regclass('public.hr_manpower_reservation_intents') is null
    or not exists(select 1 from pg_constraint where conrelid='public.hr_manpower_quantity_amendments'::regclass
      and conname='hr_manpower_quantity_amendments_check' and contype='c'
      and pg_get_constraintdef(oid)='CHECK ((current_authorized > previous_authorized))')
    or not exists(select 1 from pg_constraint where conrelid='public.hr_manpower_lines'::regclass
      and conname='hr_manpower_lines_cancelled_unfilled_check' and contype='c'
      and pg_get_constraintdef(oid)='CHECK ((cancelled_unfilled = 0))') then
    raise exception 'Verified reservation accounting and expected amendment constraint are required';
  end if;
end $$;

-- Preserve every existing increase fact; allow positive, genuinely changed decreases too.
alter table public.hr_manpower_quantity_amendments
  drop constraint hr_manpower_quantity_amendments_check,
  add constraint hr_manpower_quantity_amendments_check
    check(current_authorized>0 and current_authorized<>previous_authorized);

-- Cancellation remains a separate, future controlled transaction, never an amendment side effect.
alter table public.hr_manpower_lines
  drop constraint hr_manpower_lines_cancelled_unfilled_check,
  add constraint hr_manpower_lines_cancelled_unfilled_check
    check(cancelled_unfilled>=0 and cancelled_unfilled<=coalesce(current_authorized,0));

-- Private implementation keeps the increase-only check inside the same transaction/locks.
create function public.amend_manpower_quantity_internal(p_id text,p_line_id text,p_expected_revision bigint,
  p_quantity integer,p_reason text,p_increase_only boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  active_tenant uuid:=public.current_tenant_id();
  actor public.profiles;
  previous public.hr_manpower_requests;
  saved public.hr_manpower_requests;
  previous_line public.hr_manpower_lines;
  saved_line public.hr_manpower_lines;
  capacity jsonb;
  audit_event uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or active_tenant is null or actor.tenant_id is distinct from active_tenant
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Manpower amendment access denied' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision<1 or p_quantity is null or p_quantity<1
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A saved revision, positive quantity and reason (1-1000 characters) are required' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(active_tenant::text||':draft:'||p_id,0));
  select * into previous from public.hr_manpower_requests where tenant_id=active_tenant and id=p_id for update;
  if not found or not coalesce(public.can_read_manpower_draft(p_id),false) then
    raise exception 'Request is unavailable or outside your scope' using errcode='42501';
  end if;
  if previous.revision<>p_expected_revision then
    raise exception 'Request changed. Reload before amending.' using errcode='40001';
  end if;
  if previous.state<>'Open' then
    raise exception 'Only an open submitted request can be amended' using errcode='23514';
  end if;
  select * into previous_line from public.hr_manpower_lines
    where tenant_id=active_tenant and request_id=p_id and id=p_line_id for update;
  if not found then raise exception 'Requisition line is unavailable' using errcode='42501';end if;
  if p_quantity=previous_line.current_authorized then
    raise exception 'Authorized quantity has not changed' using errcode='23514';
  end if;
  if p_increase_only and p_quantity<previous_line.current_authorized then
    raise exception 'This operation supports increases only' using errcode='23514';
  end if;
  capacity:=public.manpower_line_capacity(p_line_id);
  if p_quantity-previous_line.cancelled_unfilled < (capacity->>'reserved')::bigint+(capacity->>'fulfilled')::bigint then
    raise exception 'Quantity would undercut reserved or fulfilled commitments after cancelled demand. Release or reassign reservations first.'
      using errcode='23514';
  end if;
  saved:=previous;saved.revision:=previous.revision+1;saved.updated_at:=now();saved.updated_by:=auth.uid();
  saved_line:=previous_line;saved_line.current_authorized:=p_quantity;
  insert into public.hr_manpower_amendment_intents values(txid_current(),active_tenant,p_id,p_line_id,
    to_jsonb(previous),to_jsonb(saved),to_jsonb(previous_line),to_jsonb(saved_line));
  update public.hr_manpower_lines set current_authorized=p_quantity where tenant_id=active_tenant and id=p_line_id;
  update public.hr_manpower_requests set revision=saved.revision,updated_at=saved.updated_at,updated_by=saved.updated_by
    where tenant_id=active_tenant and id=p_id;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(active_tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
      format('Manpower quantity %s [%s/%s], revision %s: %s -> %s. Reason: %s',
        case when p_quantity>previous_line.current_authorized then 'increased' else 'decreased' end,
        p_id,p_line_id,saved.revision,previous_line.current_authorized,p_quantity,btrim(p_reason))) returning id into audit_event;
  insert into public.hr_manpower_quantity_amendments values(active_tenant,p_line_id,saved.revision,
    previous_line.current_authorized,p_quantity,btrim(p_reason),audit_event);
  delete from public.hr_manpower_amendment_intents where transaction_id=txid_current() and tenant_id=active_tenant and request_id=p_id;
  return jsonb_build_object('request',to_jsonb(saved),'line',to_jsonb(saved_line));
end $$;
revoke all on function public.amend_manpower_quantity_internal(text,text,bigint,integer,text,boolean) from public,anon,authenticated;

create function public.amend_manpower_quantity(p_id text,p_line_id text,p_expected_revision bigint,p_quantity integer,p_reason text)
returns jsonb language sql security definer set search_path=public as $$
  select public.amend_manpower_quantity_internal(p_id,p_line_id,p_expected_revision,p_quantity,p_reason,false);
$$;
create or replace function public.increase_manpower_quantity(p_id text,p_line_id text,p_expected_revision bigint,p_quantity integer,p_reason text)
returns jsonb language sql security definer set search_path=public as $$
  select public.amend_manpower_quantity_internal(p_id,p_line_id,p_expected_revision,p_quantity,p_reason,true);
$$;
revoke all on function public.amend_manpower_quantity(text,text,bigint,integer,text),
  public.increase_manpower_quantity(text,text,bigint,integer,text) from public,anon;
grant execute on function public.amend_manpower_quantity(text,text,bigint,integer,text),
  public.increase_manpower_quantity(text,text,bigint,integer,text) to authenticated;
commit;
