-- Gated resolved-identity confirmation. Conversion/transfer/reversal remain separate.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
do $$ begin
  if to_regclass('public.hr_manpower_schedule_history') is null
    or not exists(select 1 from pg_attribute where attrelid='public.hr_manpower_reservations'::regclass
      and attname='schedule_revision' and not attisdropped)
    or not exists(select 1 from pg_constraint where conrelid='public.hr_manpower_reservations'::regclass
    and conname='manpower_primary_deployment_no_overlap')
    or not exists(select 1 from pg_trigger where tgrelid='public.hr_manpower_reservations'::regclass
      and tgname='manpower_deployment_dates_guard' and tgenabled='O') then
    raise exception 'Verified deployment interval/date guards are required';
  end if;
end $$;
create table public.hr_manpower_confirmation_batches (
  tenant_id uuid not null references public.hr_tenants(id),
  actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),
  payload jsonb not null,
  audit_id uuid not null references public.hr_audit_logs(id),
  confirmed_at timestamptz not null default now(),
  primary key(tenant_id,actor_id,token)
);
create table public.hr_manpower_confirmation_history (
  tenant_id uuid not null,
  reservation_id uuid not null,
  actor_id uuid not null,
  batch_token text not null,
  previous_state text not null check(previous_state in ('Reserved','Scheduled')),
  scheduled_date date,
  schedule_revision bigint not null check(schedule_revision>=0),
  actual_date date not null check(isfinite(actual_date)),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  identity_audit_id uuid not null references public.hr_audit_logs(id),
  audit_id uuid not null references public.hr_audit_logs(id),
  confirmed_at timestamptz not null default now(),
  primary key(tenant_id,reservation_id),
  foreign key(tenant_id,reservation_id) references public.hr_manpower_reservations(tenant_id,id),
  foreign key(tenant_id,actor_id,batch_token) references public.hr_manpower_confirmation_batches(tenant_id,actor_id,token)
);
alter table public.hr_manpower_confirmation_batches enable row level security;
alter table public.hr_manpower_confirmation_history enable row level security;
revoke all on public.hr_manpower_confirmation_batches,public.hr_manpower_confirmation_history from public,anon,authenticated;
grant select on public.hr_manpower_confirmation_history to authenticated;
create policy manpower_confirmation_history_read on public.hr_manpower_confirmation_history for select to authenticated
  using(tenant_id=public.current_tenant_id() and public.current_user_has_permission('employees.view')
    and exists(select 1 from public.hr_manpower_reservations r join public.hr_records e
      on e.tenant_id=r.tenant_id and e.module='employees' and e.record_id=r.employee_id
      where r.tenant_id=hr_manpower_confirmation_history.tenant_id and r.id=hr_manpower_confirmation_history.reservation_id
        and public.current_user_scope_allows(e.record_id,e.data)));
create trigger manpower_confirmation_batch_guard before update or delete on public.hr_manpower_confirmation_batches
  for each row execute function public.guard_manpower_reservation_batch();
create trigger manpower_confirmation_history_guard before update or delete on public.hr_manpower_confirmation_history
  for each row execute function public.guard_manpower_submitted_record();

