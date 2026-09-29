-- SLSC HR Management - Employee self-service and manager approvals
-- Run after the Phase 3/9 migrations in the Supabase SQL Editor.

begin;

alter table public.profiles
  add column if not exists employee_record_id text,
  add column if not exists manager_profile_id uuid references public.profiles(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('Administrator','HR Staff','Manager','Employee','Viewer'));

create index if not exists profiles_employee_record_idx on public.profiles(employee_record_id);
create index if not exists profiles_manager_idx on public.profiles(manager_profile_id);
create unique index if not exists profiles_employee_record_unique
  on public.profiles(employee_record_id) where employee_record_id is not null;

-- New public registrations must never receive staff privileges automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,full_name,username,email,role)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1))),
    lower(new.email),
    'Employee'
  )
  on conflict (id) do update set
    full_name=excluded.full_name,
    username=excluded.username,
    email=excluded.email,
    updated_at=now();
  return new;
end;
$$;

create or replace function public.current_employee_record_id()
returns text
language sql
security definer
set search_path = public
stable
as $$ select employee_record_id from public.profiles where id = auth.uid(); $$;

create or replace function public.is_managed_employee_record(p_record_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.profiles
    where manager_profile_id = auth.uid()
      and employee_record_id = p_record_id
  );
$$;

create table if not exists public.hr_service_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('profile_update','leave')),
  employee_profile_id uuid not null references public.profiles(id) on delete cascade,
  employee_record_id text not null,
  manager_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Returned','Cancelled')),
  payload jsonb not null default '{}'::jsonb,
  employee_note text,
  reviewer_remarks text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists hr_service_requests_employee_idx
  on public.hr_service_requests(employee_profile_id, submitted_at desc);
create index if not exists hr_service_requests_manager_idx
  on public.hr_service_requests(manager_profile_id, status, submitted_at desc);

alter table public.hr_service_requests enable row level security;

drop trigger if exists hr_service_requests_updated_at on public.hr_service_requests;
create trigger hr_service_requests_updated_at
before update on public.hr_service_requests
for each row execute procedure public.set_updated_at();

drop policy if exists service_requests_select on public.hr_service_requests;
create policy service_requests_select
on public.hr_service_requests
for select
to authenticated
using (
  employee_profile_id = auth.uid()
  or (
    manager_profile_id = auth.uid()
    and public.is_managed_employee_record(employee_record_id)
  )
  or public.current_profile_role() in ('Administrator','HR Staff')
);

-- Writes are intentionally routed through the validated RPC functions below.
drop policy if exists service_requests_insert on public.hr_service_requests;
drop policy if exists service_requests_update on public.hr_service_requests;
drop policy if exists service_requests_delete on public.hr_service_requests;

create or replace function public.submit_hr_service_request(
  p_request_type text,
  p_payload jsonb
)
returns public.hr_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_employee jsonb;
  v_request public.hr_service_requests%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_leave_id text := 'self-service-' || v_request_id::text;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile.id is null then raise exception 'Profile not found'; end if;
  if v_profile.employee_record_id is null or v_profile.employee_record_id = '' then
    raise exception 'Your account is not linked to an employee record';
  end if;
  if p_request_type not in ('profile_update','leave') then
    raise exception 'Unsupported request type';
  end if;
  if p_request_type = 'leave' then
    if coalesce(p_payload->>'leaveType','') = ''
      or coalesce(p_payload->>'startDate','') = ''
      or coalesce(p_payload->>'endDate','') = '' then
      raise exception 'Leave type, start date, and end date are required';
    end if;
    if (p_payload->>'endDate')::date < (p_payload->>'startDate')::date then
      raise exception 'Leave end date cannot be before the start date';
    end if;
  end if;

  insert into public.hr_service_requests(
    id,request_type,employee_profile_id,employee_record_id,manager_profile_id,payload,employee_note
  ) values (
    v_request_id,p_request_type,v_profile.id,v_profile.employee_record_id,v_profile.manager_profile_id,
    coalesce(p_payload,'{}'::jsonb),nullif(trim(coalesce(p_payload->>'note','')),'')
  ) returning * into v_request;

  if p_request_type = 'leave' then
    select data into v_employee
    from public.hr_records
    where module='employees' and record_id=v_profile.employee_record_id;

    insert into public.hr_records(module,record_id,data,updated_by)
    values(
      'leaves',v_leave_id,
      jsonb_build_object(
        'id',v_leave_id,
        '_dataResetAt',coalesce((select data->>'dataResetAt' from public.hr_settings where id='singleton'),''),
        'employeeId',v_profile.employee_record_id,
        'employeeName',coalesce(v_employee->>'name',v_profile.full_name),
        'position',coalesce(v_employee->>'position',''),
        'department',coalesce(v_employee->>'department',''),
        'leaveType',p_payload->>'leaveType',
        'startDate',p_payload->>'startDate',
        'endDate',p_payload->>'endDate',
        'dateApplied',current_date::text,
        'dateReceived',current_date::text,
        'reason',coalesce(p_payload->>'reason',''),
        'attachment','',
        'status','Pending',
        'remarks','Submitted through Employee Self-Service',
        'serviceRequestId',v_request_id::text
      ),
      auth.uid()
    );
  end if;

  insert into public.hr_audit_logs(user_id,user_name,action)
  values(auth.uid(),v_profile.full_name,'Submitted ' || replace(p_request_type,'_',' ') || ' request');
  return v_request;
