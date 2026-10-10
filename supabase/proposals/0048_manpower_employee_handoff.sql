-- Gated existing-master handoff, not new employee creation or deployment.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
create table manpower_private.source_intents (
  transaction_id bigint not null,tenant_id uuid not null,module text not null,record_id text not null,
  before_row jsonb not null,after_row jsonb not null,primary key(transaction_id,tenant_id,module,record_id)
);
alter table manpower_private.source_intents enable row level security;
revoke all on manpower_private.source_intents from public,anon,authenticated;
create table manpower_private.handoff_batches (
  tenant_id uuid not null references public.hr_tenants(id),actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),payload jsonb not null,
  audit_id uuid not null references public.hr_audit_logs(id),reservation_id uuid not null,employee_id text not null,
  created_at timestamptz not null default now(),primary key(tenant_id,actor_id,token),
  foreign key(tenant_id,reservation_id) references public.hr_manpower_reservations(tenant_id,id)
);
alter table manpower_private.handoff_batches enable row level security;
revoke all on manpower_private.handoff_batches from public,anon,authenticated;
create trigger manpower_handoff_batch_guard before update or delete on manpower_private.handoff_batches
  for each row execute function public.guard_manpower_reservation_batch();

create or replace function public.guard_manpower_reserved_source() returns trigger
language plpgsql security definer set search_path=public as $$
declare source public.hr_records;
begin
  if tg_op='UPDATE' and exists(select 1 from manpower_private.source_intents intent
    where intent.transaction_id=txid_current() and intent.tenant_id=old.tenant_id and intent.module=old.module
      and intent.record_id=old.record_id and intent.before_row=to_jsonb(old) and intent.after_row=to_jsonb(new)) then return new;end if;
  if tg_op='INSERT' then source:=new;else source:=old;end if;
  if source.module in ('onboardingCandidates','employees') and exists(select 1 from public.hr_manpower_reservations r
    where r.tenant_id=source.tenant_id and r.state in ('Reserved','Scheduled','Deployed')
      and ((source.module='onboardingCandidates' and r.candidate_id=source.record_id)
        or (source.module='employees' and r.employee_id=source.record_id))) then
    if tg_op='DELETE' then raise exception 'Release or reconcile active assignments before removing this source' using errcode='23514';end if;
    if tg_op='UPDATE' and ((new.tenant_id,new.module,new.record_id) is distinct from (old.tenant_id,old.module,old.record_id)
      or jsonb_build_array(new.data->'id',new.data->'employeeRecordId',new.data->'sourceCandidateId',new.data->'name',new.data->'lastName',new.data->'firstName',new.data->'middleName')
        is distinct from jsonb_build_array(old.data->'id',old.data->'employeeRecordId',old.data->'sourceCandidateId',old.data->'name',old.data->'lastName',old.data->'firstName',old.data->'middleName')
      or (source.module='onboardingCandidates' and (new.data->>'stage' in ('Rejected','Withdrawn') or new.data->>'recommendation'='Reject'
        or (new.data->>'stage'='Hired' and old.data->>'stage' is distinct from 'Hired')))) then
      raise exception 'Use a controlled reservation release or identity/conversion transaction first' using errcode='23514';end if;
  elsif source.module='manpowerSlots' and tg_op<>'DELETE' and exists(select 1 from public.hr_manpower_requests request
    where request.tenant_id=new.tenant_id and request.id=new.data->>'requestId') then
    raise exception 'Quantity requests cannot be updated through legacy slots' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.guard_manpower_reserved_source() from public,anon,authenticated;

