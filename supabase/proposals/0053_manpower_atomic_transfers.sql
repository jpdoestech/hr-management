-- Gated atomic primary transfer, credited or operational. No employee-master mutation.
begin;
set local lock_timeout='5s';
create function public.can_read_manpower_primary(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public.current_user_has_permission('employees.view') and public.current_user_has_permission('manpower.view') and (
    (p_kind='reservation' and public.current_user_has_permission('onboarding.view') and exists(
      select 1 from public.hr_manpower_reservations r join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.id=r.line_id
      join public.hr_records e on e.tenant_id=r.tenant_id and e.module='employees' and e.record_id=r.employee_id
      join public.hr_records c on c.tenant_id=r.tenant_id and c.module='onboardingCandidates' and c.record_id=r.candidate_id
      where r.tenant_id=public.current_tenant_id() and r.id=p_id and public.can_read_manpower_draft(l.request_id)
        and public.current_user_scope_allows(e.record_id,e.data) and public.current_user_scope_allows(c.record_id,c.data)))
    or (p_kind='operational' and exists(select 1 from public.hr_manpower_operational_deployments o
      join public.hr_records e on e.tenant_id=o.tenant_id and e.module='employees' and e.record_id=o.employee_id
      where o.tenant_id=public.current_tenant_id() and o.id=p_id and public.current_user_scope_allows(e.record_id,e.data)
        and public.current_user_scope_allows(o.id::text,jsonb_build_object('department',o.department,'branchReporting',o.branch_reporting)))));
$$;
revoke all on function public.can_read_manpower_primary(text,uuid) from public,anon;
grant execute on function public.can_read_manpower_primary(text,uuid) to authenticated;

create function public.preview_manpower_transfer(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare source jsonb;employee jsonb;
begin
  if not coalesce(public.can_read_manpower_primary(p_kind,p_id),false) then raise exception 'Deployment outside your access' using errcode='42501';end if;
  if p_kind='reservation' then select to_jsonb(r) into source from public.hr_manpower_reservations r where tenant_id=public.current_tenant_id() and id=p_id;
  else select to_jsonb(o) into source from public.hr_manpower_operational_deployments o where tenant_id=public.current_tenant_id() and id=p_id;end if;
  select data into employee from public.hr_records where tenant_id=public.current_tenant_id() and module='employees' and record_id=source->>'employee_id';
  return jsonb_build_object('source_kind',p_kind,'source_id',p_id,'source_fingerprint',md5(source::text),
    'employee_id',source->>'employee_id','employee_name',employee->>'name','state',source->>'state','actual_date',source->>'actual_date');
end $$;
revoke all on function public.preview_manpower_transfer(text,uuid) from public,anon;
grant execute on function public.preview_manpower_transfer(text,uuid) to authenticated;

create table manpower_private.transfer_batches (
  tenant_id uuid not null references public.hr_tenants(id),actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),payload jsonb not null,audit_id uuid not null references public.hr_audit_logs(id),
  target_kind text not null check(target_kind in ('reservation','operational')),target_id uuid not null,
  primary key(tenant_id,actor_id,token)
);
create table public.hr_manpower_transfer_history (
  tenant_id uuid not null,actor_id uuid not null,batch_token text not null,employee_id text not null,
  source_kind text not null check(source_kind in ('reservation','operational')),source_id uuid not null,
  target_kind text not null check(target_kind in ('reservation','operational')),target_id uuid not null,
  source_actual_date date not null,transferred_date date not null,reason text not null check(length(btrim(reason)) between 1 and 1000),
  audit_id uuid not null references public.hr_audit_logs(id),recorded_at timestamptz not null default now(),
  primary key(tenant_id,actor_id,batch_token),unique(tenant_id,source_kind,source_id),
  check(isfinite(source_actual_date) and isfinite(transferred_date) and transferred_date>source_actual_date),
  foreign key(tenant_id,actor_id,batch_token) references manpower_private.transfer_batches(tenant_id,actor_id,token)
);
alter table manpower_private.transfer_batches enable row level security;
alter table public.hr_manpower_transfer_history enable row level security;
revoke all on manpower_private.transfer_batches,public.hr_manpower_transfer_history from public,anon,authenticated;
grant select on public.hr_manpower_transfer_history to authenticated;
create policy manpower_transfer_history_read on public.hr_manpower_transfer_history for select to authenticated using(
  tenant_id=public.current_tenant_id() and public.can_read_manpower_primary(source_kind,source_id) and public.can_read_manpower_primary(target_kind,target_id));
create trigger manpower_transfer_batch_guard before update or delete on manpower_private.transfer_batches
  for each row execute function public.guard_manpower_reservation_batch();
create trigger manpower_transfer_history_guard before update or delete on public.hr_manpower_transfer_history
  for each row execute function public.guard_manpower_submitted_record();

create function public.transfer_manpower_deployment(p_token text,p_kind text,p_id uuid,p_fingerprint text,p_destination jsonb,p_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;source jsonb;employee jsonb;payload jsonb;batch manpower_private.transfer_batches;
  operational public.hr_manpower_operational_deployments;saved public.hr_manpower_operational_deployments;
  line public.hr_manpower_lines;request_id text;source_request text;target_kind text;target_id uuid;
  v_employee_id text;v_candidate_id text;audit_event uuid;child_token text;result jsonb;
begin
  perform manpower_private.lock_source_snapshot(tenant);
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or actor.tenant_id is distinct from tenant or not coalesce(public.current_user_has_permission('manpower.update'),false)
    or not coalesce(public.can_read_manpower_primary(p_kind,p_id),false) then raise exception 'Transfer outside your access' using errcode='42501';end if;
  if p_token is null or length(p_token) not between 1 and 100 or btrim(p_token)='' or p_kind not in ('reservation','operational')
    or p_date is null or not isfinite(p_date) or p_date>(now() at time zone 'Asia/Manila')::date
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or jsonb_typeof(p_destination) is distinct from 'object' then
    raise exception 'Provide a transfer token, valid actual date, destination and reason' using errcode='23514';end if;
  target_kind:=p_destination->>'kind';
  if target_kind='reservation' then
    if p_destination-array['kind','line_id']<>'{}'::jsonb or jsonb_typeof(p_destination->'line_id') is distinct from 'string'
      or length(coalesce(p_destination->>'line_id','')) not between 1 and 100
      or not coalesce(public.current_user_has_permission('onboarding.update'),false)
      or not coalesce(public.current_user_has_permission('onboarding.view'),false) then
      raise exception 'Select a requisition destination with applicant update/view access' using errcode='42501';end if;
  elsif target_kind='operational' then
    if p_destination-array['kind','client_id','branch_reporting','department','position']<>'{}'::jsonb
      or jsonb_typeof(p_destination->'branch_reporting') is distinct from 'string'
      or jsonb_typeof(p_destination->'department') is distinct from 'string' or jsonb_typeof(p_destination->'position') is distinct from 'string'
      or (p_destination->'client_id' is not null and p_destination->'client_id'<>'null'::jsonb and
        (jsonb_typeof(p_destination->'client_id')<>'string' or coalesce(p_destination->>'client_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
      raise exception 'Use configured operational destination fields' using errcode='23514';end if;
  else raise exception 'Choose requisition-backed or non-credited operational transfer' using errcode='23514';end if;
  payload:=jsonb_build_object('source_kind',p_kind,'source_id',p_id,'fingerprint',p_fingerprint,'destination',p_destination,'date',p_date,'reason',btrim(p_reason));
  select * into batch from manpower_private.transfer_batches where tenant_id=tenant and actor_id=auth.uid() and token=p_token;
  if found then
    if batch.payload<>payload then raise exception 'Transfer token was used for different facts' using errcode='23514';end if;
    if not coalesce(public.can_read_manpower_primary(batch.target_kind,batch.target_id),false) then raise exception 'Destination outside your access' using errcode='42501';end if;
    return jsonb_build_object('target_kind',batch.target_kind,'target_id',batch.target_id,'replayed',true);
  end if;
  if p_kind='reservation' then
    select to_jsonb(r) into source from public.hr_manpower_reservations r where tenant_id=tenant and id=p_id;
    select l.request_id into source_request from public.hr_manpower_lines l where l.tenant_id=tenant and l.id=source->>'line_id';
  else select to_jsonb(o) into source from public.hr_manpower_operational_deployments o where tenant_id=tenant and id=p_id;end if;
  if md5(source::text) is distinct from p_fingerprint then raise exception 'Deployment changed. Reload the transfer preview.' using errcode='40001';end if;
  if source->>'state'<>'Deployed' or p_date<=(source->>'actual_date')::date then raise exception 'Transfer must end an active deployment after its start' using errcode='23514';end if;
  v_employee_id:=source->>'employee_id';v_candidate_id:=source->>'candidate_id';
  if target_kind='reservation' then
    select * into line from public.hr_manpower_lines where tenant_id=tenant and id=p_destination->>'line_id';
    if not found or not coalesce(public.can_read_manpower_draft(line.request_id),false) then raise exception 'Requisition destination outside your access' using errcode='42501';end if;
    if v_candidate_id is null or exists(select 1 from public.hr_manpower_reservations r where r.tenant_id=tenant and r.employee_id=v_employee_id
      and r.line_id=line.id and r.state in ('Deployed','Ended')) then
      raise exception 'Choose new authorized demand, not a previously credited worker/line' using errcode='23514';end if;
  else
    if not coalesce(public.current_user_scope_allows(p_id::text,jsonb_build_object('department',p_destination->>'department','branchReporting',p_destination->>'branch_reporting')),false) then
      raise exception 'Operational destination outside your access' using errcode='42501';end if;
  end if;
  for request_id in select distinct value from unnest(array[source_request,line.request_id]) value where value is not null order by value loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
    perform 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  end loop;
  if v_candidate_id is not null then perform pg_advisory_xact_lock(hashtextextended(tenant::text||':identity:'||v_candidate_id,0));end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:employee:'||v_employee_id,0));
  select data into employee from public.hr_records where tenant_id=tenant and module='employees' and record_id=v_employee_id for share;
  if employee->>'id' is distinct from v_employee_id then raise exception 'Reconcile the source worker before transferring' using errcode='23514';end if;
  if exists(select 1 from public.hr_records where tenant_id=tenant and module='manpowerSlots' and (data->>'employeeId'=v_employee_id or data->>'candidateId'=v_candidate_id))
    or exists(select 1 from public.hr_records where tenant_id=tenant and module='oncall' and (data->>'employeeId'=v_employee_id or data->>'candidateId'=v_candidate_id
      or public.manpower_identity_name_key(jsonb_build_object('name',data->>'employeeName'))=public.manpower_identity_name_key(employee))) then
    raise exception 'Reconcile legacy or on-call dependencies before transferring' using errcode='23514';end if;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
    format('Primary deployment transferred: batch %s, source %s/%s. Reason: %s',p_token,p_kind,p_id,btrim(p_reason))) returning id into audit_event;
  child_token:='transfer:'||md5(p_token);
  if p_kind='reservation' then
    perform public.end_manpower_deployments(child_token,jsonb_build_array(jsonb_build_object('reservation_id',p_id,
      'confirmation_audit_id',source->>'confirmation_audit_id','actual_date',source->>'actual_date','ended_date',p_date,'reason',btrim(p_reason))));
  else
    select * into operational from public.hr_manpower_operational_deployments where tenant_id=tenant and id=p_id for update;
    saved:=operational;saved.state:='Ended';saved.ended_date:=p_date;saved.end_audit_id:=audit_event;saved.end_reason:=btrim(p_reason);
    insert into manpower_private.operational_intents values(txid_current(),tenant,p_id,to_jsonb(operational),to_jsonb(saved));
    update public.hr_manpower_operational_deployments set state=saved.state,ended_date=p_date,end_audit_id=audit_event,end_reason=saved.end_reason where tenant_id=tenant and id=p_id;
    delete from manpower_private.operational_intents where transaction_id=txid_current() and tenant_id=tenant and source_id=p_id;
  end if;
  if target_kind='reservation' then
    result:=public.reserve_manpower_applicants(child_token,jsonb_build_array(jsonb_build_object('candidate_id',v_candidate_id,'line_id',line.id,'hiring_category','Existing Employee / Transfer')));
    target_id:=(result->'reservation_ids'->>0)::uuid;
    if not exists(select 1 from public.hr_manpower_reservations r where r.tenant_id=tenant and r.id=target_id and r.employee_id=v_employee_id) then
      raise exception 'Transfer identity did not retain the selected worker' using errcode='23514';end if;
    perform public.confirm_manpower_deployments(child_token,jsonb_build_array(jsonb_build_object('reservation_id',target_id,'schedule_revision',0,'actual_date',p_date,'reason',btrim(p_reason))));
  else
    saved.tenant_id:=tenant;saved.id:=gen_random_uuid();saved.employee_id:=v_employee_id;saved.candidate_id:=v_candidate_id;
    saved.origin_kind:=p_kind;saved.origin_id:=p_id;saved.client_id:=(p_destination->>'client_id')::uuid;
    saved.branch_reporting:=p_destination->>'branch_reporting';saved.department:=p_destination->>'department';saved.position:=p_destination->>'position';
    saved.state:='Deployed';saved.actual_date:=p_date;saved.ended_date:=null;saved.reason:=btrim(p_reason);
    saved.created_by:=auth.uid();saved.created_at:=now();saved.audit_id:=audit_event;saved.end_audit_id:=null;saved.end_reason:=null;
    if not coalesce(public.current_user_scope_allows(saved.id::text,jsonb_build_object('department',saved.department,'branchReporting',saved.branch_reporting)),false) then
      raise exception 'New operational resource outside your access' using errcode='42501';end if;
    insert into manpower_private.operational_intents values(txid_current(),tenant,saved.id,null,to_jsonb(saved));
    insert into public.hr_manpower_operational_deployments select (saved).*;
    delete from manpower_private.operational_intents where transaction_id=txid_current() and tenant_id=tenant and source_id=saved.id;
    target_id:=saved.id;
  end if;
  insert into manpower_private.transfer_batches values(tenant,auth.uid(),p_token,payload,audit_event,target_kind,target_id);
  insert into public.hr_manpower_transfer_history(tenant_id,actor_id,batch_token,employee_id,source_kind,source_id,target_kind,target_id,source_actual_date,transferred_date,reason,audit_id)
    values(tenant,auth.uid(),p_token,v_employee_id,p_kind,p_id,target_kind,target_id,(source->>'actual_date')::date,p_date,btrim(p_reason),audit_event);
  return jsonb_build_object('target_kind',target_kind,'target_id',target_id,'replayed',false);
end $$;
revoke all on function public.transfer_manpower_deployment(text,text,uuid,text,jsonb,date,text) from public,anon;
grant execute on function public.transfer_manpower_deployment(text,text,uuid,text,jsonb,date,text) to authenticated;
commit;
