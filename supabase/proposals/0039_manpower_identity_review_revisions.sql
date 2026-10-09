-- Gated follow-on to 0038: preserve every review and audit, never merge sources.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_manpower_identity_reviews in share row exclusive mode;
alter table public.hr_manpower_identity_reviews add column revision bigint not null default 1 check(revision>0);
alter table public.hr_manpower_identity_reviews add column supersedes_audit_id uuid references public.hr_audit_logs(id);
alter table public.hr_manpower_identity_reviews drop constraint hr_manpower_identity_reviews_pkey;
alter table public.hr_manpower_identity_reviews add primary key(tenant_id,candidate_id,employee_id,revision);
alter table public.hr_manpower_identity_reviews add constraint manpower_identity_revision_decision_unique
  unique(tenant_id,candidate_id,employee_id,revision,decision);
drop index public.manpower_identity_one_employee_per_candidate;

-- One current link points to its immutable evidence; historical SamePerson facts stay intact.
create table public.hr_manpower_identity_links (
  tenant_id uuid not null,
  candidate_id text not null,
  employee_id text not null,
  revision bigint not null,
  decision text not null default 'SamePerson' check(decision='SamePerson'),
  primary key(tenant_id,candidate_id),
  foreign key(tenant_id,candidate_id,employee_id,revision,decision)
    references public.hr_manpower_identity_reviews(tenant_id,candidate_id,employee_id,revision,decision)
);
insert into public.hr_manpower_identity_links(tenant_id,candidate_id,employee_id,revision)
  select tenant_id,candidate_id,employee_id,revision from public.hr_manpower_identity_reviews where decision='SamePerson';
alter table public.hr_manpower_identity_links enable row level security;
revoke all on public.hr_manpower_identity_links from public,anon,authenticated;
grant select on public.hr_manpower_identity_links to authenticated;
create policy manpower_identity_links_read on public.hr_manpower_identity_links for select to authenticated
using(tenant_id=public.current_tenant_id() and public.can_review_manpower_identity(candidate_id,employee_id));

