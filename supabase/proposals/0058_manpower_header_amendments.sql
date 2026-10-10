-- Gated additive header amendments; requires reviewed 0035-0042 foundations.
-- No legacy backfill, automatic migration or browser enablement.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_manpower_requests,public.hr_manpower_lines in share row exclusive mode;
do $$ begin
  if to_regclass('public.hr_manpower_prf_registry') is null
    or to_regclass('public.hr_manpower_amendment_intents') is null
    or to_regprocedure('public.change_manpower_lifecycle(text,bigint,text,text,text,integer)') is null
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_manpower_requests'::regclass
      and tgname='manpower_prf_number_guard' and tgenabled='O')
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_manpower_requests'::regclass
      and tgname='manpower_submitted_record_guard' and tgenabled='O') then
    raise exception 'Verified PRF registry, private amendment guards and lifecycle foundations are required';
  end if;
end $$;

create table public.hr_manpower_header_amendments (
  tenant_id uuid not null,
  request_id text not null,
  request_revision bigint not null check(request_revision>0),
  before_header jsonb not null check(jsonb_typeof(before_header)='object'),
  after_header jsonb not null check(jsonb_typeof(after_header)='object'),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  audit_id uuid not null references public.hr_audit_logs(id),
  check(before_header<>after_header),
  primary key(tenant_id,request_id,request_revision),
  foreign key(tenant_id,request_id) references public.hr_manpower_requests(tenant_id,id)
);
alter table public.hr_manpower_header_amendments enable row level security;
revoke all on public.hr_manpower_header_amendments from public,anon,authenticated;
grant select on public.hr_manpower_header_amendments to authenticated;
create policy manpower_header_amendments_read on public.hr_manpower_header_amendments for select to authenticated
  using(tenant_id=public.current_tenant_id() and public.can_read_manpower_draft(request_id));

create function public.guard_manpower_header_history() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Submitted header amendment history is append-only' using errcode='23514';
end $$;
revoke all on function public.guard_manpower_header_history() from public,anon,authenticated;
create trigger manpower_header_history_guard before update or delete on public.hr_manpower_header_amendments
  for each row execute function public.guard_manpower_header_history();

