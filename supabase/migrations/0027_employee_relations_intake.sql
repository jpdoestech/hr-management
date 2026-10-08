begin;

-- Phase 30: generalized Employee Relations reports and intake.
-- Existing Incident and CVR records remain in their current modules.

create table if not exists public.hr_case_intake (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  intake_number text not null default (
    'INT-' || to_char(timezone('Asia/Manila',now()),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))
  ),
  report_type text not null check (report_type in (
    'Supervisor Referral','Employee Complaint','Attendance Exception',
    'Audit Finding','Security Report','Client Referral','Other Referral'
  )),
  employee_record_id text not null,
  employee_name text not null,
  department text,
  subject text not null check (length(trim(subject)) between 1 and 240),
  narrative text not null check (length(trim(narrative)) between 1 and 12000),
  incident_at timestamptz,
  received_at timestamptz not null default now(),
  source_name text,
  source_contact text,
  confidential boolean not null default false,
  status text not null default 'Submitted' check (status in (
    'Submitted','Under Triage','Needs Information','Converted to Case',
    'Linked to Case','Closed - No Action','Duplicate'
  )),
  triage_notes text,
  linked_case_id uuid references public.hr_cases(id) on delete set null,
  attachment_name text,
  attachment_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,intake_number)
);

create index if not exists hr_case_intake_queue_idx
  on public.hr_case_intake(tenant_id,status,received_at desc);
create index if not exists hr_case_intake_employee_idx
  on public.hr_case_intake(tenant_id,employee_record_id,received_at desc);

drop trigger if exists hr_case_intake_updated_at on public.hr_case_intake;
create trigger hr_case_intake_updated_at before update on public.hr_case_intake
for each row execute procedure public.set_updated_at();

drop trigger if exists enforce_tenant_write on public.hr_case_intake;
create trigger enforce_tenant_write before insert or update or delete on public.hr_case_intake
for each row execute function public.enforce_current_tenant_write();

create or replace function public.validate_case_intake_link()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if tg_op='UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.employee_record_id is distinct from old.employee_record_id
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'Intake tenant, employee, and creator references are immutable.' using errcode='23514';
  end if;
  if new.linked_case_id is not null and not exists (
    select 1 from public.hr_cases c
    where c.id=new.linked_case_id and c.tenant_id=new.tenant_id
      and c.employee_record_id=new.employee_record_id
  ) then
    raise exception 'The linked HR case must belong to the same tenant and employee.' using errcode='23514';
  end if;
  if new.status in ('Converted to Case','Linked to Case') and new.linked_case_id is null then
    raise exception 'A converted or linked intake requires an HR case.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_case_intake_link on public.hr_case_intake;
create trigger validate_case_intake_link before insert or update on public.hr_case_intake
for each row execute function public.validate_case_intake_link();

alter table public.hr_case_intake enable row level security;

drop policy if exists tenant_isolation on public.hr_case_intake;
create policy tenant_isolation on public.hr_case_intake as restrictive for all to authenticated
using (tenant_id=public.current_tenant_id()) with check (tenant_id=public.current_tenant_id());

drop policy if exists hr_case_intake_select on public.hr_case_intake;
create policy hr_case_intake_select on public.hr_case_intake for select to authenticated using (
  public.current_user_has_permission('employee_relations.view')
  and public.current_user_scope_allows(employee_record_id,jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,'')))
);

drop policy if exists hr_case_intake_insert on public.hr_case_intake;
create policy hr_case_intake_insert on public.hr_case_intake for insert to authenticated with check (
  created_by=auth.uid() and public.current_user_has_permission('employee_relations.create')
  and public.current_user_scope_allows(employee_record_id,jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,'')))
);

drop policy if exists hr_case_intake_update on public.hr_case_intake;
create policy hr_case_intake_update on public.hr_case_intake for update to authenticated using (
  public.current_user_has_permission('employee_relations.update')
  and public.current_user_scope_allows(employee_record_id,jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,'')))
) with check (
  updated_by=auth.uid()
  and public.current_user_scope_allows(employee_record_id,jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,'')))
);

drop policy if exists hr_case_intake_delete on public.hr_case_intake;
create policy hr_case_intake_delete on public.hr_case_intake for delete to authenticated using (
  public.current_user_has_permission('employee_relations.delete')
  and public.current_user_scope_allows(employee_record_id,jsonb_build_object('employeeId',employee_record_id,'department',coalesce(department,'')))
);

alter table public.hr_case_links drop constraint if exists hr_case_links_module_check;
alter table public.hr_case_links add constraint hr_case_links_module_check check (
  module in (
    'employees','leaves','disciplinary','nte','memos','nod','oncall','transfers',
    'offenseCatalog','cvr','incidents','intake','prf','evaluations','atd'
  )
);

alter table public.hr_case_allegations drop constraint if exists hr_case_allegations_source_module_check;
alter table public.hr_case_allegations add constraint hr_case_allegations_source_module_check check (
  source_module is null or source_module in ('incidents','cvr','intake')
);

comment on table public.hr_case_intake is 'General Employee Relations intake for complaints, referrals, exceptions, audit findings, and security reports. Intake is not a confirmed violation.';

commit;
