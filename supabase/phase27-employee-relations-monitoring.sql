begin;

-- Phase 27: Employee Relations monitoring and implementation tracking.
-- Additive only. Interim measures are operational safeguards and never become
-- disciplinary history. Final actions are tracked separately through implementation.

create table if not exists public.hr_case_interim_measures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  measure_type text not null check (measure_type in ('Preventive Suspension','Temporary Reassignment','Site Restriction','Administrative Leave','No Interim Measure','Other')),
  reason text not null check (length(trim(reason)) > 0),
  start_date date,
  review_or_end_date date,
  status text not null default 'Planned' check (status in ('Planned','Active','Under Review','Lifted','Completed','Cancelled')),
  authorization text,
  pay_treatment text,
  review_notes text,
  attachment_name text,
  attachment_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (review_or_end_date is null or start_date is null or review_or_end_date >= start_date)
);

create table if not exists public.hr_case_implementations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  decision_id uuid references public.hr_case_decisions(id) on delete set null,
  history_id uuid references public.hr_disciplinary_history(id) on delete set null,
  action_type text not null check (action_type in ('Written Warning','Suspension','Termination','Other','No Action Required')),
  action_description text not null check (length(trim(action_description)) > 0),
  status text not null default 'Pending' check (status in ('Pending','In Progress','Completed','Cancelled','Not Required')),
  due_date date,
  issued_date date,
  effective_date date,
  acknowledgement_status text not null default 'Pending' check (acknowledgement_status in ('Pending','Acknowledged','Refused','Not Required')),
  suspension_start date,
  suspension_end date,
  suspension_days integer check (suspension_days is null or suspension_days >= 0),
  payroll_notified boolean not null default false,
  schedule_handling text,
  return_to_work_date date,
  employee_status_updated boolean not null default false,
  clearance_reference text,
  final_pay_reference text,
  completion_date date,
  completion_notes text,
  attachment_name text,
  attachment_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (suspension_end is null or suspension_start is null or suspension_end >= suspension_start),
  check (status <> 'Completed' or completion_date is not null),
  check (status <> 'Not Required' or action_type = 'No Action Required')
);

create index if not exists hr_case_interim_measures_case_idx on public.hr_case_interim_measures(tenant_id,case_id,status,review_or_end_date);
create index if not exists hr_case_implementations_case_idx on public.hr_case_implementations(tenant_id,case_id,status,due_date);
create index if not exists hr_case_implementations_history_idx on public.hr_case_implementations(tenant_id,history_id) where history_id is not null;
create unique index if not exists hr_case_implementations_decision_idx on public.hr_case_implementations(tenant_id,case_id,decision_id) where decision_id is not null;

create or replace function public.protect_completed_case_implementation()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.action_type <> 'No Action Required' and new.decision_id is null and new.history_id is null then
    raise exception 'Implementation must link to an approved decision or finalized disciplinary history.' using errcode='23514';
  end if;
  if new.decision_id is not null and not exists (
    select 1 from public.hr_case_decisions d
    where d.id=new.decision_id and d.case_id=new.case_id and d.tenant_id=new.tenant_id and d.decision_status='Approved'
  ) then
    raise exception 'Implementation decision must be approved and belong to the same case.' using errcode='23514';
  end if;
  if new.history_id is not null and not exists (
    select 1 from public.hr_disciplinary_history h
    where h.id=new.history_id and h.case_id=new.case_id and h.tenant_id=new.tenant_id and h.verification_status='Verified' and h.status='Active'
  ) then
    raise exception 'Implementation history must be active, verified, and belong to the same case.' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (
    new.case_id is distinct from old.case_id or new.decision_id is distinct from old.decision_id or new.history_id is distinct from old.history_id
  ) then
    raise exception 'Implementation case, decision, and history links are immutable after creation.' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.status='Completed' and (
    new.status is distinct from old.status
    or new.action_type is distinct from old.action_type or new.action_description is distinct from old.action_description
    or new.effective_date is distinct from old.effective_date or new.completion_date is distinct from old.completion_date
  ) and not public.current_user_has_permission('employee_relations.approve') then
    raise exception 'Employee Relations approval permission is required to reopen or materially change completed implementation.' using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_completed_case_implementation on public.hr_case_implementations;