create function public.amend_manpower_header(p_id text,p_expected_revision bigint,p_header jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;
  previous public.hr_manpower_requests;saved public.hr_manpower_requests;
  line public.hr_manpower_lines;field text;before_values jsonb;after_values jsonb;audit_event uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or tenant is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Manpower header amendment access denied' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision<1 or jsonb_typeof(p_header) is distinct from 'object'
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A saved revision, header patch and reason (1-1000 characters) are required' using errcode='23514';
  end if;
  if p_header='{}'::jsonb or exists(select 1 from jsonb_object_keys(p_header) key
    where key not in ('prf_number','requested_by','date_requested','target_date','priority','remarks')) then
    raise exception 'Only PRF number, requested by, request/target dates, priority and remarks can be amended here' using errcode='23514';
  end if;
  for field in select jsonb_object_keys(p_header) loop
    if jsonb_typeof(p_header->field) is distinct from 'string' then
      raise exception 'Header amendment values must be text; required fields cannot be cleared' using errcode='23514';
    end if;
    if field in ('date_requested','target_date') and (p_header->>field)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Use complete ISO dates (YYYY-MM-DD)' using errcode='23514';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||p_id,0));
  select * into previous from public.hr_manpower_requests where tenant_id=tenant and id=p_id for update;
  if not found or not coalesce(public.can_read_manpower_draft(p_id),false) then
    raise exception 'Request unavailable or outside your scope' using errcode='42501';end if;
  if previous.revision<>p_expected_revision then
    raise exception 'Request changed. Reload before amending its header.' using errcode='40001';end if;
  if previous.state<>'Open' then
    raise exception 'Only an open submitted request can have its header amended' using errcode='23514';end if;
  saved:=previous;
  if p_header ? 'prf_number' then saved.prf_number:=btrim(regexp_replace(p_header->>'prf_number','[[:space:]]+',' ','g'));end if;
  if p_header ? 'requested_by' then saved.requested_by:=btrim(p_header->>'requested_by');end if;
  if p_header ? 'date_requested' then saved.date_requested:=(p_header->>'date_requested')::date;end if;
  if p_header ? 'target_date' then saved.target_date:=(p_header->>'target_date')::date;end if;
  if p_header ? 'priority' then saved.priority:=p_header->>'priority';end if;
  if p_header ? 'remarks' then saved.remarks:=p_header->>'remarks';end if;
  if saved.prf_number='' or length(saved.prf_number)>120 or saved.requested_by='' or length(saved.requested_by)>120
    or saved.date_requested is null or saved.target_date is null or saved.target_date<saved.date_requested
    or saved.priority not in ('Low','Normal','High','Urgent') or length(saved.remarks)>10000 then
    raise exception 'Complete valid PRF number, requested by, dates, priority and bounded remarks' using errcode='23514';end if;
  -- Lock all lines, not just the visible page. Dates never reschedule actual/scheduled assignments.
  perform 1 from public.hr_manpower_lines where tenant_id=tenant and request_id=p_id order by id for update;
  if exists(select 1 from public.hr_manpower_lines where tenant_id=tenant and request_id=p_id and target_date<saved.date_requested) then
    raise exception 'Request date cannot follow an existing line target date. Amend the line date separately first.' using errcode='23514';end if;
  select * into line from public.hr_manpower_lines where tenant_id=tenant and request_id=p_id order by id limit 1;
  if not found then raise exception 'Submitted request has no lines; reconcile before amending' using errcode='23514';end if;
  before_values:=jsonb_build_object('prf_number',previous.prf_number,'requested_by',previous.requested_by,
    'date_requested',previous.date_requested,'target_date',previous.target_date,'priority',previous.priority,'remarks',previous.remarks);
  after_values:=jsonb_build_object('prf_number',saved.prf_number,'requested_by',saved.requested_by,
    'date_requested',saved.date_requested,'target_date',saved.target_date,'priority',saved.priority,'remarks',saved.remarks);
  if before_values=after_values then raise exception 'Header values have not changed' using errcode='23514';end if;
  saved.revision:=previous.revision+1;saved.updated_at:=now();saved.updated_by:=auth.uid();
  insert into public.hr_manpower_amendment_intents values(txid_current(),tenant,p_id,line.id,
    to_jsonb(previous),to_jsonb(saved),to_jsonb(line),to_jsonb(line));
  -- Existing shared registry arbitrates both legacy and quantity-model numbers atomically.
  update public.hr_manpower_requests set prf_number=saved.prf_number,requested_by=saved.requested_by,
    date_requested=saved.date_requested,target_date=saved.target_date,priority=saved.priority,remarks=saved.remarks,
    revision=saved.revision,updated_at=saved.updated_at,updated_by=saved.updated_by
    where tenant_id=tenant and id=p_id returning * into saved;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
      format('Manpower header amended [%s], revision %s. Reason: %s',p_id,saved.revision,btrim(p_reason))) returning id into audit_event;
  insert into public.hr_manpower_header_amendments values(tenant,p_id,saved.revision,before_values,after_values,btrim(p_reason),audit_event);
  delete from public.hr_manpower_amendment_intents where transaction_id=txid_current() and tenant_id=tenant and request_id=p_id;
  return jsonb_build_object('request',to_jsonb(saved));
end $$;
revoke all on function public.amend_manpower_header(text,bigint,jsonb,text) from public,anon;
grant execute on function public.amend_manpower_header(text,bigint,jsonb,text) to authenticated;
comment on table public.hr_manpower_header_amendments is
  'Append-only submitted header before/after facts linked to existing audit. IDs, commitments and original submission metadata remain unchanged.';
commit;
