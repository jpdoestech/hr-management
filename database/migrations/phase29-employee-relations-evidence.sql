begin;

-- Phase 29: normalized Employee Relations evidence register.
-- Existing reports, case links, notes, and attachments remain unchanged.

create table if not exists public.hr_case_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete cascade,
  evidence_type text not null check (evidence_type in (
    'Document','Employee Statement','Witness Statement','Interview Notes',
    'Attendance / Time Record','Photo','CCTV Reference','Email / Message',
    'Client Report','Policy Document','Other'
  )),
  title text not null check (length(trim(title)) between 1 and 240),
  description text,
  source_or_provider text,
  evidence_at timestamptz,
  collected_at timestamptz,
  collected_by text,
  custodian text,
  external_reference text,
  status text not null default 'Active' check (status in ('Active','Archived')),
  attachment_name text,
  attachment_ref text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_case_evidence_case_idx
  on public.hr_case_evidence(tenant_id,case_id,status,evidence_at desc,created_at desc);

drop trigger if exists hr_case_evidence_updated_at on public.hr_case_evidence;
create trigger hr_case_evidence_updated_at
before update on public.hr_case_evidence
for each row execute procedure public.set_updated_at();

drop trigger if exists enforce_tenant_write on public.hr_case_evidence;
create trigger enforce_tenant_write
before insert or update or delete on public.hr_case_evidence
for each row execute function public.enforce_current_tenant_write();

create or replace function public.protect_case_evidence_identity()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.case_id is distinct from old.case_id or new.tenant_id is distinct from old.tenant_id or new.created_by is distinct from old.created_by then
    raise exception 'Evidence case, tenant, and creator references are immutable.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_case_evidence_identity on public.hr_case_evidence;
create trigger protect_case_evidence_identity
before update on public.hr_case_evidence
for each row execute function public.protect_case_evidence_identity();

alter table public.hr_case_evidence enable row level security;

drop policy if exists tenant_isolation on public.hr_case_evidence;
create policy tenant_isolation on public.hr_case_evidence
as restrictive for all to authenticated
using (tenant_id=public.current_tenant_id())
with check (tenant_id=public.current_tenant_id());

drop policy if exists hr_case_evidence_select on public.hr_case_evidence;
create policy hr_case_evidence_select on public.hr_case_evidence for select to authenticated using (
  public.current_user_has_permission('employee_relations.view') and exists (
    select 1 from public.hr_cases c
    where c.id=case_id and c.tenant_id=public.current_tenant_id()
      and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
  )
);

drop policy if exists hr_case_evidence_insert on public.hr_case_evidence;
create policy hr_case_evidence_insert on public.hr_case_evidence for insert to authenticated with check (
  created_by=auth.uid()
  and (public.current_user_has_permission('employee_relations.create') or public.current_user_has_permission('employee_relations.update'))
  and exists (
    select 1 from public.hr_cases c
    where c.id=case_id and c.tenant_id=public.current_tenant_id()
      and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
  )
);

drop policy if exists hr_case_evidence_update on public.hr_case_evidence;
create policy hr_case_evidence_update on public.hr_case_evidence for update to authenticated using (
  public.current_user_has_permission('employee_relations.update') and exists (
    select 1 from public.hr_cases c
    where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
  )
) with check (
  updated_by=auth.uid() and exists (
    select 1 from public.hr_cases c
    where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
  )
);

-- Evidence is archived in the application. Physical deletion is restricted to
-- users with the explicit Employee Relations delete permission.
drop policy if exists hr_case_evidence_delete on public.hr_case_evidence;
create policy hr_case_evidence_delete on public.hr_case_evidence for delete to authenticated using (
  public.current_user_has_permission('employee_relations.delete') and exists (
    select 1 from public.hr_cases c
    where c.id=case_id and public.current_user_scope_allows(c.employee_record_id,jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,'')))
  )
);

comment on table public.hr_case_evidence is 'Case-level investigation evidence with provenance, custody metadata, and managed attachment references.';
comment on column public.hr_case_evidence.status is 'Evidence remains preserved; Archived hides it from the active investigation set without deleting history.';

commit;
