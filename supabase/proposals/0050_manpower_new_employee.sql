-- Gated atomic new-hire master creation. Requires 0030 and proposals 0048-0049.
begin;
set local lock_timeout='5s';
do $$ begin
  if not exists(select 1 from pg_index where indexrelid=to_regclass('public.hr_records_employee_number_unique_idx') and indisunique and indisvalid) then
    raise exception 'Apply the canonical employee-number migration before this proposal';end if;
end $$;
create table manpower_private.new_employee_batches (
  tenant_id uuid not null references public.hr_tenants(id),actor_id uuid not null references auth.users(id),
  token text not null check(length(token) between 1 and 100),payload jsonb not null,
  candidate_id text not null,employee_id text not null,reservation_id uuid not null,
  audit_id uuid not null references public.hr_audit_logs(id),created_at timestamptz not null default now(),
  primary key(tenant_id,actor_id,token),
  foreign key(tenant_id,reservation_id) references public.hr_manpower_reservations(tenant_id,id)
);
alter table manpower_private.new_employee_batches enable row level security;
revoke all on manpower_private.new_employee_batches from public,anon,authenticated;
create trigger manpower_new_employee_batch_guard before update or delete on manpower_private.new_employee_batches
  for each row execute function public.guard_manpower_reservation_batch();