end;
$$;

create or replace function public.review_hr_service_request(
  p_request_id uuid,
  p_decision text,
  p_remarks text default null
)
returns public.hr_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.hr_service_requests%rowtype;
  v_role text := public.current_profile_role();
  v_patch jsonb := '{}'::jsonb;
  v_reviewer_name text;
begin
  if p_decision not in ('Approved','Returned') then
    raise exception 'Decision must be Approved or Returned';
  end if;
  select * into v_request from public.hr_service_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Request not found'; end if;
  if v_request.status <> 'Pending' then raise exception 'This request has already been reviewed'; end if;
  if v_role not in ('Administrator','HR Staff')
    and not (
      v_role='Manager'
      and v_request.manager_profile_id=auth.uid()
      and public.is_managed_employee_record(v_request.employee_record_id)
    ) then
    raise exception 'You are not authorized to review this request';
  end if;

  if v_request.request_type='profile_update' and p_decision='Approved' then
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_patch
    from jsonb_each(v_request.payload)
    where key in (
      'mobileNumber','personalEmail','address','homeAddress','presentAddress','presentAddressText','civilStatus',
      'emergencyContactName','emergencyContactRelationship','emergencyContactPhone'
    );
    update public.hr_records
    set data=data || v_patch, updated_by=auth.uid()
    where module='employees' and record_id=v_request.employee_record_id;
  elsif v_request.request_type='leave' then
    update public.hr_records
    set data=jsonb_set(
      jsonb_set(data,'{status}',to_jsonb(case when p_decision='Approved' then 'Approved' else 'Disapproved' end::text)),
      '{remarks}',to_jsonb(coalesce(nullif(trim(p_remarks),''),case when p_decision='Approved' then 'Approved through Manager Self-Service' else 'Returned by reviewer' end))
    ), updated_by=auth.uid()
    where module='leaves' and data->>'serviceRequestId'=p_request_id::text;
  end if;

  update public.hr_service_requests
  set status=p_decision,reviewer_remarks=nullif(trim(coalesce(p_remarks,'')),''),
      reviewed_at=now(),reviewed_by=auth.uid()
  where id=p_request_id
  returning * into v_request;

  select full_name into v_reviewer_name from public.profiles where id=auth.uid();
  insert into public.hr_audit_logs(user_id,user_name,action)
  values(auth.uid(),v_reviewer_name,p_decision || ' employee ' || replace(v_request.request_type,'_',' ') || ' request');
  return v_request;
end;
$$;

create or replace function public.cancel_hr_service_request(p_request_id uuid)
returns public.hr_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare v_request public.hr_service_requests%rowtype;
begin
  update public.hr_service_requests
  set status='Cancelled'
  where id=p_request_id and employee_profile_id=auth.uid() and status='Pending'
  returning * into v_request;
  if v_request.id is null then raise exception 'Pending request not found'; end if;
  if v_request.request_type='leave' then
    update public.hr_records
    set data=jsonb_set(data,'{status}',to_jsonb('Disapproved'::text)),updated_by=auth.uid()
    where module='leaves' and data->>'serviceRequestId'=p_request_id::text;
  end if;
  return v_request;
