-- Gated informative outgoing-deployment references. No credit or quantity mutation.
begin;
set local lock_timeout='5s';
create table manpower_private.replacement_link_batches (
  tenant_id uuid not null references public.hr_tenants(id),actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),payload jsonb not null,
  audit_id uuid not null references public.hr_audit_logs(id),primary key(tenant_id,actor_id,token)
);
create table public.hr_manpower_replacement_sources (
  tenant_id uuid not null,line_id text not null,source_kind text not null check(source_kind in ('reservation','operational')),source_id uuid not null,
  employee_id text not null,actual_date date not null,ended_date date not null,
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  actor_id uuid not null,batch_token text not null,audit_id uuid not null references public.hr_audit_logs(id),recorded_at timestamptz not null default now(),
  primary key(tenant_id,line_id,source_kind,source_id),
  check(isfinite(actual_date) and isfinite(ended_date) and ended_date>actual_date),
  foreign key(tenant_id,line_id) references public.hr_manpower_lines(tenant_id,id),
  foreign key(tenant_id,actor_id,batch_token) references manpower_private.replacement_link_batches(tenant_id,actor_id,token)
);
create index manpower_replacement_outgoing on public.hr_manpower_replacement_sources(tenant_id,source_kind,source_id);
create index manpower_replacement_worker on public.hr_manpower_replacement_sources(tenant_id,employee_id,ended_date);
alter table manpower_private.replacement_link_batches enable row level security;
alter table public.hr_manpower_replacement_sources enable row level security;
revoke all on manpower_private.replacement_link_batches,public.hr_manpower_replacement_sources from public,anon,authenticated;
grant select on public.hr_manpower_replacement_sources to authenticated;
create policy manpower_replacement_sources_read on public.hr_manpower_replacement_sources for select to authenticated using(
  tenant_id=public.current_tenant_id() and public.can_read_manpower_primary(source_kind,source_id)
  and exists(select 1 from public.hr_manpower_lines l where l.tenant_id=hr_manpower_replacement_sources.tenant_id
    and l.id=hr_manpower_replacement_sources.line_id and public.can_read_manpower_draft(l.request_id)));
create trigger manpower_replacement_batch_guard before update or delete on manpower_private.replacement_link_batches
  for each row execute function public.guard_manpower_reservation_batch();
create trigger manpower_replacement_sources_guard before update or delete on public.hr_manpower_replacement_sources
  for each row execute function public.guard_manpower_submitted_record();

