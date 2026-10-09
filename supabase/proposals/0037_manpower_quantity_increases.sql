-- Gated proposal: requires verified 0035/0036 deployment. No UI enablement or backfill.
-- Only increases are supported until authoritative commitments can protect decreases.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_manpower_requests,public.hr_manpower_lines in share row exclusive mode;
do $$ begin
  if to_regclass('public.hr_manpower_quantity_history') is null
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_manpower_lines'::regclass
      and tgname='manpower_submitted_record_guard' and tgenabled='O') then
    raise exception 'Verified submission schema and guards are required';
  end if;
end $$;

-- Private exact-row intents cannot be forged with a client-settable session flag.
create table public.hr_manpower_amendment_intents (
  transaction_id bigint not null,
  tenant_id uuid not null,
  request_id text not null,
  line_id text not null,
  before_request jsonb not null,
  after_request jsonb not null,
  before_line jsonb not null,
  after_line jsonb not null,
  primary key(transaction_id,tenant_id,request_id)
);
alter table public.hr_manpower_amendment_intents enable row level security;
revoke all on public.hr_manpower_amendment_intents from public,anon,authenticated;

create table public.hr_manpower_quantity_amendments (
  tenant_id uuid not null,
  line_id text not null,
  request_revision bigint not null check(request_revision>0),
  previous_authorized integer not null check(previous_authorized>0),
  current_authorized integer not null check(current_authorized>previous_authorized),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  audit_id uuid not null references public.hr_audit_logs(id),
  primary key(tenant_id,line_id,request_revision),
  foreign key(tenant_id,line_id) references public.hr_manpower_lines(tenant_id,id)
);
alter table public.hr_manpower_quantity_amendments enable row level security;
revoke all on public.hr_manpower_quantity_amendments from public,anon,authenticated;
grant select on public.hr_manpower_quantity_amendments to authenticated;
create policy manpower_quantity_amendments_read on public.hr_manpower_quantity_amendments for select to authenticated
  using(tenant_id=public.current_tenant_id() and exists(select 1 from public.hr_manpower_lines line
    where line.tenant_id=hr_manpower_quantity_amendments.tenant_id and line.id=hr_manpower_quantity_amendments.line_id
      and public.can_read_manpower_draft(line.request_id)));

create or replace function public.guard_manpower_submitted_record() returns trigger
language plpgsql security definer set search_path=public as $$
declare parent_state text;
begin
  if tg_op='UPDATE' and tg_table_name='hr_manpower_requests' then
    if exists(select 1 from public.hr_manpower_amendment_intents intent
      where intent.transaction_id=txid_current() and intent.tenant_id=old.tenant_id and intent.request_id=old.id
        and intent.before_request=to_jsonb(old)
        -- Stored generated columns are not populated yet in a BEFORE trigger.
        and (intent.after_request-'normalized_prf')=(to_jsonb(new)-'normalized_prf')) then return new; end if;
  elsif tg_op='UPDATE' and tg_table_name='hr_manpower_lines' then
    if exists(select 1 from public.hr_manpower_amendment_intents intent
      where intent.transaction_id=txid_current() and intent.tenant_id=old.tenant_id
        and intent.request_id=old.request_id and intent.line_id=old.id
        and intent.before_line=to_jsonb(old) and intent.after_line=to_jsonb(new)) then return new; end if;
  end if;
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
end $$;
create trigger manpower_quantity_amendments_guard before update or delete on public.hr_manpower_quantity_amendments
  for each row execute function public.guard_manpower_submitted_record();

create function public.increase_manpower_quantity(p_id text,p_line_id text,p_expected_revision bigint,p_quantity integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  active_tenant uuid:=public.current_tenant_id();
  actor public.profiles;
  previous public.hr_manpower_requests;
  saved public.hr_manpower_requests;
  previous_line public.hr_manpower_lines;
  saved_line public.hr_manpower_lines;
  audit_event uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or active_tenant is null or actor.tenant_id is distinct from active_tenant
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Manpower amendment access denied' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision<1 or p_quantity is null
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A saved revision, quantity and reason (1-1000 characters) are required' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(active_tenant::text||':draft:'||p_id,0));
  select * into previous from public.hr_manpower_requests where tenant_id=active_tenant and id=p_id for update;
  if not found or not public.can_read_manpower_draft(p_id) then
    raise exception 'Request is unavailable or outside your scope' using errcode='42501';
  end if;
  if previous.revision<>p_expected_revision then raise exception 'Request changed. Reload before amending.' using errcode='40001';end if;
  if previous.state<>'Open' then raise exception 'Only an open submitted request can be amended' using errcode='23514';end if;
  select * into previous_line from public.hr_manpower_lines
    where tenant_id=active_tenant and request_id=p_id and id=p_line_id for update;
  if not found then raise exception 'Requisition line is unavailable' using errcode='42501';end if;
  if p_quantity<=previous_line.current_authorized then
    raise exception 'Only increases are enabled. Decreases require verified commitment accounting.' using errcode='23514';
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
      format('Manpower quantity increased [%s/%s], revision %s: %s -> %s. Reason: %s',p_id,p_line_id,saved.revision,
        previous_line.current_authorized,p_quantity,btrim(p_reason))) returning id into audit_event;
  insert into public.hr_manpower_quantity_amendments values(active_tenant,p_line_id,saved.revision,
    previous_line.current_authorized,p_quantity,btrim(p_reason),audit_event);
  delete from public.hr_manpower_amendment_intents where transaction_id=txid_current() and tenant_id=active_tenant and request_id=p_id;
  return jsonb_build_object('request',to_jsonb(saved),'line',to_jsonb(saved_line));
end $$;
revoke all on function public.increase_manpower_quantity(text,text,bigint,integer,text) from public,anon;
grant execute on function public.increase_manpower_quantity(text,text,bigint,integer,text) to authenticated;
commit;