create function public.confirm_manpower_deployments(p_token text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;payload jsonb;retry jsonb;item jsonb;
  request_id text;key text;previous public.hr_manpower_reservations;saved public.hr_manpower_reservations;
  candidate jsonb;employee jsonb;match_employee jsonb;candidate_key text;employee_key text;
  review public.hr_manpower_identity_reviews;identity_audit uuid;audit_event uuid;ids jsonb;
  today date:=(now() at time zone 'Asia/Manila')::date;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or tenant is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('onboarding.view'),false)
    or not coalesce(public.current_user_has_permission('onboarding.update'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.update'),false)
    or not coalesce(public.current_user_has_permission('employees.view'),false) then
    raise exception 'Deployment confirmation access denied' using errcode='42501';end if;
  if p_token is null or btrim(p_token)='' or length(p_token) not between 1 and 100
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'A batch token and deployment selections are required' using errcode='23514';end if;
  if jsonb_array_length(p_items)=0 or exists(select 1 from jsonb_array_elements(p_items) value
    where jsonb_typeof(value) is distinct from 'object'
      or coalesce(value->>'reservation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(value->>'schedule_revision','') !~ '^[0-9]+$'
      or coalesce(value->>'actual_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(value->'reservation_id') is distinct from 'string'
      or jsonb_typeof(value->'actual_date') is distinct from 'string'
      or jsonb_typeof(value->'reason') is distinct from 'string'
      or value->>'reason' is null or length(btrim(value->>'reason')) not between 1 and 1000
      or value-array['reservation_id','schedule_revision','actual_date','reason']<>'{}'::jsonb) then
    raise exception 'Each selection needs its saved reservation, schedule revision, actual date and reason' using errcode='23514';end if;
  select jsonb_agg(jsonb_build_object('reservation_id',(value->>'reservation_id')::uuid,
    'schedule_revision',(value->>'schedule_revision')::bigint,'actual_date',(value->>'actual_date')::date,
    'reason',btrim(value->>'reason')) order by (value->>'reservation_id')::uuid) into payload
    from jsonb_array_elements(p_items) value;
  if (select count(distinct value->>'reservation_id') from jsonb_array_elements(payload) value)<>jsonb_array_length(payload)
    or exists(select 1 from jsonb_array_elements(payload) value where (value->>'actual_date')::date>today) then
    raise exception 'Select each reservation once; future dates must remain scheduled' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':confirmation-batch:'||auth.uid()::text||':'||p_token,0));
  select batch.payload into retry from public.hr_manpower_confirmation_batches batch
    where batch.tenant_id=tenant and batch.actor_id=auth.uid() and batch.token=p_token;
  if retry is not null and retry<>payload then raise exception 'Confirmation token was used for different facts' using errcode='23514';end if;
  for request_id in select distinct l.request_id from jsonb_array_elements(payload) value
    join public.hr_manpower_reservations r on r.tenant_id=tenant and r.id=(value->>'reservation_id')::uuid
    join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.id=r.line_id order by l.request_id loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
    perform 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  end loop;
  for key in select distinct r.candidate_id from jsonb_array_elements(payload) value
    join public.hr_manpower_reservations r on r.tenant_id=tenant and r.id=(value->>'reservation_id')::uuid order by r.candidate_id loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':identity:'||key,0));
  end loop;
  for key in select distinct r.worker_key from jsonb_array_elements(payload) value
    join public.hr_manpower_reservations r on r.tenant_id=tenant and r.id=(value->>'reservation_id')::uuid order by r.worker_key loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:'||key,0));
  end loop;
  for item in select value from jsonb_array_elements(payload) value loop
    select * into previous from public.hr_manpower_reservations where tenant_id=tenant and id=(item->>'reservation_id')::uuid for update;
    if not found then raise exception 'Reservation unavailable or outside your access' using errcode='42501';end if;
    select l.request_id into request_id from public.hr_manpower_lines l where l.tenant_id=tenant and l.id=previous.line_id;
    select data into candidate from public.hr_records where tenant_id=tenant and module='onboardingCandidates' and record_id=previous.candidate_id for share;
    select data into employee from public.hr_records where tenant_id=tenant and module='employees' and record_id=previous.employee_id for share;
    if candidate is null or not coalesce(public.current_user_scope_allows(previous.candidate_id,candidate),false)
      or not coalesce(public.can_read_manpower_draft(request_id),false) then
      raise exception 'Reservation outside your access' using errcode='42501';end if;
    if previous.employee_id is null then raise exception 'Complete the controlled employee identity/conversion handoff before deployment' using errcode='23514';end if;
    if employee is null or not coalesce(public.current_user_scope_allows(previous.employee_id,employee),false) then
      raise exception 'Resolved employee unavailable or outside your access' using errcode='42501';end if;
    -- A retry never revalidates or changes historical business facts, but always reauthorizes.
    if retry is not null then continue;end if;
    if previous.state not in ('Reserved','Scheduled') or not exists(select 1 from public.hr_manpower_requests
      where tenant_id=tenant and id=request_id and state='Open') then
      raise exception 'Only an unconfirmed reservation on an open request can be deployed' using errcode='23514';end if;
    if previous.schedule_revision<>(item->>'schedule_revision')::bigint then
      raise exception 'Schedule changed. Reload before confirmation.' using errcode='40001';end if;
    if candidate->>'id' is distinct from previous.candidate_id or employee->>'id' is distinct from previous.employee_id
      or coalesce(candidate->>'stage','') not in ('Applicant','Screening','Interview','For Offer','Pre-employment','Ready to Hire','Hired')
      or candidate->>'recommendation'='Reject' then
      raise exception 'Applicant or employee identity requires reconciliation before deployment' using errcode='23514';end if;
    select r.* into review from public.hr_manpower_identity_links l join public.hr_manpower_identity_reviews r
      on r.tenant_id=l.tenant_id and r.candidate_id=l.candidate_id and r.employee_id=l.employee_id and r.revision=l.revision
      where l.tenant_id=tenant and l.candidate_id=previous.candidate_id and l.employee_id=previous.employee_id;
    if not found or review.decision<>'SamePerson' or review.candidate_fingerprint<>md5(candidate::text)
      or review.employee_fingerprint<>md5(employee::text) then
      raise exception 'Refresh the verified employee identity evidence before deployment' using errcode='23514';end if;
    identity_audit:=review.audit_id;
    -- New employee records after reservation must not silently bypass duplicate review.
    candidate_key:=public.manpower_identity_name_key(candidate);
    if length(candidate_key) not between 1 and 255 then raise exception 'Applicant identity data requires reconciliation' using errcode='23514';end if;
    for match_employee in select data from public.hr_records where tenant_id=tenant and module='employees' order by record_id for share loop
      employee_key:=public.manpower_identity_name_key(match_employee);
      if length(employee_key) not between 1 and 255 then raise exception 'Employee identity data requires reconciliation' using errcode='23514';end if;
      if match_employee->>'id'=previous.employee_id or match_employee->>'sourceCandidateId'=previous.candidate_id
        or match_employee->>'id'=candidate->>'employeeRecordId'
        or 1-extensions.levenshtein(candidate_key,employee_key)::numeric/greatest(length(candidate_key),length(employee_key))>=0.86
        or (candidate->>'department'=match_employee->>'department'
          and 1-extensions.levenshtein(candidate_key,employee_key)::numeric/greatest(length(candidate_key),length(employee_key))>=0.78) then
        select * into review from public.hr_manpower_identity_reviews where tenant_id=tenant and candidate_id=previous.candidate_id
          and employee_id=match_employee->>'id' order by revision desc limit 1;
        if not found or review.candidate_fingerprint<>md5(candidate::text) or review.employee_fingerprint<>md5(match_employee::text)
          or (match_employee->>'id'<>previous.employee_id and review.decision<>'SeparatePersons') then
          raise exception 'Potential duplicate identity requires current HR review before deployment' using errcode='23514';end if;
      end if;
    end loop;
    if exists(select 1 from public.hr_records where tenant_id=tenant and module='manpowerSlots'
      and (data->>'requestId'=request_id or data->>'candidateId'=previous.candidate_id or data->>'employeeId'=previous.employee_id))
      or exists(select 1 from public.hr_records where tenant_id=tenant and module='oncall'
        and (data->>'employeeId'=previous.employee_id or data->>'candidateId'=previous.candidate_id
          or public.manpower_identity_name_key(jsonb_build_object('name',data->>'employeeName'))=public.manpower_identity_name_key(employee))) then
      raise exception 'Legacy assignment or on-call history requires reconciliation before confirmation' using errcode='23514';end if;
    perform public.manpower_line_capacity(previous.line_id);
    if audit_event is null then
      insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
        format('Actual deployments confirmed: batch %s, %s worker(s)',p_token,jsonb_array_length(payload))) returning id into audit_event;
      insert into public.hr_manpower_confirmation_batches(tenant_id,actor_id,token,payload,audit_id)
        values(tenant,auth.uid(),p_token,payload,audit_event);
    end if;
    saved:=previous;saved.state:='Deployed';saved.actual_date:=(item->>'actual_date')::date;saved.confirmation_audit_id:=audit_event;
    insert into public.hr_manpower_reservation_intents values(txid_current(),tenant,previous.id,to_jsonb(previous),to_jsonb(saved));
    update public.hr_manpower_reservations set state=saved.state,actual_date=saved.actual_date,confirmation_audit_id=audit_event
      where tenant_id=tenant and id=previous.id;
    insert into public.hr_manpower_confirmation_history(tenant_id,reservation_id,actor_id,batch_token,previous_state,scheduled_date,
      schedule_revision,actual_date,reason,identity_audit_id,audit_id)
      values(tenant,previous.id,auth.uid(),p_token,previous.state,previous.scheduled_date,previous.schedule_revision,saved.actual_date,
        item->>'reason',identity_audit,audit_event);
    delete from public.hr_manpower_reservation_intents where transaction_id=txid_current() and tenant_id=tenant and reservation_id=previous.id;
    perform public.manpower_line_capacity(previous.line_id);
  end loop;
  select jsonb_agg(value->>'reservation_id' order by value->>'reservation_id') into ids from jsonb_array_elements(payload) value;
  return jsonb_build_object('reservation_ids',ids,'replayed',retry is not null);
end $$;
revoke all on function public.confirm_manpower_deployments(text,jsonb) from public,anon;
grant execute on function public.confirm_manpower_deployments(text,jsonb) to authenticated;
commit;
