-- Gated controlled PRF-credit reversal. Linked operational corrections remain blocked.
begin;
set local lock_timeout='5s';
create function manpower_private.deployment_reference_ids(p_data jsonb) returns setof uuid
language sql immutable set search_path=public as $$
  select distinct (value #>> '{}')::uuid from jsonb_path_query(p_data,
    '$.** ? (@.type() == "string" && @ like_regex "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")') value;
$$;
revoke all on function manpower_private.deployment_reference_ids(jsonb) from public,anon,authenticated;
create function public.guard_manpower_downstream_snapshot() returns trigger
language plpgsql security definer set search_path=public as $$
declare tenant uuid;tenants uuid[];new_references uuid[];old_references uuid[];
begin
  if tg_op='UPDATE' then tenants:=array[old.tenant_id,new.tenant_id];
  elsif tg_op='DELETE' then tenants:=array[old.tenant_id];else tenants:=array[new.tenant_id];end if;
  for tenant in select distinct value from unnest(tenants) value order by value loop
    perform manpower_private.lock_source_snapshot(tenant);
  end loop;
  if tg_op<>'DELETE' then
    select array_agg(value) into new_references from manpower_private.deployment_reference_ids(new.data) value;
    if tg_op='UPDATE' then select array_agg(value) into old_references from manpower_private.deployment_reference_ids(old.data) value;end if;
  end if;
  if tg_op<>'DELETE' and exists(select 1 from public.hr_manpower_reservations r where r.tenant_id=new.tenant_id and r.state='Reversed'
    and r.id=any(coalesce(new_references,'{}'::uuid[]))
    and (tg_op='INSERT' or old.tenant_id is distinct from new.tenant_id
      or not r.id=any(coalesce(old_references,'{}'::uuid[])))) then
    raise exception 'Cannot add a reference to a voided deployment. Review the corrected assignment.' using errcode='23514';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.guard_manpower_downstream_snapshot() from public,anon,authenticated;
create trigger manpower_00a_downstream_snapshot_guard before insert or update or delete on public.hr_records
  for each row execute function public.guard_manpower_downstream_snapshot();

create table manpower_private.reversal_batches (
  tenant_id uuid not null references public.hr_tenants(id),actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),payload jsonb not null,before_row jsonb not null,
  audit_id uuid not null references public.hr_audit_logs(id),primary key(tenant_id,actor_id,token)
);
create table public.hr_manpower_reversal_history (
  tenant_id uuid not null,reservation_id uuid not null,actor_id uuid not null,batch_token text not null,
  previous_state text not null check(previous_state in ('Deployed','Ended')),actual_date date not null,ended_date date,
  confirmation_audit_id uuid not null references public.hr_audit_logs(id),credit_delta integer not null default -1 check(credit_delta=-1),
  reason text not null check(length(btrim(reason)) between 1 and 1000),audit_id uuid not null references public.hr_audit_logs(id),
  recorded_at timestamptz not null default now(),primary key(tenant_id,reservation_id),
  foreign key(tenant_id,reservation_id) references public.hr_manpower_reservations(tenant_id,id),
  foreign key(tenant_id,actor_id,batch_token) references manpower_private.reversal_batches(tenant_id,actor_id,token)
);
alter table manpower_private.reversal_batches enable row level security;
alter table public.hr_manpower_reversal_history enable row level security;
revoke all on manpower_private.reversal_batches,public.hr_manpower_reversal_history from public,anon,authenticated;
grant select on public.hr_manpower_reversal_history to authenticated;
create policy manpower_reversal_history_read on public.hr_manpower_reversal_history for select to authenticated using(
  tenant_id=public.current_tenant_id() and public.can_read_manpower_primary('reservation',reservation_id));
create trigger manpower_reversal_batch_guard before update or delete on manpower_private.reversal_batches
  for each row execute function public.guard_manpower_reservation_batch();
create trigger manpower_reversal_history_guard before update or delete on public.hr_manpower_reversal_history
  for each row execute function public.guard_manpower_submitted_record();

