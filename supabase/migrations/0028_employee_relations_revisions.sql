begin;

-- Phase 31: controlled case reopening, decision amendment, and material-record retention.

alter table public.hr_case_decisions
  add column if not exists supersedes_decision_id uuid references public.hr_case_decisions(id) on delete restrict;

create table if not exists public.hr_case_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  case_id uuid not null references public.hr_cases(id) on delete restrict,
  decision_id uuid references public.hr_case_decisions(id) on delete restrict,
  replacement_decision_id uuid references public.hr_case_decisions(id) on delete restrict,
  action text not null check (action in ('Reopen Case','Supersede Decision','Reverse Decision')),
  reason text not null check (length(trim(reason)) between 10 and 4000),
  previous_case_status text not null,
  resulting_case_status text not null,
  previous_decision_status text,
  authorized_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists hr_case_revisions_case_idx
  on public.hr_case_revisions(tenant_id,case_id,created_at desc);

drop trigger if exists enforce_tenant_write on public.hr_case_revisions;
create trigger enforce_tenant_write before insert or update or delete on public.hr_case_revisions
for each row execute function public.enforce_current_tenant_write();

alter table public.hr_case_revisions enable row level security;

drop policy if exists tenant_isolation on public.hr_case_revisions;
create policy tenant_isolation on public.hr_case_revisions as restrictive for all to authenticated
using (tenant_id=public.current_tenant_id()) with check (tenant_id=public.current_tenant_id());

drop policy if exists hr_case_revisions_select on public.hr_case_revisions;
create policy hr_case_revisions_select on public.hr_case_revisions for select to authenticated using (
  public.current_user_has_permission('employee_relations.view')
  and exists (
    select 1 from public.hr_cases c
    where c.id=case_id and c.tenant_id=public.current_tenant_id()
      and public.current_user_scope_allows(
        c.employee_record_id,
        jsonb_build_object('employeeId',c.employee_record_id,'department',coalesce(c.department,''))
      )
  )
);