end;
$$;

revoke all on function public.submit_hr_service_request(text,jsonb) from public;
revoke all on function public.review_hr_service_request(uuid,text,text) from public;
revoke all on function public.cancel_hr_service_request(uuid) from public;
grant execute on function public.submit_hr_service_request(text,jsonb) to authenticated;
grant execute on function public.review_hr_service_request(uuid,text,text) to authenticated;
grant execute on function public.cancel_hr_service_request(uuid) to authenticated;

-- Profile visibility supports administrators, HR, and direct-report managers.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id=auth.uid()
  or public.current_profile_role() in ('Administrator','HR Staff')
  or manager_profile_id=auth.uid()
);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (
  id=auth.uid()
  and role='Employee'
  and employee_record_id is null
  and manager_profile_id is null
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (public.current_profile_role()='Administrator')
with check (public.current_profile_role()='Administrator');

-- Limit HR record reads for the new portal roles to their own/team records.
drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select on public.hr_records for select to authenticated using (
  public.current_profile_role() in ('Administrator','HR Staff','Viewer')
  or (
    module in ('employees','leaves','evaluations','documents')
    and (
      record_id=public.current_employee_record_id()
      or data->>'employeeId'=public.current_employee_record_id()
      or public.is_managed_employee_record(record_id)
      or public.is_managed_employee_record(data->>'employeeId')
    )
  )
);

-- Employee and Manager roles cannot write HR records directly.
drop policy if exists hr_records_insert on public.hr_records;
create policy hr_records_insert on public.hr_records for insert to authenticated
with check (public.current_profile_role() in ('Administrator','HR Staff'));
drop policy if exists hr_records_update on public.hr_records;
create policy hr_records_update on public.hr_records for update to authenticated
using (public.current_profile_role() in ('Administrator','HR Staff'))
with check (public.current_profile_role() in ('Administrator','HR Staff'));
drop policy if exists hr_records_delete on public.hr_records;
create policy hr_records_delete on public.hr_records for delete to authenticated
using (public.current_profile_role() in ('Administrator','HR Staff'));

drop policy if exists hr_audit_select on public.hr_audit_logs;
create policy hr_audit_select on public.hr_audit_logs for select to authenticated
using (public.current_profile_role() in ('Administrator','HR Staff'));

drop policy if exists legacy_state_select on public.hr_app_state;
create policy legacy_state_select on public.hr_app_state for select to authenticated
using (public.current_profile_role() in ('Administrator','HR Staff','Viewer'));

drop policy if exists hr_documents_select on storage.objects;
create policy hr_documents_select on storage.objects for select to authenticated using (
  bucket_id='hr-documents'
  and (
    public.current_profile_role() in ('Administrator','HR Staff','Viewer')
    or (storage.foldername(name))[1]=auth.uid()::text
  )
);
drop policy if exists hr_documents_insert on storage.objects;
create policy hr_documents_insert on storage.objects for insert to authenticated with check (
  bucket_id='hr-documents'
  and public.current_profile_role() in ('Administrator','HR Staff')
  and (storage.foldername(name))[1]=auth.uid()::text
);
drop policy if exists hr_documents_delete on storage.objects;
create policy hr_documents_delete on storage.objects for delete to authenticated using (
  bucket_id='hr-documents'
  and public.current_profile_role() in ('Administrator','HR Staff')
  and ((storage.foldername(name))[1]=auth.uid()::text or public.current_profile_role()='Administrator')
);

-- Cases remain private to HR, legacy viewers, or the manager assigned to the case.
drop policy if exists hr_cases_select on public.hr_cases;
create policy hr_cases_select on public.hr_cases for select to authenticated using (
  public.current_profile_role() in ('Administrator','HR Staff','Viewer')
  or (public.current_profile_role()='Manager' and assigned_to=auth.uid())
);
drop policy if exists hr_case_links_select on public.hr_case_links;
create policy hr_case_links_select on public.hr_case_links for select to authenticated using (
  exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_activity_select on public.hr_case_activity;
create policy hr_case_activity_select on public.hr_case_activity for select to authenticated using (
  exists(select 1 from public.hr_cases c where c.id=case_id)
);

commit;

