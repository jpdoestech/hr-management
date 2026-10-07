begin;

-- Phase 25: finalized disciplinary history.
-- Run after Phase 24. Existing legacy disciplinary JSON records are preserved
-- and remain explicitly unverified until the Phase E migration/review.

create table if not exists public.hr_disciplinary_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.hr_tenants(id),
  employee_record_id text not null,
  employee_name text not null,
  department text,
  case_id uuid not null references public.hr_cases(id) on delete restrict,
  decision_id uuid not null references public.hr_case_decisions(id) on delete restrict,
  allegation_id uuid not null references public.hr_case_allegations(id) on delete restrict,
  nod_record_id text,
  tda_rule_id text,
  tda_snapshot jsonb,
  finding text not null
    check (finding in ('Substantiated','Partially Substantiated')),
  confirmed_occurrence integer check (confirmed_occurrence is null or confirmed_occurrence > 0),
  disciplinary_action text not null check (length(trim(disciplinary_action)) > 0),
  decision_date date not null,
  effective_date date,
  finalization_date date not null,
  implementation_start date,
  implementation_end date,
  implementation_status text not null default 'Pending'
    check (implementation_status in ('Pending','Not Required','In Progress','Completed','Cancelled')),
  source_type text not null default 'case_generated'
    check (source_type in ('case_generated','legacy','imported','manual_adjustment')),
  verification_status text not null default 'Verified'
    check (verification_status in ('Verified','Legacy Unverified','Pending Review','Rejected')),
  status text not null default 'Active'
    check (status in ('Active','Superseded','Reversed','Void')),
  remarks text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,case_id,decision_id,allegation_id)
);

create index if not exists hr_disciplinary_history_employee_idx
  on public.hr_disciplinary_history(tenant_id,employee_record_id,effective_date desc,finalization_date desc);

create index if not exists hr_disciplinary_history_tda_idx
  on public.hr_disciplinary_history(tenant_id,employee_record_id,tda_rule_id,status,confirmed_occurrence desc)
  where tda_rule_id is not null;

create index if not exists hr_disciplinary_history_case_idx
  on public.hr_disciplinary_history(tenant_id,case_id,decision_id);

create unique index if not exists hr_disciplinary_history_active_occurrence_idx
  on public.hr_disciplinary_history(tenant_id,employee_record_id,tda_rule_id,confirmed_occurrence)
  where tda_rule_id is not null
    and confirmed_occurrence is not null
    and verification_status='Verified'
    and status='Active';

create or replace function public.generate_case_disciplinary_history(p_decision_id uuid)
returns integer
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  decision_record public.hr_case_decisions%rowtype;
  case_record public.hr_cases%rowtype;
  allegation_record public.hr_case_allegations%rowtype;
  occurrence_value integer;
  history_record public.hr_disciplinary_history%rowtype;
  finalized_on date;
  generated_count integer := 0;
