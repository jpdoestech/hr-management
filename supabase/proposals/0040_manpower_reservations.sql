-- Gated transaction foundation. No legacy conversion, placeholders or UI enablement.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
create schema if not exists extensions;
create extension if not exists fuzzystrmatch with schema extensions;
do $$ begin
  if not exists(select 1 from pg_extension extension join pg_namespace namespace on namespace.oid=extension.extnamespace
    where extension.extname='fuzzystrmatch' and namespace.nspname='extensions') then
    raise exception 'Reconcile fuzzystrmatch extension schema before deployment';
  end if;
  if to_regclass('public.hr_manpower_identity_links') is null or to_regclass('public.hr_manpower_quantity_amendments') is null then
    raise exception 'Verified quantity and versioned identity foundations are required';
  end if;
end $$;

create function public.manpower_identity_name_key(p_data jsonb) returns text
language sql immutable set search_path=public as $$
  select coalesce(string_agg(token,' ' order by token),'') from regexp_split_to_table(
    regexp_replace(lower(regexp_replace(normalize(coalesce(nullif(concat_ws(' ',nullif(p_data->>'lastName',''),
      nullif(p_data->>'firstName',''),nullif(p_data->>'middleName','')),''),p_data->>'name',''),NFKD),U&'[\0300-\036f]','','g')),
      '[^a-z0-9 ]',' ','g'),'[[:space:]]+') token where token<>'';
$$;
create index manpower_employee_identity_name on public.hr_records(tenant_id,public.manpower_identity_name_key(data)) where module='employees';