create function public.handoff_manpower_employee(p_token text,p_candidate text,p_employee text,
  p_candidate_fingerprint text,p_employee_fingerprint text,p_reason text,p_expected_review_revision bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;source public.hr_records;saved_source public.hr_records;
  employee jsonb;other_employee jsonb;previous public.hr_manpower_reservations;saved public.hr_manpower_reservations;
  request_id text;key text;payload jsonb;batch manpower_private.handoff_batches;
  review public.hr_manpower_identity_reviews;other_review public.hr_manpower_identity_reviews;
  evidence jsonb:='[]';item jsonb;candidate_key text;employee_key text;audit_event uuid;revision bigint;
begin
  perform manpower_private.lock_source_snapshot(tenant);
  select * into actor from public.profiles where id=auth.uid();
  if actor.tenant_id is distinct from tenant or not public.can_review_manpower_identity(p_candidate,p_employee)
    or not coalesce(public.current_user_has_permission('onboarding.update'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false) then
    raise exception 'Employee handoff outside your access' using errcode='42501';end if;
  if p_token is null or btrim(p_token)='' or length(p_token) not between 1 and 100
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
    or p_expected_review_revision is null or p_expected_review_revision<0 then
    raise exception 'A handoff token and identity-review reason (1-1000 characters) are required' using errcode='23514';end if;
  payload:=jsonb_build_object('candidate_id',p_candidate,'employee_id',p_employee,'candidate_fingerprint',p_candidate_fingerprint,
    'employee_fingerprint',p_employee_fingerprint,'reason',btrim(p_reason),'review_revision',p_expected_review_revision);
  select * into batch from manpower_private.handoff_batches where tenant_id=tenant and actor_id=auth.uid() and token=p_token;
  if found then
    if batch.payload<>payload then raise exception 'Handoff token was used for different facts' using errcode='23514';end if;
    select l.request_id into request_id from public.hr_manpower_reservations r join public.hr_manpower_lines l
      on l.tenant_id=r.tenant_id and l.id=r.line_id where r.tenant_id=tenant and r.id=batch.reservation_id;
    if not coalesce(public.can_read_manpower_draft(request_id),false) then raise exception 'Reservation outside your access' using errcode='42501';end if;
    return jsonb_build_object('employee_id',batch.employee_id,'reservation_id',batch.reservation_id,'replayed',true);
  end if;
  select * into previous from public.hr_manpower_reservations where tenant_id=tenant and candidate_id=p_candidate and state in ('Reserved','Scheduled');
  if not found or (select count(*) from public.hr_manpower_reservations where tenant_id=tenant and candidate_id=p_candidate)<>1 then
    raise exception 'One unconfirmed reservation with no earlier assignment history is required; reconcile historical identity dependencies first' using errcode='23514';end if;
  select l.request_id into request_id from public.hr_manpower_lines l where l.tenant_id=tenant and l.id=previous.line_id;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
  perform 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':identity:'||p_candidate,0));
  for key in select distinct value from unnest(array[previous.worker_key,'employee:'||p_employee]) value order by value loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:'||key,0));end loop;
  select * into source from public.hr_records where tenant_id=tenant and module='onboardingCandidates' and record_id=p_candidate for update;
  select data into employee from public.hr_records where tenant_id=tenant and module='employees' and record_id=p_employee for share;
  if md5(source.data::text) is distinct from p_candidate_fingerprint or md5(employee::text) is distinct from p_employee_fingerprint then
    raise exception 'Source records changed. Reload the handoff review.' using errcode='40001';end if;
  select * into review from public.hr_manpower_identity_reviews where tenant_id=tenant and candidate_id=p_candidate and employee_id=p_employee order by revision desc limit 1;
  if coalesce(review.revision,0)<>p_expected_review_revision then
    raise exception 'Identity review changed. Reload the handoff review.' using errcode='40001';end if;
  if not coalesce(public.can_read_manpower_draft(request_id),false) then raise exception 'Reservation outside your access' using errcode='42501';end if;
  if source.data->>'id' is distinct from p_candidate or employee->>'id' is distinct from p_employee
    or coalesce(employee->>'employeeNo','') !~ '^EMP-[0-9]{6}$'
    or source.data->>'stage' is distinct from 'Ready to Hire' or source.data->>'recommendation' is distinct from 'Hire'
    or exists(select 1 from unnest(array['privacyNotice','interview','offer','contract','standards']) k where source.data->'checklist'->k is distinct from 'true'::jsonb)
    or coalesce(source.data->>'proposedStartDate','')='' or coalesce(source.data->>'birthDate','')='' or coalesce(source.data->>'gender','')=''
    or not exists(select 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id and state='Open')
    or (previous.employee_id is not null and previous.employee_id<>p_employee)
    or (nullif(source.data->>'employeeRecordId','') is not null and source.data->>'employeeRecordId'<>p_employee)
    or exists(select 1 from public.hr_manpower_identity_links where tenant_id=tenant and candidate_id=p_candidate and employee_id<>p_employee) then
    raise exception 'Complete hiring readiness and reconcile identity/request conflicts before handoff' using errcode='23514';end if;
  if exists(select 1 from public.hr_manpower_reservations where tenant_id=tenant and employee_id=p_employee
    and state in ('Reserved','Scheduled','Deployed') and id<>previous.id)
    or exists(select 1 from public.hr_records where tenant_id=tenant and module='manpowerSlots'
      and (data->>'candidateId'=p_candidate or data->>'employeeId'=p_employee or data->>'requestId'=request_id)) then
    raise exception 'Employee assignment dependencies require reconciliation before handoff' using errcode='23514';end if;
  if source.data->>'proposedStartDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or source.data->>'birthDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Use valid ISO hiring and birth dates before handoff' using errcode='23514';end if;
  begin
    if (source.data->>'birthDate')::date>(now() at time zone 'Asia/Manila')::date
      or (source.data->>'birthDate')::date>(source.data->>'proposedStartDate')::date then
      raise exception 'Birth date must not be future or after the proposed start' using errcode='23514';end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Use valid hiring and birth dates before handoff' using errcode='23514';
  end;
  candidate_key:=public.manpower_identity_name_key(source.data);
  if length(candidate_key) not between 1 and 255 then raise exception 'Applicant identity name requires reconciliation' using errcode='23514';end if;
  for other_employee in select data from public.hr_records where tenant_id=tenant and module='employees' and record_id<>p_employee order by record_id for share loop
    employee_key:=public.manpower_identity_name_key(other_employee);
    if length(candidate_key) not between 1 and 255 or length(employee_key) not between 1 and 255 then
      raise exception 'Identity names require reconciliation' using errcode='23514';end if;
    if other_employee->>'sourceCandidateId'=p_candidate
      or 1-extensions.levenshtein(candidate_key,employee_key)::numeric/greatest(length(candidate_key),length(employee_key))>=0.86
      or (source.data->>'department'=other_employee->>'department'
        and 1-extensions.levenshtein(candidate_key,employee_key)::numeric/greatest(length(candidate_key),length(employee_key))>=0.78) then
      select * into other_review from public.hr_manpower_identity_reviews where tenant_id=tenant and candidate_id=p_candidate
        and employee_id=other_employee->>'id' order by revision desc limit 1;
      if not found or other_review.decision<>'SeparatePersons' or other_review.candidate_fingerprint<>md5(source.data::text)
        or other_review.employee_fingerprint<>md5(other_employee::text)
        or not public.can_review_manpower_identity(p_candidate,other_employee->>'id') then
        raise exception 'Additional potential duplicate requires current scoped HR review' using errcode='23514';end if;
      evidence:=evidence||jsonb_build_array(to_jsonb(other_review));
    end if;
  end loop;
  perform public.manpower_line_capacity(previous.line_id);
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
    format('Applicant employee handoff [%s/%s], reservation %s. Reason: %s',p_candidate,p_employee,previous.id,btrim(p_reason))) returning id into audit_event;
  saved_source:=source;saved_source.data:=source.data||jsonb_build_object('stage','Hired','employeeRecordId',p_employee,
    'hiredAt',now(),'updatedAt',now(),'updatedBy',auth.uid());saved_source.updated_at:=now();saved_source.updated_by:=auth.uid();
  insert into manpower_private.source_intents values(txid_current(),tenant,source.module,source.record_id,to_jsonb(source),to_jsonb(saved_source));
  update public.hr_records set data=saved_source.data,updated_at=saved_source.updated_at,updated_by=saved_source.updated_by
    where tenant_id=tenant and module='onboardingCandidates' and record_id=p_candidate;
  delete from manpower_private.source_intents where transaction_id=txid_current() and tenant_id=tenant and module=source.module and record_id=p_candidate;
  select * into review from public.hr_manpower_identity_reviews where tenant_id=tenant and candidate_id=p_candidate and employee_id=p_employee order by revision desc limit 1;
  revision:=coalesce(review.revision,0)+1;
  insert into public.hr_manpower_identity_reviews(tenant_id,candidate_id,employee_id,revision,decision,reason,candidate_fingerprint,
    employee_fingerprint,reviewed_by,audit_id,supersedes_audit_id) values(tenant,p_candidate,p_employee,revision,'SamePerson',btrim(p_reason),
      md5(saved_source.data::text),md5(employee::text),auth.uid(),audit_event,review.audit_id);
  insert into public.hr_manpower_identity_links(tenant_id,candidate_id,employee_id,revision) values(tenant,p_candidate,p_employee,revision)
    on conflict(tenant_id,candidate_id) do update set revision=excluded.revision;
  for item in select value from jsonb_array_elements(evidence) value loop
    insert into public.hr_manpower_identity_reviews(tenant_id,candidate_id,employee_id,revision,decision,reason,candidate_fingerprint,
      employee_fingerprint,reviewed_by,audit_id,supersedes_audit_id) values(tenant,p_candidate,item->>'employee_id',(item->>'revision')::bigint+1,
        'SeparatePersons',btrim(p_reason),md5(saved_source.data::text),item->>'employee_fingerprint',auth.uid(),audit_event,(item->>'audit_id')::uuid);
  end loop;
  saved:=previous;saved.employee_id:=p_employee;saved.worker_key:='employee:'||p_employee;
  insert into public.hr_manpower_reservation_intents values(txid_current(),tenant,previous.id,to_jsonb(previous),to_jsonb(saved));
  update public.hr_manpower_reservations set employee_id=p_employee,worker_key=saved.worker_key where tenant_id=tenant and id=previous.id;
  delete from public.hr_manpower_reservation_intents where transaction_id=txid_current() and tenant_id=tenant and reservation_id=previous.id;
  insert into manpower_private.handoff_batches(tenant_id,actor_id,token,payload,audit_id,reservation_id,employee_id)
    values(tenant,auth.uid(),p_token,payload,audit_event,previous.id,p_employee);
  return jsonb_build_object('employee_id',p_employee,'reservation_id',previous.id,'replayed',false);
end $$;
revoke all on function public.handoff_manpower_employee(text,text,text,text,text,text,bigint) from public,anon;
grant execute on function public.handoff_manpower_employee(text,text,text,text,text,text,bigint) to authenticated;
commit;
