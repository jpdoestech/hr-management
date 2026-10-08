begin;

-- Phase 24: Employee Relations due-process records.
-- Run after Phase 23. This migration is additive: existing NTE, NOD, case,
-- attachment, and legacy response fields remain untouched and readable.

create table if not exists public.hr_case_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  response_type text not null default 'Written Explanation'
    check (response_type in ('Written Explanation','Verbal Statement','No Response','Declined')),
  status text not null default 'Received'
    check (status in ('Received','No Response','Withdrawn')),
  received_at timestamptz,
  written_explanation text,
  evidence_summary text,
  witnesses_identified text,
  hearing_requested boolean not null default false,
  hr_notes text,
  attachment_name text,
  attachment_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'Received' or received_at is not null),
  check (response_type <> 'No Response' or status = 'No Response')
);

create index if not exists hr_case_responses_case_idx
  on public.hr_case_responses(tenant_id,case_id,received_at desc,created_at desc);

create table if not exists public.hr_case_hearings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  hearing_type text not null default 'Administrative Conference'
    check (hearing_type in ('Administrative Conference','Clarificatory Meeting','Formal Hearing','Other')),
  status text not null default 'Scheduled'
    check (status in ('Scheduled','Held','Cancelled','Not Required')),
  scheduled_at timestamptz,
  held_at timestamptz,
  location_or_channel text,
  attendees text,
  employee_requested boolean not null default false,
  no_hearing_reason text,
  minutes text,
  outcome_notes text,
  attachment_name text,
  attachment_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'Scheduled' or scheduled_at is not null),
  check (status <> 'Held' or held_at is not null),
  check (status <> 'Not Required' or length(trim(coalesce(no_hearing_reason,''))) > 0)
);

create index if not exists hr_case_hearings_case_idx
  on public.hr_case_hearings(tenant_id,case_id,scheduled_at desc,created_at desc);

create table if not exists public.hr_case_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  decision_status text not null default 'Draft'
    check (decision_status in ('Draft','For Approval','Approved','Returned','Superseded','Reversed')),
  decision_date date,
  decision_maker uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approval_date timestamptz,
  review_notes text,
  overall_outcome text
    check (overall_outcome is null or overall_outcome in (
      'Substantiated','Partially Substantiated','Unsubstantiated',
      'No Policy Violation','Administrative Closure'
    )),
  reasoning text,
  mitigating_factors text,
  aggravating_factors text,
  tda_recommended_action text,
  proposed_action text,
  final_action text,
  effective_date date,
  deviation_from_tda boolean not null default false,
  deviation_reason text,
  nod_record_id text,
  nod_status text not null default 'Not Prepared'
    check (nod_status in ('Not Prepared','Draft','Finalized','Issued','Served')),
  nod_number text,
  nod_issued_at date,
  nod_served_at date,
  nod_service_method text,
  employee_acknowledged boolean,
  reconsideration_info text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,case_id,version),
  check (not deviation_from_tda or length(trim(coalesce(deviation_reason,''))) > 0)
);

create unique index if not exists hr_case_decisions_active_case_idx
  on public.hr_case_decisions(tenant_id,case_id)
  where decision_status not in ('Superseded','Reversed');

create index if not exists hr_case_decisions_status_idx
  on public.hr_case_decisions(tenant_id,decision_status,updated_at desc);

create or replace function public.enforce_hr_case_decision_approval()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  approval_change boolean;
  protected_change boolean;
begin
  if tg_op='INSERT' then
    approval_change := new.decision_status in ('Approved','Returned');
  else
    approval_change := new.decision_status in ('Approved','Returned')
      and old.decision_status is distinct from new.decision_status;
  end if;

  if approval_change and not public.current_user_has_permission('employee_relations.approve') then
    raise exception 'Employee Relations approval permission is required.' using errcode='42501';
  end if;

  if new.decision_status='Approved' then
    if not exists(select 1 from public.hr_case_allegations a where a.case_id=new.case_id)
      or exists(select 1 from public.hr_case_allegations a where a.case_id=new.case_id and a.finding='Pending') then
      raise exception 'Every case allegation must have a final finding before decision approval.' using errcode='23514';
    end if;
    if new.overall_outcome is null
      or length(trim(coalesce(new.reasoning,'')))=0
      or length(trim(coalesce(new.final_action,'')))=0
      or new.decision_date is null then
      raise exception 'Outcome, reasoning, final action, and decision date are required for approval.' using errcode='23514';
    end if;
    if new.deviation_from_tda and length(trim(coalesce(new.deviation_reason,'')))=0 then
      raise exception 'A reason is required when the final action deviates from the TDA recommendation.' using errcode='23514';
    end if;
    if approval_change then
      new.approved_by := auth.uid();
      new.approval_date := coalesce(new.approval_date,now());
    end if;
  end if;

  if tg_op='UPDATE' then
    if old.decision_status='Approved' then
      protected_change := new.decision_date is distinct from old.decision_date
      or new.overall_outcome is distinct from old.overall_outcome
      or new.reasoning is distinct from old.reasoning
      or new.review_notes is distinct from old.review_notes
      or new.mitigating_factors is distinct from old.mitigating_factors
      or new.aggravating_factors is distinct from old.aggravating_factors
      or new.tda_recommended_action is distinct from old.tda_recommended_action
      or new.proposed_action is distinct from old.proposed_action
      or new.final_action is distinct from old.final_action
      or new.effective_date is distinct from old.effective_date
      or new.deviation_from_tda is distinct from old.deviation_from_tda
      or new.deviation_reason is distinct from old.deviation_reason;
      if protected_change then
        raise exception 'Approved decision content is immutable. Supersede or reverse it through an authorized workflow.' using errcode='23514';
      end if;
      if new.decision_status is distinct from old.decision_status
        and new.decision_status not in ('Superseded','Reversed') then
        raise exception 'An approved decision may only be superseded or reversed.' using errcode='23514';
      end if;
      if new.decision_status in ('Superseded','Reversed')
        and not public.current_user_has_permission('employee_relations.approve') then
        raise exception 'Employee Relations approval permission is required.' using errcode='42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_hr_case_decision_approval on public.hr_case_decisions;