create function public.link_manpower_replacement_sources(p_token text,p_line_id text,p_revision bigint,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;line public.hr_manpower_lines;request public.hr_manpower_requests;
  payload jsonb;retry jsonb;item jsonb;source jsonb;audit_event uuid;key text;
begin
  perform manpower_private.lock_source_snapshot(tenant);
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('employees.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.update'),false) then
    raise exception 'Replacement linking outside your access' using errcode='42501';end if;
  if p_token is null or length(p_token) not between 1 and 100 or btrim(p_token)='' or p_line_id is null
    or p_revision is null or p_revision<1 or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Provide a token, saved replacement line/revision and outgoing deployments' using errcode='23514';end if;
  if jsonb_array_length(p_items)=0 or exists(select 1 from jsonb_array_elements(p_items) value where
    jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'source_kind','') not in ('reservation','operational')
    or jsonb_typeof(value->'source_id') is distinct from 'string'
    or coalesce(value->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(value->'source_fingerprint') is distinct from 'string' or coalesce(value->>'source_fingerprint','') !~ '^[0-9a-f]{32}$'
    or jsonb_typeof(value->'reason') is distinct from 'string' or length(btrim(coalesce(value->>'reason',''))) not between 1 and 1000
    or value-array['source_kind','source_id','source_fingerprint','reason']<>'{}'::jsonb) then
    raise exception 'Each outgoing reference needs its saved preview and reason' using errcode='23514';end if;
  select jsonb_build_object('line_id',p_line_id,'revision',p_revision,'items',jsonb_agg(jsonb_build_object('source_kind',value->>'source_kind',
    'source_id',(value->>'source_id')::uuid,'source_fingerprint',value->>'source_fingerprint','reason',btrim(value->>'reason'))
    order by value->>'source_kind',(value->>'source_id')::uuid)) into payload from jsonb_array_elements(p_items) value;
  if (select count(distinct (value->>'source_kind',value->>'source_id')) from jsonb_array_elements(payload->'items') value)<>jsonb_array_length(p_items) then
    raise exception 'Select each outgoing deployment once' using errcode='23514';end if;
  select * into line from public.hr_manpower_lines where tenant_id=tenant and id=p_line_id;
  if not found or not coalesce(public.can_read_manpower_draft(line.request_id),false) then raise exception 'Replacement line outside your access' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||line.request_id,0));
  select * into request from public.hr_manpower_requests where tenant_id=tenant and id=line.request_id for update;
  select b.payload into retry from manpower_private.replacement_link_batches b where b.tenant_id=tenant and b.actor_id=auth.uid() and b.token=p_token;
  if retry is not null and retry<>payload then raise exception 'Replacement token was used for different facts' using errcode='23514';end if;
  if retry is null then
    if request.revision<>p_revision then raise exception 'Replacement request changed. Reload before linking.' using errcode='40001';end if;
    if request.state='Draft' or request.submitted_at is null or line.original_requested is null or line.demand_type<>'Replacement' then
      raise exception 'Select a submitted Replacement line' using errcode='23514';end if;
    perform public.manpower_line_capacity(line.id);
  end if;
  for key in select distinct case when value->>'source_kind'='reservation' then r.employee_id else o.employee_id end
    from jsonb_array_elements(payload->'items') value
    left join public.hr_manpower_reservations r on value->>'source_kind'='reservation' and r.tenant_id=tenant and r.id=(value->>'source_id')::uuid
    left join public.hr_manpower_operational_deployments o on value->>'source_kind'='operational' and o.tenant_id=tenant and o.id=(value->>'source_id')::uuid
    order by 1 loop
    if key is not null then perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:employee:'||key,0));end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'items') value loop
    if not coalesce(public.can_read_manpower_primary(item->>'source_kind',(item->>'source_id')::uuid),false) then
      raise exception 'Outgoing deployment outside your access' using errcode='42501';end if;
    if retry is not null then continue;end if;
    if item->>'source_kind'='reservation' then
      select to_jsonb(r) into source from public.hr_manpower_reservations r where tenant_id=tenant and id=(item->>'source_id')::uuid for share;
    else select to_jsonb(o) into source from public.hr_manpower_operational_deployments o where tenant_id=tenant and id=(item->>'source_id')::uuid for share;end if;
    if md5(source::text) is distinct from item->>'source_fingerprint' then raise exception 'Outgoing deployment changed. Reload its preview.' using errcode='40001';end if;
    if source->>'state'<>'Ended' or (item->>'source_kind'='reservation' and source->>'line_id'=line.id) then
      raise exception 'Use a genuine ended deployment and a new replacement requirement, not the original filled line' using errcode='23514';end if;
    if exists(select 1 from public.hr_manpower_replacement_sources where tenant_id=tenant and line_id=line.id
      and source_kind=item->>'source_kind' and source_id=(item->>'source_id')::uuid) then
      raise exception 'Outgoing deployment is already linked to this requirement' using errcode='23514';end if;
    if audit_event is null then
      insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
        format('Replacement outgoing deployments linked: batch %s, line %s, %s reference(s)',p_token,line.id,jsonb_array_length(p_items))) returning id into audit_event;
      insert into manpower_private.replacement_link_batches values(tenant,auth.uid(),p_token,payload,audit_event);
    end if;
    insert into public.hr_manpower_replacement_sources(tenant_id,line_id,source_kind,source_id,employee_id,actual_date,ended_date,reason,actor_id,batch_token,audit_id)
      values(tenant,line.id,item->>'source_kind',(item->>'source_id')::uuid,source->>'employee_id',(source->>'actual_date')::date,
        (source->>'ended_date')::date,item->>'reason',auth.uid(),p_token,audit_event);
  end loop;
  return jsonb_build_object('line_id',line.id,'linked_count',jsonb_array_length(p_items),'replayed',retry is not null);
end $$;
revoke all on function public.link_manpower_replacement_sources(text,text,bigint,jsonb) from public,anon;
grant execute on function public.link_manpower_replacement_sources(text,text,bigint,jsonb) to authenticated;
commit;
