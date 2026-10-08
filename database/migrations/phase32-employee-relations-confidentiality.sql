begin;

-- Phase 32: fine-grained Employee Relations access and confidential-record RLS.
-- Additive only. Existing records and attachment references are preserved.

alter table public.hr_cases
  add column if not exists confidential boolean not null default true;

insert into public.access_permissions(permission_key,module_key,action_key,label) values
('employee_relations.create_report','employee_relations','create_report','Create reports'),
('employee_relations.triage','employee_relations','triage','Triage reports'),
('employee_relations.create_case','employee_relations','create_case','Create cases'),
('employee_relations.investigate','employee_relations','investigate','Investigate and manage evidence'),
('employee_relations.manage_nte','employee_relations','manage_nte','Manage NTE'),
('employee_relations.record_response','employee_relations','record_response','Record employee responses'),
('employee_relations.manage_hearing','employee_relations','manage_hearing','Manage hearings'),
('employee_relations.prepare_findings','employee_relations','prepare_findings','Prepare findings'),
('employee_relations.propose_decision','employee_relations','propose_decision','Propose decisions'),
('employee_relations.approve_decision','employee_relations','approve_decision','Approve decisions'),
('employee_relations.issue_nod','employee_relations','issue_nod','Issue NOD'),
('employee_relations.implement_action','employee_relations','implement_action','Implement action'),
('employee_relations.close_case','employee_relations','close_case','Close cases'),
('employee_relations.reopen_case','employee_relations','reopen_case','Reopen or amend cases'),
('employee_relations.view_history','employee_relations','view_history','View disciplinary history'),
('employee_relations.manage_tda','employee_relations','manage_tda','Manage TDA'),
('employee_relations.override_tda_recommendation','employee_relations','override_tda_recommendation','Override TDA recommendation'),
('employee_relations.view_confidential','employee_relations','view_confidential','View confidential records')
on conflict(permission_key) do update set module_key=excluded.module_key,action_key=excluded.action_key,label=excluded.label,active=true;

insert into public.access_role_permissions(role_id,permission_key)
select role.id,permission.permission_key
from public.access_roles role
join public.access_permissions permission on permission.module_key='employee_relations'
where role.system_key in ('Administrator','HR Staff')
on conflict do nothing;

create or replace function public.current_user_can_access_er_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select exists(
    select 1 from public.hr_cases c
    where c.id=p_case_id
      and c.tenant_id=public.current_tenant_id()
      and (c.assigned_to=auth.uid() or public.current_user_has_permission('employee_relations.view'))
      and public.current_user_scope_allows(
        c.employee_record_id,
        jsonb_build_object('employeeId',coalesce(c.employee_record_id,''),'department',coalesce(c.department,''))
      )
      and (
        not c.confidential
        or c.assigned_to=auth.uid()
        or c.created_by=auth.uid()
        or public.current_user_has_permission('employee_relations.view_confidential')
      )
  );
$$;

revoke all on function public.current_user_can_access_er_case(uuid) from public,anon;
grant execute on function public.current_user_can_access_er_case(uuid) to authenticated;

drop policy if exists hr_cases_confidentiality_guard on public.hr_cases;
create policy hr_cases_confidentiality_guard on public.hr_cases as restrictive for all to authenticated
using (
  tenant_id=public.current_tenant_id()
  and (not confidential or assigned_to=auth.uid() or created_by=auth.uid() or public.current_user_has_permission('employee_relations.view_confidential'))
)
with check (
  tenant_id=public.current_tenant_id()
  and (not confidential or assigned_to=auth.uid() or created_by=auth.uid() or public.current_user_has_permission('employee_relations.view_confidential'))
);

drop policy if exists hr_case_intake_confidentiality_guard on public.hr_case_intake;
create policy hr_case_intake_confidentiality_guard on public.hr_case_intake as restrictive for all to authenticated
using (not confidential or created_by=auth.uid() or public.current_user_has_permission('employee_relations.view_confidential'))
with check (not confidential or created_by=auth.uid() or public.current_user_has_permission('employee_relations.view_confidential'));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'hr_case_allegations','hr_case_links','hr_case_activity','hr_case_responses',
    'hr_case_hearings','hr_case_decisions','hr_case_interim_measures',
    'hr_case_implementations','hr_case_evidence','hr_case_revisions'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('drop policy if exists %I on public.%I',table_name||'_confidentiality_guard',table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (public.current_user_can_access_er_case(case_id)) with check (public.current_user_can_access_er_case(case_id))',
        table_name||'_confidentiality_guard',table_name
      );
    end if;
  end loop;
end $$;

drop policy if exists hr_disciplinary_history_confidentiality_guard on public.hr_disciplinary_history;
create policy hr_disciplinary_history_confidentiality_guard on public.hr_disciplinary_history as restrictive for all to authenticated
using (
  public.current_user_has_permission('employee_relations.view_history')
  and (case_id is null or public.current_user_can_access_er_case(case_id))
)
with check (
  public.current_user_has_permission('employee_relations.view_history')
  and (case_id is null or public.current_user_can_access_er_case(case_id))
);

-- Case attachments use the existing tenant/user/case path. Other HR document
-- modules retain their current access behavior.
drop policy if exists hr_documents_case_confidentiality_guard on storage.objects;
create policy hr_documents_case_confidentiality_guard on storage.objects as restrictive for select to authenticated using (
  bucket_id<>'hr-documents'
  or (coalesce((storage.foldername(name))[3],'')<>'case' and coalesce((storage.foldername(name))[2],'')<>'case')
  or public.current_user_has_permission('employee_relations.view_confidential')
);