begin
  select * into decision_record
  from public.hr_case_decisions
  where id=p_decision_id;

  if not found
    or decision_record.decision_status <> 'Approved'
    or coalesce(decision_record.overall_outcome,'') not in ('Substantiated','Partially Substantiated')
    or decision_record.nod_status not in ('Finalized','Issued','Served')
    or nullif(trim(coalesce(decision_record.nod_record_id,'')),'') is null then
    return 0;
  end if;

  select * into case_record
  from public.hr_cases
  where id=decision_record.case_id and tenant_id=decision_record.tenant_id;

  if not found or nullif(trim(coalesce(case_record.employee_record_id,'')),'') is null then
    raise exception 'A stable employee record ID is required before disciplinary history can be generated.' using errcode='23514';
  end if;

  finalized_on := coalesce(
    decision_record.nod_served_at,
    decision_record.nod_issued_at,
    decision_record.approval_date::date,
    decision_record.decision_date,
    current_date
  );

  for allegation_record in
    select *
    from public.hr_case_allegations
    where case_id=decision_record.case_id
      and tenant_id=decision_record.tenant_id
      and finding in ('Substantiated','Partially Substantiated')
    order by allegation_number
  loop
    occurrence_value := null;
    if allegation_record.tda_rule_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(
        concat_ws('|',decision_record.tenant_id::text,case_record.employee_record_id,allegation_record.tda_rule_id),0
      ));

      -- Preserve an already-issued occurrence when the same finalized NOD is
      -- saved again. This makes generation idempotent even after later cases
      -- for the same employee and TDA rule have been finalized.
      select h.confirmed_occurrence
      into occurrence_value
      from public.hr_disciplinary_history h
      where h.tenant_id=decision_record.tenant_id
        and h.case_id=decision_record.case_id
        and h.decision_id=decision_record.id
        and h.allegation_id=allegation_record.id;

      if occurrence_value is null then
        select coalesce(max(h.confirmed_occurrence),0)+1
        into occurrence_value
        from public.hr_disciplinary_history h
        where h.tenant_id=decision_record.tenant_id
        and h.employee_record_id=case_record.employee_record_id
        and h.tda_rule_id=allegation_record.tda_rule_id
        and h.verification_status='Verified'
        and h.status='Active';
      end if;
    end if;

    insert into public.hr_disciplinary_history (
      tenant_id,employee_record_id,employee_name,department,case_id,decision_id,allegation_id,
      nod_record_id,tda_rule_id,tda_snapshot,finding,confirmed_occurrence,disciplinary_action,
      decision_date,effective_date,finalization_date,implementation_status,source_type,
      verification_status,status,created_by,updated_by
    ) values (
      decision_record.tenant_id,case_record.employee_record_id,case_record.employee_name,case_record.department,
      decision_record.case_id,decision_record.id,allegation_record.id,decision_record.nod_record_id,allegation_record.tda_rule_id,
      allegation_record.tda_snapshot,allegation_record.finding,occurrence_value,decision_record.final_action,
      decision_record.decision_date,decision_record.effective_date,finalized_on,'Pending','case_generated','Verified','Active',
      coalesce(decision_record.approved_by,decision_record.decision_maker,decision_record.created_by),
      coalesce(decision_record.approved_by,decision_record.updated_by,decision_record.decision_maker)
    )
    on conflict (tenant_id,case_id,decision_id,allegation_id) do update set
      updated_by=excluded.updated_by
    returning * into history_record;

    update public.hr_case_allegations
    set confirmed_occurrence=history_record.confirmed_occurrence,
        final_consequence=history_record.disciplinary_action,
        status='Resolved',
        updated_by=coalesce(decision_record.approved_by,decision_record.updated_by,decision_record.decision_maker)
    where id=allegation_record.id;

    generated_count := generated_count + 1;
  end loop;

  return generated_count;
end;
$$;

revoke all on function public.generate_case_disciplinary_history(uuid) from public,anon,authenticated;

create or replace function public.sync_case_disciplinary_history()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  perform public.generate_case_disciplinary_history(new.id);
  return new;
end;
$$;

revoke all on function public.sync_case_disciplinary_history() from public,anon,authenticated;

drop trigger if exists sync_case_disciplinary_history on public.hr_case_decisions;
create trigger sync_case_disciplinary_history
after insert or update of decision_status,nod_status,nod_record_id,nod_issued_at,nod_served_at
on public.hr_case_decisions
for each row execute function public.sync_case_disciplinary_history();

-- A finalized allegation cannot silently change after it has generated an
-- authoritative history row. Workflow-generated occurrence/consequence fields
-- may still be synchronized by the generator above.
create or replace function public.protect_finalized_case_allegation()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if exists (
    select 1 from public.hr_disciplinary_history h
    where h.tenant_id=old.tenant_id and h.allegation_id=old.id
  ) and (
    new.tenant_id is distinct from old.tenant_id
    or new.case_id is distinct from old.case_id
    or new.description is distinct from old.description
    or new.incident_date is distinct from old.incident_date
    or new.source_module is distinct from old.source_module
    or new.source_record_id is distinct from old.source_record_id
    or new.tda_rule_id is distinct from old.tda_rule_id
    or new.tda_snapshot is distinct from old.tda_snapshot
    or new.potential_occurrence is distinct from old.potential_occurrence
    or new.finding is distinct from old.finding
    or new.finding_reason is distinct from old.finding_reason
  ) then
    raise exception 'A finalized allegation cannot be changed after disciplinary history is generated.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_finalized_case_allegation on public.hr_case_allegations;
create trigger protect_finalized_case_allegation
before update on public.hr_case_allegations
for each row execute function public.protect_finalized_case_allegation();

