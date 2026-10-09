-- Stage B foundation only: no conversion/merge/reservation or automatic migration.
-- Reconcile the live baseline before promotion; explicitly assign review permission.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
insert into public.access_permissions(permission_key,module_key,action_key,label)
values('onboarding.review_identity','onboarding','review_identity','Review applicant/employee identity')
on conflict(permission_key) do nothing;

create table public.hr_manpower_identity_reviews (
  tenant_id uuid not null references public.hr_tenants(id),
  candidate_id text not null,
  employee_id text not null,
  decision text not null check(decision in ('SamePerson','SeparatePersons')),
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  candidate_fingerprint text not null,
  employee_fingerprint text not null,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid not null references auth.users(id),
  audit_id uuid not null references public.hr_audit_logs(id),
  primary key(tenant_id,candidate_id,employee_id)
);
create unique index manpower_identity_one_employee_per_candidate
  on public.hr_manpower_identity_reviews(tenant_id,candidate_id) where decision='SamePerson';
alter table public.hr_manpower_identity_reviews enable row level security;
revoke all on public.hr_manpower_identity_reviews from public,anon,authenticated;
grant select on public.hr_manpower_identity_reviews to authenticated;

create function public.can_review_manpower_identity(p_candidate text,p_employee text) returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null
    and coalesce(public.current_user_has_permission('onboarding.view'),false)
    and coalesce(public.current_user_has_permission('employees.view'),false)
    and coalesce(public.current_user_has_permission('onboarding.review_identity'),false)
    and exists(select 1 from public.hr_records candidate join public.hr_records employee
      on employee.tenant_id=candidate.tenant_id
      where candidate.tenant_id=public.current_tenant_id()
        and candidate.module='onboardingCandidates' and candidate.record_id=p_candidate
        and employee.module='employees' and employee.record_id=p_employee
        and coalesce(public.current_user_scope_allows(candidate.record_id,candidate.data),false)
        and coalesce(public.current_user_scope_allows(employee.record_id,employee.data),false));
$$;
revoke all on function public.can_review_manpower_identity(text,text) from public,anon;
grant execute on function public.can_review_manpower_identity(text,text) to authenticated;
create policy manpower_identity_reviews_read on public.hr_manpower_identity_reviews for select to authenticated
using(tenant_id=public.current_tenant_id() and public.can_review_manpower_identity(candidate_id,employee_id));

-- Preview exposes only necessary comparison fields, not addresses/government IDs.
create function public.preview_manpower_identity_review(p_candidate text,p_employee text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate jsonb;employee jsonb;
begin
  if not public.can_review_manpower_identity(p_candidate,p_employee) then
    raise exception 'Identity review unavailable or outside your access' using errcode='42501';
  end if;
  select data into candidate from public.hr_records where tenant_id=public.current_tenant_id() and module='onboardingCandidates' and record_id=p_candidate;
  select data into employee from public.hr_records where tenant_id=public.current_tenant_id() and module='employees' and record_id=p_employee;
  if candidate is null or employee is null then raise exception 'Source records changed. Reload the review.' using errcode='40001';end if;
  return jsonb_build_object('candidate_id',p_candidate,'employee_id',p_employee,
    'candidate_name',candidate->>'name','employee_name',employee->>'name',
    'candidate_department',candidate->>'department','employee_department',employee->>'department',
    'linked_employee_id',candidate->>'employeeRecordId',
    'candidate_fingerprint',md5(candidate::text),'employee_fingerprint',md5(employee::text));
end $$;

create function public.record_manpower_identity_review(p_candidate text,p_employee text,p_decision text,p_reason text,
  p_candidate_fingerprint text,p_employee_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  active_tenant uuid:=public.current_tenant_id();actor public.profiles;
  candidate jsonb;employee jsonb;audit_event uuid;saved public.hr_manpower_identity_reviews;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.tenant_id is distinct from active_tenant or not public.can_review_manpower_identity(p_candidate,p_employee) then
    raise exception 'Identity review unavailable or outside your access' using errcode='42501';
  end if;
  if p_decision is null or p_decision not in ('SamePerson','SeparatePersons') or p_reason is null
    or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Select a decision and provide a reason (1-1000 characters)' using errcode='23514';
  end if;
  -- Serialize all decisions for one applicant, not only one comparison pair.
  perform pg_advisory_xact_lock(hashtextextended(active_tenant::text||':identity:'||p_candidate,0));
  select data into candidate from public.hr_records
    where tenant_id=active_tenant and module='onboardingCandidates' and record_id=p_candidate for share;
  select data into employee from public.hr_records
    where tenant_id=active_tenant and module='employees' and record_id=p_employee for share;
  if candidate is null or employee is null or not public.can_review_manpower_identity(p_candidate,p_employee)
    or md5(candidate::text) is distinct from p_candidate_fingerprint or md5(employee::text) is distinct from p_employee_fingerprint then
    raise exception 'Source records changed. Reload the review.' using errcode='40001';
  end if;
  if candidate->>'id' is distinct from p_candidate or employee->>'id' is distinct from p_employee then
    raise exception 'Source record identifiers require reconciliation' using errcode='23514';
  end if;
  if nullif(candidate->>'employeeRecordId','') is not null
    and ((p_decision='SamePerson' and candidate->>'employeeRecordId'<>p_employee)
      or (p_decision='SeparatePersons' and candidate->>'employeeRecordId'=p_employee)) then
    raise exception 'Decision conflicts with the existing conversion link; reconcile it first' using errcode='23514';
  end if;
  if p_decision='SeparatePersons' and employee->>'sourceCandidateId'=p_candidate then
    raise exception 'Decision conflicts with the employee source-applicant link; reconcile it first' using errcode='23514';
  end if;
  if exists(select 1 from public.hr_manpower_identity_reviews where tenant_id=active_tenant
    and candidate_id=p_candidate and employee_id=p_employee) then
    raise exception 'A review already exists. Corrections require a controlled reconciliation workflow.' using errcode='23514';
  end if;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(active_tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
      format('Applicant identity reviewed [%s/%s]: %s. Reason: %s',p_candidate,p_employee,p_decision,btrim(p_reason)))
    returning id into audit_event;
  insert into public.hr_manpower_identity_reviews(tenant_id,candidate_id,employee_id,decision,reason,
    candidate_fingerprint,employee_fingerprint,reviewed_by,audit_id)
    values(active_tenant,p_candidate,p_employee,p_decision,btrim(p_reason),md5(candidate::text),md5(employee::text),auth.uid(),audit_event)
    returning * into saved;
  return to_jsonb(saved);
end $$;
create function public.guard_manpower_identity_review() returns trigger
language plpgsql set search_path=public as $$ begin
  raise exception 'Identity decisions are immutable; controlled correction is not enabled' using errcode='23514';
end $$;
create trigger manpower_identity_review_immutable before update or delete on public.hr_manpower_identity_reviews
  for each row execute function public.guard_manpower_identity_review();
revoke all on function public.guard_manpower_identity_review() from public,anon,authenticated;
revoke all on function public.preview_manpower_identity_review(text,text) from public,anon;
revoke all on function public.record_manpower_identity_review(text,text,text,text,text,text) from public,anon;
grant execute on function public.preview_manpower_identity_review(text,text) to authenticated;
grant execute on function public.record_manpower_identity_review(text,text,text,text,text,text) to authenticated;
commit;