create table public.hr_manpower_reservation_batches (
  tenant_id uuid not null references public.hr_tenants(id),
  actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),
  payload jsonb not null,
  audit_id uuid not null references public.hr_audit_logs(id),
  created_at timestamptz not null default now(),
  primary key(tenant_id,actor_id,token)
);
create table public.hr_manpower_reservations (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  line_id text not null,
  candidate_id text not null,
  employee_id text,
  worker_key text not null,
  hiring_category text not null check(hiring_category in ('New Hire','Rehire','Existing Employee / Transfer')),
  state text not null default 'Reserved' check(state in ('Reserved','Scheduled','Deployed','Ended','Released','Reversed')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  batch_token text not null,
  released_at timestamptz,
  release_reason text,
  release_audit_id uuid references public.hr_audit_logs(id),
  scheduled_date date,
  actual_date date,
  ended_date date,
  confirmation_audit_id uuid references public.hr_audit_logs(id),
  primary key(tenant_id,id),
  foreign key(tenant_id,line_id) references public.hr_manpower_lines(tenant_id,id),
  foreign key(tenant_id,created_by,batch_token) references public.hr_manpower_reservation_batches(tenant_id,actor_id,token),
  check(worker_key=case when employee_id is null then 'candidate:'||candidate_id else 'employee:'||employee_id end),
  check((state='Released' and released_at is not null and length(btrim(release_reason)) between 1 and 1000 and release_audit_id is not null)
    or (state<>'Released' and released_at is null and release_reason is null and release_audit_id is null)),
  check((state in ('Deployed','Ended','Reversed') and employee_id is not null and actual_date is not null and confirmation_audit_id is not null)
    or (state in ('Reserved','Scheduled','Released') and actual_date is null and confirmation_audit_id is null)),
  check(state<>'Scheduled' or scheduled_date is not null),
  check(state<>'Ended' or (ended_date is not null and ended_date>=actual_date))
);
create unique index manpower_one_effective_reservation_per_worker on public.hr_manpower_reservations(tenant_id,worker_key)
  where state in ('Reserved','Scheduled','Deployed');
create unique index manpower_one_effective_reservation_per_candidate on public.hr_manpower_reservations(tenant_id,candidate_id)
  where state in ('Reserved','Scheduled','Deployed');
create index manpower_reservation_line_state on public.hr_manpower_reservations(tenant_id,line_id,state);
alter table public.hr_manpower_reservation_batches enable row level security;
alter table public.hr_manpower_reservations enable row level security;
revoke all on public.hr_manpower_reservation_batches,public.hr_manpower_reservations from public,anon,authenticated;
grant select on public.hr_manpower_reservations to authenticated;
create policy manpower_reservations_read on public.hr_manpower_reservations for select to authenticated
using(tenant_id=public.current_tenant_id() and public.current_user_has_permission('onboarding.view')
  and exists(select 1 from public.hr_manpower_lines line where line.tenant_id=hr_manpower_reservations.tenant_id
    and line.id=hr_manpower_reservations.line_id and public.can_read_manpower_draft(line.request_id))
  and exists(select 1 from public.hr_records candidate where candidate.tenant_id=hr_manpower_reservations.tenant_id
    and candidate.module='onboardingCandidates' and candidate.record_id=hr_manpower_reservations.candidate_id
    and public.current_user_scope_allows(candidate.record_id,candidate.data)));
create function public.guard_manpower_reservation_batch() returns trigger
language plpgsql set search_path=public as $$ begin
  raise exception 'Reservation batch and retry evidence are immutable' using errcode='23514';
end $$;
create trigger manpower_reservation_batch_guard before update or delete on public.hr_manpower_reservation_batches
  for each row execute function public.guard_manpower_reservation_batch();
revoke all on function public.guard_manpower_reservation_batch() from public,anon,authenticated;

-- Counts derive from real assignments; scheduling remains reserved, genuine ending retains credit.
create function public.manpower_line_capacity(p_line text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare line public.hr_manpower_lines;reserved bigint;scheduled bigint;fulfilled bigint;active_deployed bigint;
begin
  select * into line from public.hr_manpower_lines where tenant_id=public.current_tenant_id() and id=p_line;
  if not found or not public.can_read_manpower_draft(line.request_id) then
    raise exception 'Requisition line unavailable or outside your access' using errcode='42501';end if;
  if line.original_requested is null then raise exception 'Submit the request before capacity accounting' using errcode='23514';end if;
  if exists(select 1 from public.hr_records where tenant_id=line.tenant_id and module='manpowerSlots' and data->>'requestId'=line.request_id) then
    raise exception 'Legacy assignment references require reconciliation before capacity accounting' using errcode='23514';end if;
  select count(*) filter(where state in ('Reserved','Scheduled')),count(*) filter(where state='Scheduled'),
    count(*) filter(where state in ('Deployed','Ended')),count(*) filter(where state='Deployed')
    into reserved,scheduled,fulfilled,active_deployed from public.hr_manpower_reservations where tenant_id=line.tenant_id and line_id=p_line;
  if reserved+fulfilled>line.current_authorized-line.cancelled_unfilled then
    raise exception 'Capacity commitments require reconciliation; no available quantity can be reported' using errcode='23514';end if;
  return jsonb_build_object('original_requested',line.original_requested,'current_authorized',line.current_authorized,
    'cancelled_unfilled',line.cancelled_unfilled,'effective_capacity',line.current_authorized-line.cancelled_unfilled,
    'reserved',reserved,'scheduled',scheduled,'fulfilled',fulfilled,'active_deployed',active_deployed,
    'available',line.current_authorized-line.cancelled_unfilled-reserved-fulfilled);
end $$;

create function public.reserve_manpower_applicants(p_token text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;payload jsonb;previous jsonb;item jsonb;
  source jsonb;employee jsonb;candidate_key text;employee_key text;worker text;resolved_employee text;
  line public.hr_manpower_lines;request_id text;capacity jsonb;review public.hr_manpower_identity_reviews;
  audit_event uuid;ids jsonb;plan jsonb:='[]'::jsonb;selected_candidate text;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or tenant is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('onboarding.update'),false)
    or not coalesce(public.current_user_has_permission('onboarding.view'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false) then
    raise exception 'Applicant reservation access denied' using errcode='42501';end if;
  if p_token is null or btrim(p_token)='' or length(p_token) not between 1 and 100 or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'A batch token and applicant/line selections are required' using errcode='23514';end if;
  if jsonb_array_length(p_items)=0 then raise exception 'Select at least one applicant' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(p_items) value where jsonb_typeof(value) is distinct from 'object'
    or coalesce(value->>'candidate_id','')='' or coalesce(value->>'line_id','')=''
    or coalesce(value->>'hiring_category','') not in ('New Hire','Rehire','Existing Employee / Transfer')
    or value-array['candidate_id','line_id','hiring_category']<>'{}'::jsonb)
    or (select count(distinct value->>'candidate_id') from jsonb_array_elements(p_items) value)<>jsonb_array_length(p_items) then
    raise exception 'Each applicant must appear once with a line and hiring category' using errcode='23514';end if;
  select jsonb_agg(value order by value->>'candidate_id',value->>'line_id') into payload from jsonb_array_elements(p_items) value;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':reservation-batch:'||auth.uid()::text||':'||p_token,0));
  select batch.payload into previous from public.hr_manpower_reservation_batches batch
    where batch.tenant_id=tenant and actor_id=auth.uid() and token=p_token;
  if previous is not null and previous<>payload then raise exception 'Batch token already used for a different selection' using errcode='23514';end if;
  -- Same header lock order as quantity edits; missing/unauthorized lines cannot be silently skipped.
  for request_id in select distinct need.request_id from jsonb_array_elements(payload) value
    join public.hr_manpower_lines need on need.tenant_id=tenant and need.id=value->>'line_id' order by need.request_id loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
    perform 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  end loop;
  -- Identity decisions share this serialization key; stabilize all applicant sources before writes.
  for selected_candidate in select value->>'candidate_id' from jsonb_array_elements(payload) value order by value->>'candidate_id' loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':identity:'||selected_candidate,0));
  end loop;
  for item in select value from jsonb_array_elements(payload) value loop
    select * into line from public.hr_manpower_lines where tenant_id=tenant and id=item->>'line_id' for update;
    if not found or not public.can_read_manpower_draft(line.request_id) then raise exception 'Line unavailable or outside your scope' using errcode='42501';end if;
    select data into source from public.hr_records where tenant_id=tenant and module='onboardingCandidates' and record_id=item->>'candidate_id' for update;
    if source is null or not coalesce(public.current_user_scope_allows(item->>'candidate_id',source),false) then
      raise exception 'Applicant unavailable or outside your scope' using errcode='42501';end if;
    if previous is not null then continue;end if;
    if not exists(select 1 from public.hr_manpower_requests where tenant_id=tenant and id=line.request_id and state='Open')
      or line.original_requested is null then raise exception 'Choose an open submitted request' using errcode='23514';end if;
    if source->>'id' is distinct from item->>'candidate_id' or coalesce(source->>'stage','') not in
      ('Applicant','Screening','Interview','For Offer','Pre-employment','Ready to Hire','Hired')
      or source->>'recommendation'='Reject' then raise exception 'Applicant is not eligible for reservation' using errcode='23514';end if;
    if exists(select 1 from public.hr_records where tenant_id=tenant and module='manpowerSlots'
      and (data->>'requestId'=line.request_id or data->>'candidateId'=item->>'candidate_id')) then
      raise exception 'Legacy assignment references require reconciliation first' using errcode='23514';end if;
    candidate_key:=public.manpower_identity_name_key(source);
    if length(candidate_key) not between 1 and 255 then raise exception 'Applicant identity name requires reconciliation' using errcode='23514';end if;
    resolved_employee:=null;
    for employee in select data from public.hr_records where tenant_id=tenant and module='employees' order by record_id for share loop
      employee_key:=public.manpower_identity_name_key(employee);
      if length(employee_key) not between 1 and 255 then raise exception 'Employee identity data requires reconciliation before reservation' using errcode='23514';end if;
      if employee->>'id'=source->>'employeeRecordId' or employee->>'sourceCandidateId'=item->>'candidate_id'
        or exists(select 1 from public.hr_manpower_identity_links where tenant_id=tenant and candidate_id=item->>'candidate_id' and employee_id=employee->>'id')
        or 1-extensions.levenshtein(candidate_key,employee_key)::numeric/greatest(length(candidate_key),length(employee_key))>=0.86
        or (source->>'department'=employee->>'department' and 1-extensions.levenshtein(candidate_key,employee_key)::numeric/greatest(length(candidate_key),length(employee_key))>=0.78) then
        select * into review from public.hr_manpower_identity_reviews where tenant_id=tenant and candidate_id=item->>'candidate_id'
          and employee_id=employee->>'id' order by revision desc limit 1;
        if not found or review.candidate_fingerprint<>md5(source::text) or review.employee_fingerprint<>md5(employee::text) then
          raise exception 'Potential duplicate identity requires current HR review' using errcode='23514';end if;
        if review.decision='SamePerson' then
          if not coalesce(public.current_user_has_permission('employees.view'),false)
            or not coalesce(public.current_user_scope_allows(employee->>'id',employee),false) then
            raise exception 'Linked employee unavailable or outside your scope' using errcode='42501';end if;
          if resolved_employee is not null and resolved_employee<>employee->>'id' then raise exception 'Conflicting identity links require reconciliation' using errcode='23514';end if;
          resolved_employee:=employee->>'id';
        end if;
      end if;
    end loop;
    if nullif(source->>'employeeRecordId','') is not null and resolved_employee is distinct from source->>'employeeRecordId' then
      raise exception 'Existing conversion identity must be reviewed' using errcode='23514';end if;
    worker:=case when resolved_employee is null then 'candidate:'||(item->>'candidate_id') else 'employee:'||resolved_employee end;
    if resolved_employee is null and item->>'hiring_category'<>'New Hire' then
      raise exception 'Rehire or transfer requires a reviewed employee identity' using errcode='23514';end if;
    if resolved_employee is null and source->>'stage'='Hired' then
      raise exception 'Hired applicant requires a verified existing employee identity' using errcode='23514';end if;
    if resolved_employee is not null and exists(select 1 from public.hr_records where tenant_id=tenant and module='manpowerSlots'
      and data->>'employeeId'=resolved_employee) then
      raise exception 'Existing employee assignment history requires reconciliation first' using errcode='23514';end if;
    plan:=plan||jsonb_build_array(jsonb_build_object('line_id',line.id,'candidate_id',item->>'candidate_id',
      'employee_id',resolved_employee,'worker_key',worker,'hiring_category',item->>'hiring_category'));
  end loop;
  if previous is null and (select count(distinct value->>'worker_key') from jsonb_array_elements(plan) value)<>jsonb_array_length(plan) then
    raise exception 'The same resolved worker appears more than once in this batch' using errcode='23514';end if;
  for worker in select distinct value->>'worker_key' from jsonb_array_elements(plan) value order by value->>'worker_key' loop
    perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:'||worker,0));
  end loop;
  for item in select value from jsonb_array_elements(plan) value loop
    worker:=item->>'worker_key';
    if exists(select 1 from public.hr_manpower_reservations where tenant_id=tenant and worker_key=worker and state in ('Reserved','Scheduled','Deployed')) then
      raise exception 'Worker already has an effective reservation or primary deployment' using errcode='23514';end if;
    capacity:=public.manpower_line_capacity(item->>'line_id');
    if (capacity->>'available')::bigint<1 then raise exception 'Requisition capacity is insufficient for the entire batch' using errcode='23514';end if;
    -- Any later failure rolls back the complete batch, including its critical audit.
    if audit_event is null then
      insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
        format('Applicants reserved: batch %s, %s worker(s)',p_token,jsonb_array_length(payload))) returning id into audit_event;
      insert into public.hr_manpower_reservation_batches values(tenant,auth.uid(),p_token,payload,audit_event,now());
    end if;
    insert into public.hr_manpower_reservations(tenant_id,line_id,candidate_id,employee_id,worker_key,hiring_category,created_by,batch_token)
      values(tenant,item->>'line_id',item->>'candidate_id',item->>'employee_id',worker,item->>'hiring_category',auth.uid(),p_token);
  end loop;
  select jsonb_agg(id order by id) into ids from public.hr_manpower_reservations where tenant_id=tenant and created_by=auth.uid() and batch_token=p_token;
  return jsonb_build_object('reservation_ids',ids,'replayed',previous is not null);