create or replace function public.controlled_case_revision(
  p_case_id uuid,
  p_action text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  case_record public.hr_cases%rowtype;
  decision_record public.hr_case_decisions%rowtype;
  replacement_id uuid;
  revision_id uuid;
  target_status text;
  replacement_version integer;
begin
  if auth.uid() is null or not public.current_user_has_permission('employee_relations.approve') then
    raise exception 'Employee Relations approval permission is required.' using errcode='42501';
  end if;
  if p_action not in ('Reopen Case','Supersede Decision','Reverse Decision') then
    raise exception 'Unsupported case revision action.' using errcode='22023';
  end if;
  if length(trim(coalesce(p_reason,''))) < 10 then
    raise exception 'A revision reason of at least 10 characters is required.' using errcode='23514';
  end if;

  select * into case_record
  from public.hr_cases
  where id=p_case_id and tenant_id=public.current_tenant_id()
  for update;

  if not found then
    raise exception 'HR case not found in the current tenant.' using errcode='P0002';
  end if;
  if not public.current_user_scope_allows(
    case_record.employee_record_id,
    jsonb_build_object('employeeId',case_record.employee_record_id,'department',coalesce(case_record.department,''))
  ) then
    raise exception 'The HR case is outside the current user scope.' using errcode='42501';
  end if;

  select * into decision_record
  from public.hr_case_decisions
  where tenant_id=case_record.tenant_id and case_id=case_record.id and decision_status='Approved'
  order by version desc
  limit 1
  for update;

  if p_action='Reopen Case' then
    if case_record.status not in (
      'Closed','Closed - No Violation','Closed - Insufficient Evidence',
      'Closed - Informal Resolution','Cancelled','Duplicate','Resolved'
    ) then
      raise exception 'Only a closed or terminal case can be reopened.' using errcode='23514';
    end if;
    if found then
      raise exception 'A finalized decision exists. Supersede or reverse it to reopen this case.' using errcode='23514';
    end if;
    target_status := 'Under Investigation';
  else
    if not found then
      raise exception 'An active approved decision is required for decision amendment.' using errcode='23514';
    end if;

    update public.hr_case_decisions
    set decision_status=case when p_action='Supersede Decision' then 'Superseded' else 'Reversed' end,
        updated_by=auth.uid()
    where id=decision_record.id;

    update public.hr_disciplinary_history
    set status=case when p_action='Supersede Decision' then 'Superseded' else 'Reversed' end,
        remarks=concat_ws(E'\n',nullif(remarks,''),p_action || ': ' || trim(p_reason)),
        updated_by=auth.uid()
    where tenant_id=case_record.tenant_id and decision_id=decision_record.id and status='Active';

    update public.hr_case_implementations
    set status='Cancelled',
        completion_notes=concat_ws(E'\n',nullif(completion_notes,''),'Cancelled by ' || p_action || ': ' || trim(p_reason)),
        updated_by=auth.uid()
    where tenant_id=case_record.tenant_id and decision_id=decision_record.id
      and status in ('Pending','In Progress');

    select coalesce(max(version),0)+1 into replacement_version
    from public.hr_case_decisions
    where tenant_id=case_record.tenant_id and case_id=case_record.id;

    insert into public.hr_case_decisions (
      tenant_id,case_id,version,decision_status,decision_date,decision_maker,supersedes_decision_id,
      overall_outcome,reasoning,mitigating_factors,aggravating_factors,
      tda_recommended_action,proposed_action,final_action,effective_date,
      deviation_from_tda,deviation_reason,review_notes,nod_status,
      created_by,updated_by
    ) values (
      case_record.tenant_id,case_record.id,replacement_version,'Draft',decision_record.decision_date,auth.uid(),decision_record.id,
      decision_record.overall_outcome,decision_record.reasoning,decision_record.mitigating_factors,decision_record.aggravating_factors,
      decision_record.tda_recommended_action,decision_record.proposed_action,decision_record.final_action,decision_record.effective_date,
      decision_record.deviation_from_tda,decision_record.deviation_reason,
      'Created by ' || p_action || ': ' || trim(p_reason),'Not Prepared',auth.uid(),auth.uid()
    ) returning id into replacement_id;

    target_status := 'For Decision';
  end if;

  update public.hr_cases
  set status=target_status,closed_at=null,outcome=null,updated_by=auth.uid()
  where id=case_record.id;

  insert into public.hr_case_revisions (
    tenant_id,case_id,decision_id,replacement_decision_id,action,reason,
    previous_case_status,resulting_case_status,previous_decision_status,authorized_by
  ) values (
    case_record.tenant_id,case_record.id,
    case when p_action='Reopen Case' then null else decision_record.id end,
    replacement_id,p_action,trim(p_reason),case_record.status,target_status,
    case when p_action='Reopen Case' then null else decision_record.decision_status end,
    auth.uid()
  ) returning id into revision_id;

  insert into public.hr_case_activity (
    tenant_id,case_id,activity_type,note,status_from,status_to,created_by
  ) values (
    case_record.tenant_id,case_record.id,'revision',
    p_action || ': ' || trim(p_reason),case_record.status,target_status,auth.uid()
  );

  return jsonb_build_object(
    'revisionId',revision_id,
    'replacementDecisionId',replacement_id,
    'status',target_status
  );
end;
$$;

revoke all on function public.controlled_case_revision(uuid,text,text) from public,anon;
grant execute on function public.controlled_case_revision(uuid,text,text) to authenticated;

create or replace function public.preserve_amended_history_occurrence()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  prior_decision_id uuid;
  prior_occurrence integer;
begin
  if new.source_type<>'case_generated' or new.tda_rule_id is null then
    return new;
  end if;

  select d.supersedes_decision_id into prior_decision_id
  from public.hr_case_decisions d
  where d.id=new.decision_id and d.tenant_id=new.tenant_id;

  if prior_decision_id is null then
    return new;
  end if;

  select h.confirmed_occurrence into prior_occurrence
  from public.hr_disciplinary_history h
  where h.tenant_id=new.tenant_id and h.decision_id=prior_decision_id
    and h.allegation_id=new.allegation_id
  order by h.created_at desc
  limit 1;

  if prior_occurrence is not null and not exists (
    select 1 from public.hr_disciplinary_history h
    where h.tenant_id=new.tenant_id and h.employee_record_id=new.employee_record_id
      and h.tda_rule_id=new.tda_rule_id and h.confirmed_occurrence=prior_occurrence
      and h.status='Active' and h.verification_status='Verified'
  ) then
    new.confirmed_occurrence := prior_occurrence;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_amended_history_occurrence on public.hr_disciplinary_history;
create trigger preserve_amended_history_occurrence
before insert on public.hr_disciplinary_history
for each row execute function public.preserve_amended_history_occurrence();

create or replace function public.prevent_material_hr_case_delete()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if old.status not in ('Reported / Created','Under Triage','Open')
    or exists(select 1 from public.hr_case_links x where x.case_id=old.id)
    or exists(select 1 from public.hr_case_allegations x where x.case_id=old.id)
    or exists(select 1 from public.hr_case_responses x where x.case_id=old.id)
    or exists(select 1 from public.hr_case_hearings x where x.case_id=old.id)
    or exists(select 1 from public.hr_case_decisions x where x.case_id=old.id)
    or exists(select 1 from public.hr_case_interim_measures x where x.case_id=old.id)
    or exists(select 1 from public.hr_case_implementations x where x.case_id=old.id)
    or exists(select 1 from public.hr_case_evidence x where x.case_id=old.id)
    or exists(select 1 from public.hr_disciplinary_history x where x.case_id=old.id)
  then
    raise exception 'Material HR cases cannot be deleted. Use a controlled terminal status or revision workflow.' using errcode='23514';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_material_hr_case_delete on public.hr_cases;
create trigger prevent_material_hr_case_delete before delete on public.hr_cases
for each row execute function public.prevent_material_hr_case_delete();

comment on table public.hr_case_revisions is
  'Immutable authorization record for controlled case reopening and approved-decision amendments.';

commit;
