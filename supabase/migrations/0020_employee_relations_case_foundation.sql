begin;

-- Phase 23: Employee Relations case-domain foundation.
-- Run after phases 19, 20, and 22. This migration is additive and does not
-- rewrite or delete existing HR cases, source records, links, or attachments.

alter table public.hr_cases
  add column if not exists case_type text not null default 'Employee Relations',
  add column if not exists outcome text,
  add column if not exists triage_result text,
  add column if not exists triage_reason text,
  add column if not exists triaged_at timestamptz,
  add column if not exists triaged_by uuid references auth.users(id) on delete set null,
  add column if not exists legacy_workflow_status text;

alter table public.hr_cases
  drop constraint if exists hr_cases_status_check;

alter table public.hr_cases
  add constraint hr_cases_status_check check (status in (
    'Reported / Created','Under Triage','Under Investigation','NTE Preparation',
    'NTE Issued','Awaiting Employee Response','Response Received','Hearing / Conference',
    'For Findings','For Decision','Decision Approved','NOD Issued',
    'For Implementation','Implemented','Closed',
    'Closed - No Violation','Closed - Insufficient Evidence',
    'Closed - Informal Resolution','Cancelled','Duplicate',
    -- Accepted only for compatibility with records created before Phase 23.
    'Open','Memo Issued','Resolved'
  ));

alter table public.hr_cases
  drop constraint if exists hr_cases_outcome_check;

alter table public.hr_cases
  add constraint hr_cases_outcome_check check (
    outcome is null or outcome in (
      'Violation Substantiated','Partially Substantiated','No Violation',
      'Insufficient Evidence','Informal Resolution','Cancelled','Duplicate'
    )
  );

alter table public.hr_cases
  drop constraint if exists hr_cases_triage_result_check;

alter table public.hr_cases
  add constraint hr_cases_triage_result_check check (
    triage_result is null or triage_result in (
      'Needs More Information','Create HR Case','Link to Existing HR Case',
      'Refer to Coaching / Performance','Refer to Safety / Security',
      'No HR Action Required','Duplicate','Closed at Triage'
    )
  );

update public.hr_cases
set legacy_workflow_status=status
where status in ('Open','Memo Issued','Resolved')
  and legacy_workflow_status is null;

create index if not exists hr_cases_tenant_stage_updated_idx
  on public.hr_cases(tenant_id,status,updated_at desc);

create index if not exists hr_cases_tenant_employee_stage_idx
  on public.hr_cases(tenant_id,employee_record_id,status);

create table if not exists public.hr_case_allegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  allegation_number integer not null check (allegation_number > 0),
  description text not null check (length(trim(description)) between 1 and 5000),
  incident_date date,
  source_module text check (source_module is null or source_module in ('incidents','cvr')),
  source_record_id text,
  tda_rule_id text,
  tda_snapshot jsonb,
  potential_occurrence integer check (potential_occurrence is null or potential_occurrence > 0),
  alleged_policy_section text,
  status text not null default 'Open'
    check (status in ('Open','Withdrawn','Resolved')),
  finding text not null default 'Pending'
    check (finding in (
      'Pending','Substantiated','Partially Substantiated','Unsubstantiated',
      'Unfounded','Not a Policy Violation','Withdrawn'
    )),
  finding_reason text,
  confirmed_occurrence integer check (confirmed_occurrence is null or confirmed_occurrence > 0),
  final_consequence text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,case_id,allegation_number)
);

create unique index if not exists hr_case_allegations_source_unique_idx
  on public.hr_case_allegations(tenant_id,case_id,source_module,source_record_id)
  where source_module is not null and source_record_id is not null;

create index if not exists hr_case_allegations_case_idx
  on public.hr_case_allegations(tenant_id,case_id,allegation_number);

create index if not exists hr_case_allegations_employee_policy_idx
  on public.hr_case_allegations(tenant_id,tda_rule_id,finding)
  where tda_rule_id is not null;

drop trigger if exists hr_case_allegations_updated_at on public.hr_case_allegations;
create trigger hr_case_allegations_updated_at
before update on public.hr_case_allegations
for each row execute procedure public.set_updated_at();

drop trigger if exists enforce_tenant_write on public.hr_case_allegations;
create trigger enforce_tenant_write
before insert or update or delete on public.hr_case_allegations
for each row execute function public.enforce_current_tenant_write();

alter table public.hr_case_allegations enable row level security;

drop policy if exists tenant_isolation on public.hr_case_allegations;
create policy tenant_isolation on public.hr_case_allegations
as restrictive for all to authenticated
using (tenant_id=public.current_tenant_id())
with check (tenant_id=public.current_tenant_id());