end $$;
revoke all on function public.reserve_manpower_applicants(text,jsonb),public.manpower_line_capacity(text) from public,anon;
grant execute on function public.reserve_manpower_applicants(text,jsonb),public.manpower_line_capacity(text) to authenticated;

create table public.hr_manpower_reservation_intents (
  transaction_id bigint not null,
  tenant_id uuid not null,
  reservation_id uuid not null,
  before_row jsonb not null,
  after_row jsonb not null,
  primary key(transaction_id,tenant_id,reservation_id)
);
alter table public.hr_manpower_reservation_intents enable row level security;
revoke all on public.hr_manpower_reservation_intents from public,anon,authenticated;
create function public.guard_manpower_reservation_change() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op='UPDATE' and exists(select 1 from public.hr_manpower_reservation_intents intent
    where intent.transaction_id=txid_current() and intent.tenant_id=old.tenant_id and intent.reservation_id=old.id
      and intent.before_row=to_jsonb(old) and intent.after_row=to_jsonb(new)) then return new;end if;
  raise exception 'Reservations require a controlled transition; history cannot be deleted' using errcode='23514';
end $$;
create trigger manpower_reservation_change_guard before update or delete on public.hr_manpower_reservations
  for each row execute function public.guard_manpower_reservation_change();
revoke all on function public.guard_manpower_reservation_change() from public,anon,authenticated;