create function public.create_manpower_employee(p_token text,p_candidate text,p_candidate_fingerprint text,p_details jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_tenant_id();actor public.profiles;candidate jsonb;employee jsonb;catalogs jsonb;
  reservation public.hr_manpower_reservations;request public.hr_manpower_requests;batch manpower_private.new_employee_batches;
  payload jsonb;employee_id text;employee_number integer;key text;raw text;digits text;ids jsonb:='{}';
  home jsonb;present jsonb;allowances jsonb;amount numeric;result jsonb;audit_event uuid;actor_name text;
begin
  perform manpower_private.lock_source_snapshot(tenant);
  select * into actor from public.profiles where id=auth.uid();
  if actor.tenant_id is distinct from tenant or auth.uid() is null
    or not coalesce(public.current_user_has_permission('employees.create'),false)
    or not coalesce(public.current_user_has_permission('employees.view'),false)
    or not coalesce(public.current_user_has_permission('onboarding.view'),false)
    or not coalesce(public.current_user_has_permission('onboarding.update'),false)
    or not coalesce(public.current_user_has_permission('onboarding.review_identity'),false)
    or not coalesce(public.current_user_has_permission('manpower.view'),false) then
    raise exception 'New employee creation outside your access' using errcode='42501';end if;
  if p_token is null or length(p_token) not between 1 and 100 or btrim(p_token)=''
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
    or p_details is null or jsonb_typeof(p_details)<>'object'
    or p_details-array['employmentType','branchReporting','dailyRate','allowances','homeAddress','presentAddress']<>'{}'::jsonb then
    raise exception 'Provide a creation token, reason and supported hiring details' using errcode='23514';end if;
  payload:=jsonb_build_object('candidate',p_candidate,'fingerprint',p_candidate_fingerprint,'details',p_details,'reason',btrim(p_reason));
  select data into candidate from public.hr_records where tenant_id=tenant and module='onboardingCandidates' and record_id=p_candidate for update;
  if candidate is null or not coalesce(public.current_user_scope_allows(p_candidate,candidate),false) then
    raise exception 'Applicant outside your access' using errcode='42501';end if;
  select * into batch from manpower_private.new_employee_batches where tenant_id=tenant and actor_id=auth.uid() and token=p_token;
  if found then
    if batch.payload<>payload then raise exception 'Creation token was used for different facts' using errcode='23514';end if;
    select r.* into reservation from public.hr_manpower_reservations r where r.tenant_id=tenant and r.id=batch.reservation_id;
    if not coalesce(public.can_review_manpower_identity(p_candidate,batch.employee_id),false)
      or not coalesce(public.can_read_manpower_draft((select request_id from public.hr_manpower_lines where tenant_id=tenant and id=reservation.line_id)),false) then
      raise exception 'Created employee or reservation outside your access' using errcode='42501';end if;
    return jsonb_build_object('employee_id',batch.employee_id,'reservation_id',batch.reservation_id,'replayed',true);
  end if;
  if md5(candidate::text) is distinct from p_candidate_fingerprint then
    raise exception 'Applicant changed. Reload the hiring review.' using errcode='40001';end if;
  select * into reservation from public.hr_manpower_reservations where tenant_id=tenant and candidate_id=p_candidate and state in ('Reserved','Scheduled');
  if not found or reservation.hiring_category<>'New Hire' or reservation.employee_id is not null then
    raise exception 'An unresolved new-hire reservation is required; use the existing employee handoff for rehires' using errcode='23514';end if;
  select r.* into request from public.hr_manpower_requests r join public.hr_manpower_lines l on l.tenant_id=r.tenant_id and l.request_id=r.id
    where l.tenant_id=tenant and l.id=reservation.line_id;
  if not coalesce(public.can_read_manpower_draft(request.id),false) then raise exception 'Reservation outside your access' using errcode='42501';end if;
  if exists(select 1 from public.hr_records where tenant_id=tenant and module='employees' and data->>'sourceCandidateId'=p_candidate)
    or nullif(candidate->>'employeeRecordId','') is not null then
    raise exception 'Applicant already has an employee; reconcile identity instead of creating a duplicate' using errcode='23514';end if;
  foreach key in array array['lastName','firstName','middleName','positionApplied','department','birthDate','gender','civilStatus',
    'mobileNumber','personalEmail','tin','sssNumber','philHealthNumber','pagIbigNumber'] loop
    if candidate?key and jsonb_typeof(candidate->key) not in ('string','null') then raise exception 'Applicant fields must be text' using errcode='23514';end if;
    if length(coalesce(candidate->>key,''))>255 then raise exception 'Applicant field is too long: %',key using errcode='23514';end if;
  end loop;
  if btrim(coalesce(candidate->>'lastName',''))='' or btrim(coalesce(candidate->>'firstName',''))='' then
    raise exception 'Complete the applicant last and first names before hiring' using errcode='23514';end if;
  if candidate->>'gender' not in ('Male','Female','Other') then raise exception 'Select a valid applicant gender' using errcode='23514';end if;
  if coalesce(candidate->>'personalEmail','')<>'' and candidate->>'personalEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Use a valid applicant email' using errcode='23514';end if;
  select data into catalogs from public.hr_settings where tenant_id=tenant and id='singleton' for share;
  if not exists(select 1 from jsonb_array_elements(coalesce(catalogs->'departments','[]')) item
      where item->>'name'=candidate->>'department' and item->>'active'='true')
    or not exists(select 1 from jsonb_array_elements(coalesce(catalogs->'positions','[]')) item
      where item->>'name'=candidate->>'positionApplied' and item->>'department'=candidate->>'department' and item->>'active'='true') then
    raise exception 'Select an active department and matching position before hiring' using errcode='23514';end if;
  if jsonb_typeof(p_details->'employmentType') is distinct from 'string'
    or p_details->>'employmentType' not in ('Regular / Permanent','Probationary','Project-Based','Seasonal','Fixed-Term / Contractual','Casual')
    or jsonb_typeof(p_details->'branchReporting') is distinct from 'string'
    or not exists(select 1 from jsonb_array_elements_text(coalesce(catalogs->'branchLocations','[]')) item where item=p_details->>'branchReporting') then
    raise exception 'Select a contract type and configured reporting branch' using errcode='23514';end if;
  if not (p_details->'dailyRate' is null or p_details->'dailyRate'='null'::jsonb or p_details->'dailyRate'='""'::jsonb) then
    if jsonb_typeof(p_details->'dailyRate')<>'number' then raise exception 'Daily rate must be numeric or blank' using errcode='23514';end if;
    amount:=(p_details->>'dailyRate')::numeric;
    if amount<0 or amount>999999999.99 or amount<>round(amount,2) then raise exception 'Use a non-negative daily rate with at most two decimal places' using errcode='23514';end if;
  end if;
  allowances:=coalesce(p_details->'allowances','{}');
  if jsonb_typeof(allowances)<>'object' then raise exception 'Allowances must be named amounts' using errcode='23514';end if;
  for key,raw in select * from jsonb_each_text(allowances) loop
    if not exists(select 1 from jsonb_array_elements_text(coalesce(catalogs->'allowanceTypes','[]')) item where item=key)
      or jsonb_typeof(allowances->key) is distinct from 'number' then raise exception 'Use a configured allowance and numeric amount' using errcode='23514';end if;
    amount:=raw::numeric;
    if amount<0 or amount>999999999.99 or amount<>round(amount,2) then raise exception 'Use non-negative allowance amounts with at most two decimal places' using errcode='23514';end if;
  end loop;
  foreach key in array array['tin','sssNumber','philHealthNumber','pagIbigNumber'] loop
    raw:=btrim(coalesce(candidate->>key,''));digits:=regexp_replace(raw,'[^0-9]','','g');
    if raw<>'' and (raw !~ '^[0-9 -]+$' or (key='tin' and length(digits) not in (9,12))
      or (key='sssNumber' and length(digits)<>10) or (key in ('philHealthNumber','pagIbigNumber') and length(digits)<>12)) then
      raise exception 'Invalid optional government ID: %',key using errcode='23514';end if;
    if key='sssNumber' and digits<>'' then raw:=substr(digits,1,2)||'-'||substr(digits,3,7)||'-'||substr(digits,10,1);
    elsif key='philHealthNumber' and digits<>'' then raw:=substr(digits,1,2)||'-'||substr(digits,3,9)||'-'||substr(digits,12,1);
    elsif key='pagIbigNumber' and digits<>'' then raw:=substr(digits,1,4)||'-'||substr(digits,5,4)||'-'||substr(digits,9,4);
    elsif key='tin' and digits<>'' then raw:=substr(digits,1,3)||'-'||substr(digits,4,3)||'-'||substr(digits,7,3)||case when length(digits)=12 then '-'||substr(digits,10,3) else '' end;end if;
    ids:=ids||jsonb_build_object(key,raw);
  end loop;
  home:=manpower_private.validate_employee_address(coalesce(p_details->'homeAddress',candidate->'homeAddress',candidate->'address'));
  present:=manpower_private.validate_employee_address(coalesce(p_details->'presentAddress',candidate->'presentAddress',candidate->'address'));
  -- The existing employee-number index is global, not tenant-local. Other writer
  -- collisions still fail atomically at that index; never accept a browser number.
  perform pg_advisory_xact_lock(hashtextextended('hris:employee-number-allocation',0));
  select coalesce(max(substr(data->>'employeeNo',5)::integer),0)+1 into employee_number from public.hr_records
    where module='employees' and data->>'employeeNo' ~ '^EMP-[0-9]{6}$';
  if employee_number>999999 then raise exception 'Six-digit employee sequence exhausted' using errcode='23514';end if;
  employee_id:=gen_random_uuid()::text;actor_name:=coalesce(actor.full_name,'HR user');
  employee:=jsonb_build_object('id',employee_id,'employeeNo','EMP-'||lpad(employee_number::text,6,'0'),
    'prfNumber',request.prf_number,'lastName',btrim(candidate->>'lastName'),'firstName',btrim(candidate->>'firstName'),
    'middleName',btrim(coalesce(candidate->>'middleName','')),
    'name',btrim(candidate->>'lastName')||', '||btrim(candidate->>'firstName')||case when btrim(coalesce(candidate->>'middleName',''))='' then '' else ' '||btrim(candidate->>'middleName') end,
    'position',candidate->>'positionApplied','department',candidate->>'department','branchReporting',p_details->>'branchReporting',
    'dailyRate',coalesce(nullif(p_details->'dailyRate','null'::jsonb),'""'::jsonb),'allowances',allowances,
    'dateHired',candidate->>'proposedStartDate','birthDate',candidate->>'birthDate','gender',candidate->>'gender',
    'civilStatus',coalesce(candidate->>'civilStatus',''),'status','Active','statusReason','Active / Normal',
    'employmentType',p_details->>'employmentType','statusDate','','classOverride','Auto',
    'mobileNumber',coalesce(candidate->>'mobileNumber',''),'personalEmail',coalesce(candidate->>'personalEmail',''),
    'homeAddress',home,'presentAddress',present,'address',home->>'formattedAddress','presentAddressText',present->>'formattedAddress',
    'emergencyContactName','','emergencyContactRelationship','','emergencyContactPhone','','sourceCandidateId',p_candidate,
    'createdAt',now(),'createdBy',auth.uid(),'createdByName',actor_name,'updatedAt',now(),'updatedBy',auth.uid(),'updatedByName',actor_name,
    'recordHistory',jsonb_build_array(jsonb_build_object('action','Created','at',now(),'by',actor_name,'byId',auth.uid(),'detail','Converted from Onboarding & Applicants')),
    'employmentHistory',jsonb_build_array(jsonb_build_object('type','Hiring','from','Applicant','to','Active','statusReason','Active / Normal',
      'employmentType',p_details->>'employmentType','effectiveDate',candidate->>'proposedStartDate','remarks','Converted from Onboarding & Applicants','changedAt',now(),'changedBy',actor_name)))||ids;
  if not coalesce(public.current_user_scope_allows(employee_id,employee),false) then raise exception 'New employee outside your access' using errcode='42501';end if;
  insert into public.hr_records(tenant_id,module,record_id,data,updated_at,updated_by) values(tenant,'employees',employee_id,employee,now(),auth.uid());
  -- A namespaced deterministic token separates creation from ordinary handoff retries.
  result:=public.handoff_manpower_employee('new-hire:'||md5(p_token),p_candidate,employee_id,p_candidate_fingerprint,md5(employee::text),btrim(p_reason),0);
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action) values(tenant,auth.uid(),actor_name,
    format('New employee created from applicant [%s/%s], reservation %s. Reason: %s',p_candidate,employee_id,result->>'reservation_id',btrim(p_reason))) returning id into audit_event;
  insert into manpower_private.new_employee_batches(tenant_id,actor_id,token,payload,candidate_id,employee_id,reservation_id,audit_id)
    values(tenant,auth.uid(),p_token,payload,p_candidate,employee_id,(result->>'reservation_id')::uuid,audit_event);
  return jsonb_build_object('employee_id',employee_id,'reservation_id',result->>'reservation_id','replayed',false);
end $$;
revoke all on function public.create_manpower_employee(text,text,text,jsonb,text) from public,anon;
grant execute on function public.create_manpower_employee(text,text,text,jsonb,text) to authenticated;
commit;