create or replace function public.protect_case_generated_history()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if old.source_type='case_generated' and (
    new.tenant_id is distinct from old.tenant_id
    or new.employee_record_id is distinct from old.employee_record_id
    or new.employee_name is distinct from old.employee_name
    or new.department is distinct from old.department
    or new.case_id is distinct from old.case_id
    or new.decision_id is distinct from old.decision_id
    or new.allegation_id is distinct from old.allegation_id
    or new.nod_record_id is distinct from old.nod_record_id
    or new.tda_rule_id is distinct from old.tda_rule_id
    or new.tda_snapshot is distinct from old.tda_snapshot
    or new.finding is distinct from old.finding
    or new.confirmed_occurrence is distinct from old.confirmed_occurrence
    or new.disciplinary_action is distinct from old.disciplinary_action
    or new.decision_date is distinct from old.decision_date
    or new.effective_date is distinct from old.effective_date
    or new.finalization_date is distinct from old.finalization_date
    or new.source_type is distinct from old.source_type
    or new.verification_status is distinct from old.verification_status
  ) then
    raise exception 'Case-generated disciplinary history source and outcome fields are immutable.' using errcode='23514';
  end if;
  if new.status is distinct from old.status
    and (new.status in ('Superseded','Reversed','Void') or old.status in ('Superseded','Reversed','Void'))
    and not public.current_user_has_permission('employee_relations.approve') then
    raise exception 'Employee Relations approval permission is required to reverse or void history.' using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_case_generated_history on public.hr_disciplinary_history;
create trigger protect_case_generated_history
before update on public.hr_disciplinary_history
for each row execute function public.protect_case_generated_history();

drop trigger if exists hr_disciplinary_history_updated_at on public.hr_disciplinary_history;
create trigger hr_disciplinary_history_updated_at
before update on public.hr_disciplinary_history
for each row execute procedure public.set_updated_at();

drop trigger if exists enforce_tenant_write on public.hr_disciplinary_history;
create trigger enforce_tenant_write
before insert or update or delete on public.hr_disciplinary_history
for each row execute function public.enforce_current_tenant_write();

alter table public.hr_disciplinary_history enable row level security;

drop policy if exists tenant_isolation on public.hr_disciplinary_history;
create policy tenant_isolation on public.hr_disciplinary_history
as restrictive for all to authenticated
using (tenant_id=public.current_tenant_id())
with check (tenant_id=public.current_tenant_id());

drop policy if exists hr_disciplinary_history_select on public.hr_disciplinary_history;
create policy hr_disciplinary_history_select on public.hr_disciplinary_history for select to authenticated using (
  public.current_user_has_permission('employee_relations.view')
  and public.current_user_scope_allows(
    employee_record_id,
    jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,''))
  )
);

drop policy if exists hr_disciplinary_history_update on public.hr_disciplinary_history;
create policy hr_disciplinary_history_update on public.hr_disciplinary_history for update to authenticated using (
  public.current_user_has_permission('employee_relations.update')
  and public.current_user_scope_allows(
    employee_record_id,
    jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,''))
  )
) with check (
  updated_by=auth.uid()
  and public.current_user_scope_allows(
    employee_record_id,
    jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,''))
  )
);

-- Safely materialize history for any Phase 24 decisions finalized before this
-- migration was installed. Oldest outcomes are processed first so progressive
-- occurrences remain chronological. Re-running the migration is idempotent.
do $$
declare
  decision_record record;
begin
  for decision_record in
    select d.id
    from public.hr_case_decisions d
    where d.decision_status='Approved'
      and d.overall_outcome in ('Substantiated','Partially Substantiated')
      and d.nod_status in ('Finalized','Issued','Served')
    order by coalesce(d.nod_served_at,d.nod_issued_at,d.approval_date::date,d.decision_date,d.created_at::date),d.created_at,d.id
  loop
    perform public.generate_case_disciplinary_history(decision_record.id);
  end loop;
end;
$$;

comment on table public.hr_disciplinary_history is
  'Authoritative finalized disciplinary history generated idempotently from approved HR Case decisions and qualifying findings.';
comment on column public.hr_disciplinary_history.confirmed_occurrence is
  'Progressive occurrence calculated only from active, verified, finalized history sharing stable employee and TDA rule identifiers.';
comment on column public.hr_disciplinary_history.source_type is
  'Distinguishes case-generated outcomes from future reviewed legacy/import/manual adjustments.';

commit;