create function public.release_manpower_reservation(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare tenant uuid:=public.current_tenant_id();actor public.profiles;previous public.hr_manpower_reservations;
  saved public.hr_manpower_reservations;request_id text;candidate jsonb;audit_event uuid;
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or actor.tenant_id is distinct from tenant
    or not coalesce(public.current_user_has_permission('onboarding.update'),false)
    or not coalesce(public.current_user_has_permission('onboarding.view'),false) then
    raise exception 'Reservation release access denied' using errcode='42501';end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A release reason (1-1000 characters) is required' using errcode='23514';end if;
  select reservation.* into previous from public.hr_manpower_reservations reservation where reservation.tenant_id=tenant and id=p_id;
  if not found then raise exception 'Reservation unavailable' using errcode='42501';end if;
  select line.request_id into request_id from public.hr_manpower_lines line where line.tenant_id=tenant and line.id=previous.line_id;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':draft:'||request_id,0));
  perform 1 from public.hr_manpower_requests where tenant_id=tenant and id=request_id for update;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':identity:'||previous.candidate_id,0));
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':worker:'||previous.worker_key,0));
  select * into previous from public.hr_manpower_reservations where tenant_id=tenant and id=p_id for update;
  select data into candidate from public.hr_records where tenant_id=tenant and module='onboardingCandidates' and record_id=previous.candidate_id for share;
  if candidate is null or not coalesce(public.current_user_scope_allows(previous.candidate_id,candidate),false)
    or not public.can_read_manpower_draft(request_id) then raise exception 'Reservation outside your access' using errcode='42501';end if;
  if previous.state='Released' and previous.release_reason=btrim(p_reason) then
    return jsonb_build_object('reservation_id',p_id,'replayed',true);end if;
  if previous.state not in ('Reserved','Scheduled') then
    raise exception 'Only an effective, unconfirmed reservation can be released' using errcode='23514';end if;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
    format('Applicant reservation released [%s]. Reason: %s',p_id,btrim(p_reason))) returning id into audit_event;
  saved:=previous;saved.state:='Released';saved.released_at:=now();saved.release_reason:=btrim(p_reason);saved.release_audit_id:=audit_event;
  insert into public.hr_manpower_reservation_intents values(txid_current(),tenant,p_id,to_jsonb(previous),to_jsonb(saved));
  update public.hr_manpower_reservations set state=saved.state,released_at=saved.released_at,
    release_reason=saved.release_reason,release_audit_id=saved.release_audit_id where tenant_id=tenant and id=p_id;
  delete from public.hr_manpower_reservation_intents where transaction_id=txid_current() and tenant_id=tenant and reservation_id=p_id;
  return jsonb_build_object('reservation_id',p_id,'replayed',false);