create trigger enforce_hr_case_decision_approval
before insert or update on public.hr_case_decisions
for each row execute function public.enforce_hr_case_decision_approval();

do $$
declare
  table_name text;
begin
  foreach table_name in array array['hr_case_responses','hr_case_hearings','hr_case_decisions'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I',table_name,table_name);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute procedure public.set_updated_at()',table_name,table_name);
    execute format('drop trigger if exists enforce_tenant_write on public.%I',table_name);
    execute format('create trigger enforce_tenant_write before insert or update or delete on public.%I for each row execute function public.enforce_current_tenant_write()',table_name);
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists tenant_isolation on public.%I',table_name);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id=public.current_tenant_id()) with check (tenant_id=public.current_tenant_id())',table_name);
  end loop;
end
$$;

drop policy if exists hr_case_responses_select on public.hr_case_responses;
create policy hr_case_responses_select on public.hr_case_responses for select to authenticated using (
  exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_responses_insert on public.hr_case_responses;
create policy hr_case_responses_insert on public.hr_case_responses for insert to authenticated with check (
  created_by=auth.uid()
  and (public.current_user_has_permission('employee_relations.create') or public.current_user_has_permission('employee_relations.update'))
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_responses_update on public.hr_case_responses;
create policy hr_case_responses_update on public.hr_case_responses for update to authenticated using (
  public.current_user_has_permission('employee_relations.update')
  and exists(select 1 from public.hr_cases c where c.id=case_id)
) with check (
  updated_by=auth.uid()
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_responses_delete on public.hr_case_responses;
create policy hr_case_responses_delete on public.hr_case_responses for delete to authenticated using (
  public.current_user_has_permission('employee_relations.delete')
  and status='Withdrawn'
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);

drop policy if exists hr_case_hearings_select on public.hr_case_hearings;
create policy hr_case_hearings_select on public.hr_case_hearings for select to authenticated using (
  exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_hearings_insert on public.hr_case_hearings;
create policy hr_case_hearings_insert on public.hr_case_hearings for insert to authenticated with check (
  created_by=auth.uid()
  and (public.current_user_has_permission('employee_relations.create') or public.current_user_has_permission('employee_relations.update'))
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_hearings_update on public.hr_case_hearings;
create policy hr_case_hearings_update on public.hr_case_hearings for update to authenticated using (
  public.current_user_has_permission('employee_relations.update')
  and exists(select 1 from public.hr_cases c where c.id=case_id)
) with check (
  updated_by=auth.uid()
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_hearings_delete on public.hr_case_hearings;
create policy hr_case_hearings_delete on public.hr_case_hearings for delete to authenticated using (
  public.current_user_has_permission('employee_relations.delete')
  and status in ('Cancelled','Not Required')
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);

drop policy if exists hr_case_decisions_select on public.hr_case_decisions;
create policy hr_case_decisions_select on public.hr_case_decisions for select to authenticated using (
  exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_decisions_insert on public.hr_case_decisions;
create policy hr_case_decisions_insert on public.hr_case_decisions for insert to authenticated with check (
  created_by=auth.uid()
  and (public.current_user_has_permission('employee_relations.create') or public.current_user_has_permission('employee_relations.update'))
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_decisions_update on public.hr_case_decisions;
create policy hr_case_decisions_update on public.hr_case_decisions for update to authenticated using (
  (public.current_user_has_permission('employee_relations.update') or public.current_user_has_permission('employee_relations.approve'))
  and exists(select 1 from public.hr_cases c where c.id=case_id)
) with check (
  updated_by=auth.uid()
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);
drop policy if exists hr_case_decisions_delete on public.hr_case_decisions;
create policy hr_case_decisions_delete on public.hr_case_decisions for delete to authenticated using (
  public.current_user_has_permission('employee_relations.delete')
  and decision_status in ('Draft','Returned')
  and exists(select 1 from public.hr_cases c where c.id=case_id)
);

comment on table public.hr_case_responses is
  'Separate employee response events for an Employee Relations case; legacy inline NTE explanation text is preserved outside this table.';
comment on table public.hr_case_hearings is
  'Optional administrative conference/hearing events, including an explicit not-required outcome.';
comment on table public.hr_case_decisions is
  'Versioned decision and NOD-finalization metadata with approval guarded by Employee Relations RBAC.';

commit;