create trigger protect_completed_case_implementation before insert or update on public.hr_case_implementations for each row execute function public.protect_completed_case_implementation();

create or replace function public.sync_case_implementation_history()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare target_history uuid; target_decision uuid; current_record public.hr_case_implementations%rowtype;
begin
  if tg_op='DELETE' then
    target_history := old.history_id;
    target_decision := old.decision_id;
  else
    target_history := new.history_id;
    target_decision := new.decision_id;
  end if;
  if target_history is null and target_decision is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  select * into current_record from public.hr_case_implementations
  where tenant_id=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end
    and (history_id=target_history or (target_decision is not null and decision_id=target_decision))
    and status <> 'Cancelled'
  order by updated_at desc limit 1;
  update public.hr_disciplinary_history set
    implementation_start=current_record.effective_date,
    implementation_end=coalesce(current_record.completion_date,current_record.return_to_work_date),
    implementation_status=coalesce(current_record.status,'Pending'),
    updated_by=coalesce(case when tg_op='DELETE' then old.updated_by else new.updated_by end,auth.uid())
  where (target_history is not null and id=target_history)
     or (target_decision is not null and decision_id=target_decision);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sync_case_implementation_history on public.hr_case_implementations;
create trigger sync_case_implementation_history after insert or update or delete on public.hr_case_implementations for each row execute function public.sync_case_implementation_history();

do $$
declare table_name text;
begin
  foreach table_name in array array['hr_case_interim_measures','hr_case_implementations'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I',table_name,table_name);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute procedure public.set_updated_at()',table_name,table_name);
    execute format('drop trigger if exists enforce_tenant_write on public.%I',table_name);
    execute format('create trigger enforce_tenant_write before insert or update or delete on public.%I for each row execute function public.enforce_current_tenant_write()',table_name);
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists tenant_isolation on public.%I',table_name);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (tenant_id=public.current_tenant_id()) with check (tenant_id=public.current_tenant_id())',table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['hr_case_interim_measures','hr_case_implementations'] loop
    execute format('drop policy if exists %I_select on public.%I',table_name,table_name);
    execute format($policy$create policy %I_select on public.%I for select to authenticated using (
      public.current_user_has_permission('employee_relations.view') and exists (
        select 1 from public.hr_cases c where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
      ))$policy$,table_name,table_name);
    execute format('drop policy if exists %I_insert on public.%I',table_name,table_name);
    execute format($policy$create policy %I_insert on public.%I for insert to authenticated with check (
      created_by=auth.uid() and (public.current_user_has_permission('employee_relations.create') or public.current_user_has_permission('employee_relations.update')) and exists (
        select 1 from public.hr_cases c where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
      ))$policy$,table_name,table_name);
    execute format('drop policy if exists %I_update on public.%I',table_name,table_name);
    execute format($policy$create policy %I_update on public.%I for update to authenticated using (
      public.current_user_has_permission('employee_relations.update') and exists (
        select 1 from public.hr_cases c where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
      )
    ) with check (updated_by=auth.uid() and exists (
      select 1 from public.hr_cases c where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
    ))$policy$,table_name,table_name);
    execute format('drop policy if exists %I_delete on public.%I',table_name,table_name);
    execute format($policy$create policy %I_delete on public.%I for delete to authenticated using (
      public.current_user_has_permission('employee_relations.delete') and status in ('Cancelled','Not Required','Planned') and exists (
        select 1 from public.hr_cases c where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
      )
    )$policy$,table_name,table_name);
  end loop;
end $$;

comment on table public.hr_case_interim_measures is 'Temporary safeguards during an Employee Relations case. These records are not findings, sanctions, or disciplinary history.';
comment on table public.hr_case_implementations is 'Execution and completion evidence for an approved Employee Relations final action.';

commit;