alter function public.preview_manpower_reversal(text,uuid) set schema manpower_private;
revoke all on function manpower_private.preview_manpower_reversal(text,uuid) from public,anon,authenticated;
create function public.preview_manpower_reversal(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare preview jsonb;dependency record;blockers jsonb;
begin
  preview:=manpower_private.preview_manpower_reversal(p_kind,p_id);
  blockers:=preview->'blockers';
  -- Supplement the prior exact-value scanner with case-normalized/master references.
  for dependency in select
    case when r.module in ('payroll','payrollEntries','payrollRuns') then 'payroll.view' else public.hr_record_permission_key(r.module,'view') end permission_key,
    count(*) reference_count,bool_and(coalesce(public.current_user_scope_allows(r.record_id,r.data),false)) can_inspect
    from public.hr_records r where r.tenant_id=public.current_tenant_id()
      and p_id in (select manpower_private.deployment_reference_ids(r.data))
      and (r.module in ('employees','onboardingCandidates') or not jsonb_path_exists(r.data,'$.** ? (@ == $deployment)',jsonb_build_object('deployment',p_id::text)))
    group by 1 loop
    if dependency.can_inspect and coalesce(public.current_user_has_permission(dependency.permission_key),false) then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','explicit_record_references','reference_count',dependency.reference_count));
    elsif not blockers @> '[{"code":"restricted_dependency_review"}]'::jsonb then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','restricted_dependency_review'));end if;
  end loop;
  return preview||jsonb_build_object('blockers',blockers,'dependency_clear',jsonb_array_length(blockers)=0,
    'reversal_enabled',p_kind='reservation' and preview->>'state' in ('Deployed','Ended')
    and jsonb_array_length(blockers)=0 and coalesce(public.current_user_has_permission('manpower.update'),false));
end $$;
revoke all on function public.preview_manpower_reversal(text,uuid) from public,anon;
grant execute on function public.preview_manpower_reversal(text,uuid) to authenticated;

create function public.reverse_manpower_deployment(p_token text,p_kind text,p_id uuid,p_fingerprint text,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;payload jsonb;batch manpower_private.reversal_batches;
  previous public.hr_manpower_reservations;saved public.hr_manpower_reservations;request_id text;preview jsonb;audit_event uuid;
begin
  perform manpower_private.lock_source_snapshot(tenant);
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or actor.tenant_id is distinct from tenant or not coalesce(public.current_user_has_permission('manpower.update'),false)
    or not coalesce(public.current_user_has_permission('manpower.approve'),false) or not coalesce(public.can_read_manpower_primary(p_kind,p_id),false) then
    raise exception 'Reversal outside your access' using errcode='42501';end if;
  if p_token is null or length(p_token) not between 1 and 100 or btrim(p_token)='' or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{32}$'
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Provide a reversal token, saved source preview and reason' using errcode='23514';end if;
  payload:=jsonb_build_object('source_kind',p_kind,'source_id',p_id,'fingerprint',p_fingerprint,'reason',btrim(p_reason));
  select * into batch from manpower_private.reversal_batches where tenant_id=tenant and actor_id=auth.uid() and token=p_token;
  if found then
    if batch.payload<>payload then raise exception 'Reversal token was used for different facts' using errcode='23514';end if;
    return jsonb_build_object('source_id',p_id,'reversed',true,'replayed',true,'credit_delta',-1);
  end if;
  if p_kind='operational' then
    preview:=public.preview_manpower_reversal(p_kind,p_id);
    return jsonb_build_object('source_id',p_id,'reversed',false,'replayed',false,'blockers',preview->'blockers');
  end if;
  select l.request_id into request_id from public.hr_manpower_reservations r join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.id=r.line_id
    where r.tenant_id=tenant and r.id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
  perform 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  select * into previous from public.hr_manpower_reservations where tenant_id=tenant and id=p_id for update;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:'||previous.worker_key,0));
  if md5(to_jsonb(previous)::text) is distinct from p_fingerprint then raise exception 'Deployment changed. Reload reversal preview.' using errcode='40001';end if;
  if previous.state not in ('Deployed','Ended') then raise exception 'Only a valid confirmed credit can be reversed' using errcode='23514';end if;
  preview:=public.preview_manpower_reversal(p_kind,p_id);
  if not (preview->>'dependency_clear')::boolean then
    return jsonb_build_object('source_id',p_id,'reversed',false,'replayed',false,'blockers',preview->'blockers');end if;
  perform public.manpower_line_capacity(previous.line_id);
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
    format('Deployment credit reversed: batch %s, source %s. Reason: %s',p_token,p_id,btrim(p_reason))) returning id into audit_event;
  insert into manpower_private.reversal_batches values(tenant,auth.uid(),p_token,payload,to_jsonb(previous),audit_event);
  saved:=previous;saved.state:='Reversed';
  insert into public.hr_manpower_reservation_intents values(txid_current(),tenant,p_id,to_jsonb(previous),to_jsonb(saved));
  update public.hr_manpower_reservations set state='Reversed' where tenant_id=tenant and id=p_id;
  insert into public.hr_manpower_reversal_history(tenant_id,reservation_id,actor_id,batch_token,previous_state,actual_date,ended_date,confirmation_audit_id,reason,audit_id)
    values(tenant,p_id,auth.uid(),p_token,previous.state,previous.actual_date,previous.ended_date,previous.confirmation_audit_id,btrim(p_reason),audit_event);
  delete from public.hr_manpower_reservation_intents where transaction_id=txid_current() and tenant_id=tenant and reservation_id=p_id;
  perform public.manpower_line_capacity(previous.line_id);
  return jsonb_build_object('source_id',p_id,'reversed',true,'replayed',false,'credit_delta',-1);
end $$;
revoke all on function public.reverse_manpower_deployment(text,text,uuid,text,text) from public,anon;
grant execute on function public.reverse_manpower_deployment(text,text,uuid,text,text) to authenticated;
commit;