end $$;
revoke all on function public.release_manpower_reservation(uuid,text) from public,anon;
grant execute on function public.release_manpower_reservation(uuid,text) to authenticated;

create function public.guard_manpower_reserved_source() returns trigger
language plpgsql security definer set search_path=public as $$
declare source public.hr_records;
begin
  if tg_op='INSERT' then source:=new;else source:=old;end if;
  if source.module in ('onboardingCandidates','employees') and exists(select 1 from public.hr_manpower_reservations reservation
    where reservation.tenant_id=source.tenant_id and reservation.state in ('Reserved','Scheduled','Deployed')
      and ((source.module='onboardingCandidates' and reservation.candidate_id=source.record_id)
        or (source.module='employees' and reservation.employee_id=source.record_id))) then
    if tg_op='DELETE' then raise exception 'Release or reconcile active assignments before removing this source' using errcode='23514';end if;
    if tg_op='UPDATE' and ((new.tenant_id,new.module,new.record_id) is distinct from (old.tenant_id,old.module,old.record_id)
      or jsonb_build_array(new.data->'id',new.data->'employeeRecordId',new.data->'sourceCandidateId',new.data->'name',new.data->'lastName',new.data->'firstName',new.data->'middleName')
        is distinct from jsonb_build_array(old.data->'id',old.data->'employeeRecordId',old.data->'sourceCandidateId',old.data->'name',old.data->'lastName',old.data->'firstName',old.data->'middleName')
      or (source.module='onboardingCandidates' and (new.data->>'stage' in ('Rejected','Withdrawn')
        or new.data->>'recommendation'='Reject' or (new.data->>'stage'='Hired' and old.data->>'stage' is distinct from 'Hired')))) then
      raise exception 'Use a controlled reservation release or identity/conversion transaction first' using errcode='23514';
    end if;
  elsif source.module='manpowerSlots' and tg_op<>'DELETE' and exists(select 1 from public.hr_manpower_requests request
    where request.tenant_id=new.tenant_id and request.id=new.data->>'requestId') then
    raise exception 'Quantity requests cannot be updated through legacy slots' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger manpower_reserved_source_guard before insert or update or delete on public.hr_records
  for each row execute function public.guard_manpower_reserved_source();
revoke all on function public.guard_manpower_reserved_source() from public,anon,authenticated;
commit;