create or replace function public.enforce_employee_relations_stage_permission()
returns trigger language plpgsql security invoker set search_path=public,auth as $$
declare required_permission text;
begin
  if new.status is not distinct from old.status then return new; end if;
  required_permission := case
    when old.status in ('Closed','Closed - No Violation','Closed - Insufficient Evidence','Closed - Informal Resolution','Cancelled','Duplicate','Resolved') then 'employee_relations.reopen_case'
    when new.status in ('Under Investigation','NTE Preparation') then 'employee_relations.investigate'
    when new.status in ('NTE Issued','Awaiting Employee Response','Response Received') then 'employee_relations.manage_nte'
    when new.status='Hearing / Conference' then 'employee_relations.manage_hearing'
    when new.status='For Findings' then 'employee_relations.prepare_findings'
    when new.status='For Decision' then 'employee_relations.propose_decision'
    when new.status='Decision Approved' then 'employee_relations.approve_decision'
    when new.status='NOD Issued' then 'employee_relations.issue_nod'
    when new.status in ('For Implementation','Implemented') then 'employee_relations.implement_action'
    when new.status in ('Closed','Closed - No Violation','Closed - Insufficient Evidence','Closed - Informal Resolution','Cancelled','Duplicate') then 'employee_relations.close_case'
    else 'employee_relations.update'
  end;
  if not public.current_user_has_permission(required_permission) then
    raise exception 'Permission % is required for this case transition.',required_permission using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_employee_relations_stage_permission on public.hr_cases;
create trigger enforce_employee_relations_stage_permission before update of status on public.hr_cases
for each row execute function public.enforce_employee_relations_stage_permission();

create or replace function public.enforce_employee_relations_record_permission()
returns trigger language plpgsql security invoker set search_path=public,auth as $$
declare required_permission text;
begin
  if tg_table_name='hr_case_links' then
    if not (
      public.current_user_has_permission('employee_relations.investigate')
      or public.current_user_has_permission('employee_relations.create_case')
      or public.current_user_has_permission('employee_relations.triage')
      or public.current_user_has_permission('employee_relations.manage_nte')
      or public.current_user_has_permission('employee_relations.issue_nod')
    ) then
      raise exception 'A case workflow permission is required to change linked records.' using errcode='42501';
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name='hr_case_allegations' and tg_op='INSERT' then
    if not (
      public.current_user_has_permission('employee_relations.prepare_findings')
      or public.current_user_has_permission('employee_relations.investigate')
      or public.current_user_has_permission('employee_relations.create_case')
      or public.current_user_has_permission('employee_relations.triage')
    ) then
      raise exception 'A case intake or findings permission is required to add an allegation.' using errcode='42501';
    end if;
    return new;
  end if;
  required_permission := case tg_table_name
    when 'hr_case_intake' then case when tg_op='INSERT' then 'employee_relations.create_report' else 'employee_relations.triage' end
    when 'hr_case_allegations' then 'employee_relations.prepare_findings'
    when 'hr_case_evidence' then 'employee_relations.investigate'
    when 'hr_case_responses' then 'employee_relations.record_response'
    when 'hr_case_hearings' then 'employee_relations.manage_hearing'
    when 'hr_case_interim_measures' then 'employee_relations.investigate'
    when 'hr_case_implementations' then 'employee_relations.implement_action'
    when 'hr_cases' then 'employee_relations.create_case'
    when 'hr_case_decisions' then case
      when tg_op='DELETE' then 'employee_relations.propose_decision'
      when tg_op='UPDATE' and new.nod_status is distinct from old.nod_status then 'employee_relations.issue_nod'
      when tg_op='UPDATE' and new.decision_status is distinct from old.decision_status and new.decision_status in ('Approved','Returned') then 'employee_relations.approve_decision'
      when coalesce(new.deviation_from_tda,false) and (tg_op='INSERT' or new.deviation_from_tda is distinct from old.deviation_from_tda or new.deviation_reason is distinct from old.deviation_reason) then 'employee_relations.override_tda_recommendation'
      else 'employee_relations.propose_decision'
    end
    else null
  end;
  if required_permission is not null and not public.current_user_has_permission(required_permission) then
    raise exception 'Permission % is required for this Employee Relations record change.',required_permission using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_employee_relations_case_create_permission on public.hr_cases;
create trigger enforce_employee_relations_case_create_permission before insert on public.hr_cases
for each row execute function public.enforce_employee_relations_record_permission();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'hr_case_intake','hr_case_allegations','hr_case_evidence','hr_case_responses',
    'hr_case_hearings','hr_case_decisions','hr_case_interim_measures',
    'hr_case_implementations','hr_case_links'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('drop trigger if exists %I on public.%I',table_name||'_permission_guard',table_name);
      execute format(
        'create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_employee_relations_record_permission()',
        table_name||'_permission_guard',table_name
      );
    end if;
  end loop;
end $$;

create index if not exists hr_cases_confidential_queue_idx
  on public.hr_cases(tenant_id,confidential,status,assigned_to,updated_at desc);
create index if not exists hr_case_intake_confidential_queue_idx
  on public.hr_case_intake(tenant_id,confidential,status,received_at desc);

comment on column public.hr_cases.confidential is
  'Restricts case and normalized child records to an assigned case owner or a user with employee_relations.view_confidential.';

commit;