create or replace function public.preview_manpower_identity_review(p_candidate text,p_employee text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate jsonb;employee jsonb;previous public.hr_manpower_identity_reviews;
begin
  if not public.can_review_manpower_identity(p_candidate,p_employee) then
    raise exception 'Identity review unavailable or outside your access' using errcode='42501';
  end if;
  select data into candidate from public.hr_records where tenant_id=public.current_tenant_id() and module='onboardingCandidates' and record_id=p_candidate;
  select data into employee from public.hr_records where tenant_id=public.current_tenant_id() and module='employees' and record_id=p_employee;
  if candidate is null or employee is null then raise exception 'Source records changed. Reload the review.' using errcode='40001';end if;
  select * into previous from public.hr_manpower_identity_reviews where tenant_id=public.current_tenant_id()
    and candidate_id=p_candidate and employee_id=p_employee order by revision desc limit 1;
  return jsonb_build_object('candidate_id',p_candidate,'employee_id',p_employee,
    'candidate_name',candidate->>'name','employee_name',employee->>'name',
    'candidate_department',candidate->>'department','employee_department',employee->>'department',
    'linked_employee_id',candidate->>'employeeRecordId',
    'candidate_fingerprint',md5(candidate::text),'employee_fingerprint',md5(employee::text),
    'review_revision',coalesce(previous.revision,0),'previous_decision',previous.decision,
    'source_changed',previous.revision is not null and (previous.candidate_fingerprint<>md5(candidate::text) or previous.employee_fingerprint<>md5(employee::text)));
end $$;

create function public.record_manpower_identity_review(p_candidate text,p_employee text,p_decision text,p_reason text,
  p_candidate_fingerprint text,p_employee_fingerprint text,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  active_tenant uuid:=public.current_tenant_id();actor public.profiles;
  candidate jsonb;employee jsonb;audit_event uuid;saved public.hr_manpower_identity_reviews;
  previous public.hr_manpower_identity_reviews;linked_employee text;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.tenant_id is distinct from active_tenant or not public.can_review_manpower_identity(p_candidate,p_employee) then
    raise exception 'Identity review unavailable or outside your access' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision<0 or p_decision is null or p_decision not in ('SamePerson','SeparatePersons')
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Select a decision, current revision and reason (1-1000 characters)' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(active_tenant::text||':identity:'||p_candidate,0));
  select data into candidate from public.hr_records where tenant_id=active_tenant and module='onboardingCandidates' and record_id=p_candidate for share;
  select data into employee from public.hr_records where tenant_id=active_tenant and module='employees' and record_id=p_employee for share;
  if candidate is null or employee is null or not public.can_review_manpower_identity(p_candidate,p_employee)
    or md5(candidate::text) is distinct from p_candidate_fingerprint or md5(employee::text) is distinct from p_employee_fingerprint then
    raise exception 'Source records changed. Reload the review.' using errcode='40001';
  end if;
  select * into previous from public.hr_manpower_identity_reviews where tenant_id=active_tenant
    and candidate_id=p_candidate and employee_id=p_employee order by revision desc limit 1;
  if coalesce(previous.revision,0)<>p_expected_revision then
    raise exception 'Identity review changed. Reload before recording a decision.' using errcode='40001';
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
  if p_expected_revision>0 then
    -- Do not change identity evidence beneath existing assignments or unknown future ledgers.
    if exists(select 1 from public.hr_records where tenant_id=active_tenant and module='manpowerSlots'
      and (data->>'candidateId'=p_candidate or data->>'employeeId'=p_employee))
      or to_regclass('public.hr_manpower_reservations') is not null
      or to_regclass('public.hr_manpower_deployments') is not null then
      raise exception 'Assignment dependencies require reconciliation before identity re-review' using errcode='23514';
    end if;
  end if;
  select employee_id into linked_employee from public.hr_manpower_identity_links where tenant_id=active_tenant and candidate_id=p_candidate for update;
  if p_decision='SamePerson' and linked_employee is not null and linked_employee<>p_employee then
    raise exception 'Resolve the current identity link before choosing a different employee' using errcode='23514';
  end if;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(active_tenant,auth.uid(),coalesce(actor.full_name,'HR user'),
      format('Applicant identity reviewed [%s/%s], revision %s: %s. Reason: %s',p_candidate,p_employee,p_expected_revision+1,p_decision,btrim(p_reason)))
    returning id into audit_event;
  insert into public.hr_manpower_identity_reviews(tenant_id,candidate_id,employee_id,revision,decision,reason,
    candidate_fingerprint,employee_fingerprint,reviewed_by,audit_id,supersedes_audit_id)
    values(active_tenant,p_candidate,p_employee,p_expected_revision+1,p_decision,btrim(p_reason),
      md5(candidate::text),md5(employee::text),auth.uid(),audit_event,previous.audit_id) returning * into saved;
  if p_decision='SamePerson' then
    insert into public.hr_manpower_identity_links(tenant_id,candidate_id,employee_id,revision)
      values(active_tenant,p_candidate,p_employee,saved.revision)
      on conflict(tenant_id,candidate_id) do update set revision=excluded.revision;
  elsif linked_employee=p_employee then
    delete from public.hr_manpower_identity_links where tenant_id=active_tenant and candidate_id=p_candidate;
  end if;
  return to_jsonb(saved);
end $$;

-- Older callers can record an initial review, never silently overwrite/re-review.
create or replace function public.record_manpower_identity_review(p_candidate text,p_employee text,p_decision text,p_reason text,
  p_candidate_fingerprint text,p_employee_fingerprint text) returns jsonb
language sql security definer set search_path=public as $$
  select public.record_manpower_identity_review($1,$2,$3,$4,$5,$6,0::bigint);
$$;
revoke all on function public.record_manpower_identity_review(text,text,text,text,text,text,bigint) from public,anon;
grant execute on function public.record_manpower_identity_review(text,text,text,text,text,text,bigint) to authenticated;
commit;