-- Replace broad legacy case policies with the existing effective-access and
-- record-scope architecture. Assigned managers retain their established access.
drop policy if exists hr_cases_select on public.hr_cases;
create policy hr_cases_select on public.hr_cases for select to authenticated using (
  tenant_id=public.current_tenant_id() and (
    assigned_to=auth.uid()
    or (
      public.current_user_has_permission('employee_relations.view')
      and public.current_user_scope_allows(
        employee_record_id,
        jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
      )
    )
  )
);

drop policy if exists hr_cases_insert on public.hr_cases;
create policy hr_cases_insert on public.hr_cases for insert to authenticated with check (
  tenant_id=public.current_tenant_id()
  and created_by=auth.uid()
  and public.current_user_has_permission('employee_relations.create')
  and public.current_user_scope_allows(
    employee_record_id,
    jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
  )
);

drop policy if exists hr_cases_update on public.hr_cases;
create policy hr_cases_update on public.hr_cases for update to authenticated using (
  tenant_id=public.current_tenant_id()
  and public.current_user_has_permission('employee_relations.update')
  and public.current_user_scope_allows(
    employee_record_id,
    jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
  )
) with check (
  tenant_id=public.current_tenant_id()
  and public.current_user_has_permission('employee_relations.update')
  and public.current_user_scope_allows(
    employee_record_id,
    jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
  )
);

drop policy if exists hr_cases_delete on public.hr_cases;
create policy hr_cases_delete on public.hr_cases for delete to authenticated using (
  tenant_id=public.current_tenant_id()
  and public.current_user_has_permission('employee_relations.delete')
  and public.current_user_scope_allows(
    employee_record_id,
    jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
  )
);

drop policy if exists hr_case_allegations_select on public.hr_case_allegations;
create policy hr_case_allegations_select on public.hr_case_allegations for select to authenticated using (
  exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_allegations_insert on public.hr_case_allegations;
create policy hr_case_allegations_insert on public.hr_case_allegations for insert to authenticated with check (
  created_by=auth.uid()
  and public.current_user_has_permission('employee_relations.create')
  and exists(
    select 1 from public.hr_cases case_record
    where case_record.id=case_id and case_record.tenant_id=public.current_tenant_id()
  )
);

drop policy if exists hr_case_allegations_update on public.hr_case_allegations;
create policy hr_case_allegations_update on public.hr_case_allegations for update to authenticated using (
  public.current_user_has_permission('employee_relations.update')
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
) with check (
  updated_by=auth.uid()
  and public.current_user_has_permission('employee_relations.update')
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_allegations_delete on public.hr_case_allegations;
create policy hr_case_allegations_delete on public.hr_case_allegations for delete to authenticated using (
  public.current_user_has_permission('employee_relations.delete')
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_links_select on public.hr_case_links;
create policy hr_case_links_select on public.hr_case_links for select to authenticated using (
  exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_links_insert on public.hr_case_links;
create policy hr_case_links_insert on public.hr_case_links for insert to authenticated with check (
  linked_by=auth.uid()
  and (
    public.current_user_has_permission('employee_relations.create')
    or public.current_user_has_permission('employee_relations.update')
  )
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_links_update on public.hr_case_links;
create policy hr_case_links_update on public.hr_case_links for update to authenticated using (
  public.current_user_has_permission('employee_relations.update')
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
) with check (
  public.current_user_has_permission('employee_relations.update')
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_links_delete on public.hr_case_links;
create policy hr_case_links_delete on public.hr_case_links for delete to authenticated using (
  public.current_user_has_permission('employee_relations.update')
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_activity_select on public.hr_case_activity;
create policy hr_case_activity_select on public.hr_case_activity for select to authenticated using (
  exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

drop policy if exists hr_case_activity_insert on public.hr_case_activity;
create policy hr_case_activity_insert on public.hr_case_activity for insert to authenticated with check (
  created_by=auth.uid()
  and (
    public.current_user_has_permission('employee_relations.create')
    or public.current_user_has_permission('employee_relations.update')
  )
  and exists(select 1 from public.hr_cases case_record where case_record.id=case_id)
);

comment on column public.hr_cases.legacy_workflow_status is
  'Original pre-Phase-23 workflow value retained without silently rewriting legacy cases.';
comment on table public.hr_case_allegations is
  'Tenant-scoped allegations and per-allegation findings for the Employee Relations case workflow.';
comment on column public.hr_case_allegations.potential_occurrence is
  'Pre-decision occurrence based only on qualifying finalized disciplinary history.';
comment on column public.hr_case_allegations.confirmed_occurrence is
  'Final occurrence recorded only after an authorized qualifying finding.';

commit;

