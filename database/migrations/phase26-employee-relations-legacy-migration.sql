begin;

-- Phase 26: controlled Employee Relations legacy migration.
-- Run after Phase 25. Source hr_records rows and managed attachments are never
-- deleted or rewritten. Exact identifiers, or one unique exact normalized name,
-- are the only employee matches accepted automatically.

alter table public.hr_disciplinary_history
  alter column employee_record_id drop not null,
  alter column case_id drop not null,
  alter column decision_id drop not null,
  alter column allegation_id drop not null,
  alter column finding drop not null,
  alter column decision_date drop not null,
  alter column finalization_date drop not null,
  add column if not exists source_module text,
  add column if not exists source_record_id text,
  add column if not exists source_snapshot jsonb,
  add column if not exists migration_status text not null default 'Case Generated',
  add column if not exists migration_note text,
  add column if not exists migration_reviewed_at timestamptz,
  add column if not exists migration_reviewed_by uuid references auth.users(id) on delete set null;

alter table public.hr_disciplinary_history
  drop constraint if exists hr_disciplinary_history_finding_check;
alter table public.hr_disciplinary_history
  add constraint hr_disciplinary_history_finding_check check (
    finding is null or finding in ('Substantiated','Partially Substantiated')
  );

alter table public.hr_disciplinary_history
  drop constraint if exists hr_disciplinary_history_migration_status_check;
alter table public.hr_disciplinary_history
  add constraint hr_disciplinary_history_migration_status_check check (
    migration_status in (
      'Case Generated','Pending Review','Pending Employee Match',
      'Ambiguous Case Links','Reviewed Unverified','Reviewed Verified',
      'Reviewed Rejected','Source Removed'
    )
  );

alter table public.hr_disciplinary_history
  drop constraint if exists hr_disciplinary_history_source_integrity_check;
alter table public.hr_disciplinary_history
  add constraint hr_disciplinary_history_source_integrity_check check (
    (
      source_type='case_generated'
      and employee_record_id is not null
      and case_id is not null
      and decision_id is not null
      and allegation_id is not null
      and finding in ('Substantiated','Partially Substantiated')
      and decision_date is not null
      and finalization_date is not null
      and verification_status='Verified'
    ) or (
      source_type='legacy'
      and source_module='disciplinary'
      and source_record_id is not null
      and source_snapshot is not null
    ) or source_type in ('imported','manual_adjustment')
  );

create unique index if not exists hr_disciplinary_history_legacy_source_idx
  on public.hr_disciplinary_history(tenant_id,source_module,source_record_id)
  where source_type='legacy';

create index if not exists hr_disciplinary_history_migration_idx
  on public.hr_disciplinary_history(tenant_id,migration_status,verification_status,updated_at desc);

create table if not exists public.hr_case_correspondence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.hr_tenants(id),
  case_id uuid references public.hr_cases(id) on delete set null,
  employee_record_id text,
  employee_name text not null,
  department text,
  correspondence_type text not null default 'Legacy Memorandum',
  subject text,
  action_text text,
  correspondence_date date,
  received_date date,
  attachment_name text,
  attachment_ref text,
  remarks text,
  source_module text not null default 'memos' check (source_module='memos'),
  source_record_id text not null,
  source_snapshot jsonb not null,
  migration_status text not null default 'Migrated Unlinked'
    check (migration_status in (
      'Migrated Linked','Migrated Unlinked','Pending Employee Match',
      'Ambiguous Case Links','Reviewed','Source Removed'
    )),
  status text not null default 'Active'
    check (status in ('Active','Archived','Source Removed')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,source_module,source_record_id)
);

create index if not exists hr_case_correspondence_case_idx
  on public.hr_case_correspondence(tenant_id,case_id,correspondence_date desc);
create index if not exists hr_case_correspondence_employee_idx
  on public.hr_case_correspondence(tenant_id,employee_record_id,correspondence_date desc);
create index if not exists hr_case_correspondence_migration_idx
  on public.hr_case_correspondence(tenant_id,migration_status,updated_at desc);

create or replace function public.legacy_er_safe_date(p_value text)
returns date
language plpgsql
immutable
set search_path=public
as $$
begin
  if nullif(trim(coalesce(p_value,'')),'') is null then return null; end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

create or replace function public.legacy_er_employee_record_id(p_tenant_id uuid,p_data jsonb)
returns text
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  supplied_id text := nullif(trim(coalesce(p_data->>'employeeId','')),'');
  normalized_name text := regexp_replace(lower(trim(coalesce(p_data->>'employeeName',''))),'\s+',' ','g');
  matched_id text;
  match_count integer;
begin
  if supplied_id is not null and exists (
    select 1 from public.hr_records employee
    where employee.tenant_id=p_tenant_id
      and employee.module='employees'
      and employee.record_id=supplied_id
  ) then
    return supplied_id;
  end if;

  if normalized_name='' then return null; end if;
  select count(*),min(employee.record_id)
  into match_count,matched_id
  from public.hr_records employee
  where employee.tenant_id=p_tenant_id
    and employee.module='employees'
    and regexp_replace(lower(trim(coalesce(employee.data->>'name',''))),'\s+',' ','g')=normalized_name;
  return case when match_count=1 then matched_id else null end;
end;
$$;

create or replace function public.legacy_er_linked_case_id(p_tenant_id uuid,p_module text,p_record_id text)
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select case when count(*)=1 then (array_agg(link.case_id order by link.case_id))[1] end
  from public.hr_case_links link
  where link.tenant_id=p_tenant_id
    and link.module=p_module
    and link.record_id=p_record_id;
$$;

create or replace function public.sync_legacy_er_source(
  p_tenant_id uuid,
  p_module text,
  p_record_id text,
  p_data jsonb,
  p_updated_by uuid,
  p_source_removed boolean default false
)
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  employee_id text;
  linked_case_id uuid;
  linked_case_count integer;
  next_migration_status text;
begin
  if p_module not in ('disciplinary','memos') then return; end if;
  perform set_config('app.legacy_projection_sync','allowed',true);

  if p_source_removed then
    if p_module='disciplinary' then
      update public.hr_disciplinary_history
      set migration_status='Source Removed',updated_by=p_updated_by
      where tenant_id=p_tenant_id and source_type='legacy'
        and source_module=p_module and source_record_id=p_record_id;
    else
      update public.hr_case_correspondence
      set migration_status='Source Removed',status='Source Removed',updated_by=p_updated_by
      where tenant_id=p_tenant_id and source_module=p_module and source_record_id=p_record_id;
    end if;
    perform set_config('app.legacy_projection_sync','',true);
    return;
  end if;

  employee_id := public.legacy_er_employee_record_id(p_tenant_id,p_data);
  linked_case_id := public.legacy_er_linked_case_id(p_tenant_id,p_module,p_record_id);
  select count(*) into linked_case_count
  from public.hr_case_links link
  where link.tenant_id=p_tenant_id and link.module=p_module and link.record_id=p_record_id;

  next_migration_status := case
    when employee_id is null then 'Pending Employee Match'
    when linked_case_count>1 then 'Ambiguous Case Links'
    when p_module='memos' and linked_case_count=1 then 'Migrated Linked'
    when p_module='memos' then 'Migrated Unlinked'
    else 'Pending Review'
  end;

  if p_module='disciplinary' then
    insert into public.hr_disciplinary_history (
      tenant_id,employee_record_id,employee_name,department,case_id,
      tda_rule_id,tda_snapshot,finding,confirmed_occurrence,disciplinary_action,
      decision_date,effective_date,finalization_date,implementation_status,
      source_type,verification_status,status,remarks,source_module,source_record_id,
      source_snapshot,migration_status,created_by,updated_by
    ) values (
      p_tenant_id,employee_id,coalesce(nullif(p_data->>'employeeName',''),'Unknown legacy employee'),
      nullif(p_data->>'department',''),linked_case_id,
      nullif(p_data->'tdaRule'->>'catalogId',''),p_data->'tdaRule',null,null,
      coalesce(nullif(p_data->>'action',''),'Not recorded'),null,null,null,'Not Required',
      'legacy','Legacy Unverified','Active',nullif(p_data->>'remarks',''),
      'disciplinary',p_record_id,p_data,next_migration_status,p_updated_by,p_updated_by
    )
    on conflict (tenant_id,source_module,source_record_id) where source_type='legacy'
    do update set
      source_snapshot=excluded.source_snapshot,
      employee_record_id=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.employee_record_id else public.hr_disciplinary_history.employee_record_id end,
      employee_name=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.employee_name else public.hr_disciplinary_history.employee_name end,
      department=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.department else public.hr_disciplinary_history.department end,
      case_id=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.case_id else public.hr_disciplinary_history.case_id end,
      tda_rule_id=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.tda_rule_id else public.hr_disciplinary_history.tda_rule_id end,
      tda_snapshot=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.tda_snapshot else public.hr_disciplinary_history.tda_snapshot end,
      disciplinary_action=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.disciplinary_action else public.hr_disciplinary_history.disciplinary_action end,
      remarks=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.remarks else public.hr_disciplinary_history.remarks end,
      migration_status=case when public.hr_disciplinary_history.verification_status='Legacy Unverified' then excluded.migration_status else public.hr_disciplinary_history.migration_status end,
      updated_by=excluded.updated_by;
  else
    insert into public.hr_case_correspondence (
      tenant_id,case_id,employee_record_id,employee_name,department,correspondence_type,
      subject,action_text,correspondence_date,received_date,attachment_name,
      attachment_ref,remarks,source_module,source_record_id,source_snapshot,
      migration_status,status,created_by,updated_by
    ) values (
      p_tenant_id,linked_case_id,employee_id,
      coalesce(nullif(p_data->>'employeeName',''),'Unknown legacy employee'),
      nullif(p_data->>'department',''),'Legacy Memorandum',
      nullif(p_data->>'offenseType',''),nullif(p_data->>'action',''),
      public.legacy_er_safe_date(p_data->>'dateOfMemo'),
      public.legacy_er_safe_date(p_data->>'dateReceived'),
      nullif(p_data->>'attachment',''),nullif(p_data->>'attachmentData',''),
      nullif(p_data->>'remarks',''),'memos',p_record_id,p_data,
      next_migration_status,'Active',p_updated_by,p_updated_by
    )
    on conflict (tenant_id,source_module,source_record_id)
    do update set
      case_id=excluded.case_id,employee_record_id=excluded.employee_record_id,
      employee_name=excluded.employee_name,department=excluded.department,
      subject=excluded.subject,action_text=excluded.action_text,
      correspondence_date=excluded.correspondence_date,received_date=excluded.received_date,
      attachment_name=excluded.attachment_name,attachment_ref=excluded.attachment_ref,
      remarks=excluded.remarks,source_snapshot=excluded.source_snapshot,
      migration_status=excluded.migration_status,status='Active',updated_by=excluded.updated_by;
  end if;
  perform set_config('app.legacy_projection_sync','',true);
end;
$$;

create or replace function public.sync_legacy_er_record_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if tg_op='DELETE' then
    perform public.sync_legacy_er_source(old.tenant_id,old.module,old.record_id,old.data,coalesce(auth.uid(),old.updated_by),true);
    return old;
  end if;
  perform public.sync_legacy_er_source(new.tenant_id,new.module,new.record_id,new.data,new.updated_by,false);
  return new;
end;
$$;

drop trigger if exists sync_legacy_er_record on public.hr_records;
create trigger sync_legacy_er_record
after insert or update or delete on public.hr_records
for each row
execute function public.sync_legacy_er_record_trigger();

create or replace function public.sync_legacy_er_case_link_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_source_module text := case when tg_op='DELETE' then old.module else new.module end;
  v_source_record_id text := case when tg_op='DELETE' then old.record_id else new.record_id end;
  v_source_tenant_id uuid := case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  linked_case_id uuid;
  linked_case_count integer;
begin
  if v_source_module not in ('disciplinary','memos') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  linked_case_id := public.legacy_er_linked_case_id(v_source_tenant_id,v_source_module,v_source_record_id);
  select count(*) into linked_case_count from public.hr_case_links link
  where link.tenant_id=v_source_tenant_id and link.module=v_source_module and link.record_id=v_source_record_id;

  if v_source_module='disciplinary' then
    update public.hr_disciplinary_history history
    set case_id=linked_case_id,
        migration_status=case when linked_case_count>1 then 'Ambiguous Case Links' when history.employee_record_id is null then 'Pending Employee Match' else 'Pending Review' end
    where history.tenant_id=v_source_tenant_id and history.source_type='legacy'
      and history.source_module=v_source_module and history.source_record_id=v_source_record_id
      and history.verification_status='Legacy Unverified';
  else
    update public.hr_case_correspondence correspondence
    set case_id=linked_case_id,
        migration_status=case when linked_case_count>1 then 'Ambiguous Case Links' when correspondence.employee_record_id is null then 'Pending Employee Match' when linked_case_count=1 then 'Migrated Linked' else 'Migrated Unlinked' end
    where correspondence.tenant_id=v_source_tenant_id
      and correspondence.source_module=v_source_module
      and correspondence.source_record_id=v_source_record_id;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists sync_legacy_er_case_link on public.hr_case_links;
create trigger sync_legacy_er_case_link
after insert or delete on public.hr_case_links
for each row
execute function public.sync_legacy_er_case_link_trigger();

create or replace function public.protect_legacy_disciplinary_history()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  controlled_review boolean := current_setting('app.legacy_history_review',true)='allowed';
  controlled_sync boolean := current_setting('app.legacy_projection_sync',true)='allowed';
begin
  if old.source_type<>'legacy' or pg_trigger_depth()>1 or controlled_sync then return new; end if;
  if new.tenant_id is distinct from old.tenant_id
    or new.source_type is distinct from old.source_type
    or new.source_module is distinct from old.source_module
    or new.source_record_id is distinct from old.source_record_id
    or new.source_snapshot is distinct from old.source_snapshot
    or new.employee_name is distinct from old.employee_name
    or new.department is distinct from old.department then
    raise exception 'Legacy source identity and snapshot fields are immutable.' using errcode='23514';
  end if;
  if (
    new.employee_record_id is distinct from old.employee_record_id
    or new.case_id is distinct from old.case_id
    or new.tda_rule_id is distinct from old.tda_rule_id
    or new.tda_snapshot is distinct from old.tda_snapshot
    or new.finding is distinct from old.finding
    or new.confirmed_occurrence is distinct from old.confirmed_occurrence
    or new.disciplinary_action is distinct from old.disciplinary_action
    or new.decision_date is distinct from old.decision_date
    or new.finalization_date is distinct from old.finalization_date
    or new.verification_status is distinct from old.verification_status
    or new.status is distinct from old.status
    or new.migration_status is distinct from old.migration_status
    or new.migration_note is distinct from old.migration_note
    or new.migration_reviewed_at is distinct from old.migration_reviewed_at
    or new.migration_reviewed_by is distinct from old.migration_reviewed_by
  ) and not controlled_review then
    raise exception 'Use the controlled legacy disciplinary review action.' using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_legacy_disciplinary_history on public.hr_disciplinary_history;
create trigger protect_legacy_disciplinary_history
before update on public.hr_disciplinary_history
for each row execute function public.protect_legacy_disciplinary_history();

create or replace function public.protect_legacy_correspondence_projection()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if pg_trigger_depth()<=1 and current_setting('app.legacy_projection_sync',true)<>'allowed' then
    raise exception 'Edit the preserved source memorandum instead of its normalized correspondence projection.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_legacy_correspondence_projection on public.hr_case_correspondence;
create trigger protect_legacy_correspondence_projection
before update on public.hr_case_correspondence
for each row execute function public.protect_legacy_correspondence_projection();

create or replace function public.review_legacy_disciplinary_history(
  p_history_id uuid,
  p_review_action text,
  p_employee_record_id text,
  p_case_id uuid,
  p_tda_rule_id text,
  p_tda_snapshot jsonb,
  p_finding text,
  p_decision_date date,
  p_finalization_date date,
  p_disciplinary_action text,
  p_review_note text
)
returns public.hr_disciplinary_history
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  active_tenant uuid := public.current_tenant_id();
  actor_id uuid := auth.uid();
  actor_name text;
  history_record public.hr_disciplinary_history%rowtype;
  occurrence_value integer;
begin
  if active_tenant is null or actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_review_action not in ('link','verify','reject') then raise exception 'Invalid legacy review action' using errcode='22023'; end if;
  if not public.current_user_has_permission(case when p_review_action='link' then 'employee_relations.manage' else 'employee_relations.approve' end) then
    raise exception 'Employee Relations review permission is required' using errcode='42501';
  end if;
  if length(trim(coalesce(p_review_note,'')))<3 then raise exception 'A review reason is required' using errcode='23514'; end if;

  select * into history_record from public.hr_disciplinary_history
  where id=p_history_id and tenant_id=active_tenant and source_type='legacy'
  for update;
  if not found then raise exception 'Legacy disciplinary history was not found' using errcode='P0002'; end if;

  if p_review_action<>'reject' then
    if nullif(trim(coalesce(p_employee_record_id,'')),'') is null or not exists (
      select 1 from public.hr_records employee
      where employee.tenant_id=active_tenant and employee.module='employees' and employee.record_id=p_employee_record_id
    ) then raise exception 'Select a valid employee record' using errcode='23514'; end if;
  end if;
  if p_case_id is not null and not exists(select 1 from public.hr_cases where id=p_case_id and tenant_id=active_tenant) then
    raise exception 'The selected HR case is not available' using errcode='23514';
  end if;
  if p_case_id is not null and p_review_action<>'reject' and exists (
    select 1 from public.hr_cases selected_case
    where selected_case.id=p_case_id and selected_case.tenant_id=active_tenant
      and selected_case.employee_record_id is not null
      and selected_case.employee_record_id<>p_employee_record_id
  ) then
    raise exception 'The selected HR case belongs to another employee' using errcode='23514';
  end if;

  if p_review_action='verify' then
    if nullif(trim(coalesce(p_tda_rule_id,'')),'') is null
      or p_finding not in ('Substantiated','Partially Substantiated')
      or p_decision_date is null or p_finalization_date is null
      or length(trim(coalesce(p_disciplinary_action,'')))=0 then
      raise exception 'Verified legacy history requires employee, TDA rule, qualifying finding, dates, and final action' using errcode='23514';
    end if;
    if p_finalization_date<p_decision_date then
      raise exception 'Finalization date cannot be earlier than the decision date' using errcode='23514';
    end if;
    if coalesce(p_tda_snapshot->>'catalogId','')<>p_tda_rule_id or not exists (
      select 1 from public.hr_records catalog
      where catalog.tenant_id=active_tenant and catalog.module='offenseCatalog'
        and catalog.record_id=p_tda_rule_id and lower(coalesce(catalog.data->>'active','true'))<>'false'
    ) then
      raise exception 'Select an active TDA rule from the current catalog' using errcode='23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',active_tenant::text,p_employee_record_id,p_tda_rule_id),0));
    if history_record.verification_status='Verified'
      and history_record.employee_record_id=p_employee_record_id
      and history_record.tda_rule_id=p_tda_rule_id then
      occurrence_value := history_record.confirmed_occurrence;
    else
      select coalesce(max(item.confirmed_occurrence),0)+1 into occurrence_value
      from public.hr_disciplinary_history item
      where item.tenant_id=active_tenant
        and item.employee_record_id=p_employee_record_id
        and item.tda_rule_id=p_tda_rule_id
        and item.verification_status='Verified'
        and item.status='Active'
        and item.id<>p_history_id;
    end if;
  end if;

  perform set_config('app.legacy_history_review','allowed',true);

  update public.hr_disciplinary_history
  set employee_record_id=case when p_review_action='reject' then employee_record_id else p_employee_record_id end,
      case_id=p_case_id,
      tda_rule_id=case when p_review_action='verify' then p_tda_rule_id else tda_rule_id end,
      tda_snapshot=case when p_review_action='verify' then p_tda_snapshot else tda_snapshot end,
      finding=case when p_review_action='verify' then p_finding when p_review_action='reject' then null else finding end,
      confirmed_occurrence=case when p_review_action='verify' then occurrence_value else null end,
      disciplinary_action=case when p_review_action='verify' then p_disciplinary_action else disciplinary_action end,
      decision_date=case when p_review_action='verify' then p_decision_date else decision_date end,
      finalization_date=case when p_review_action='verify' then p_finalization_date else finalization_date end,
      verification_status=case when p_review_action='verify' then 'Verified' when p_review_action='reject' then 'Rejected' else 'Legacy Unverified' end,
      status=case when p_review_action='reject' then 'Void' else 'Active' end,
      migration_status=case when p_review_action='verify' then 'Reviewed Verified' when p_review_action='reject' then 'Reviewed Rejected' else 'Reviewed Unverified' end,
      migration_note=trim(p_review_note),migration_reviewed_at=now(),migration_reviewed_by=actor_id,updated_by=actor_id
  where id=p_history_id
  returning * into history_record;

  select coalesce(full_name,email,actor_id::text) into actor_name from public.profiles where id=actor_id;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
  values(active_tenant,actor_id,actor_name,format('Legacy disciplinary history %s: %s',p_review_action,p_history_id));
  return history_record;
end;
$$;

revoke all on function public.legacy_er_employee_record_id(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.legacy_er_safe_date(text) from public,anon,authenticated;
revoke all on function public.legacy_er_linked_case_id(uuid,text,text) from public,anon,authenticated;
revoke all on function public.sync_legacy_er_source(uuid,text,text,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function public.sync_legacy_er_record_trigger() from public,anon,authenticated;
revoke all on function public.sync_legacy_er_case_link_trigger() from public,anon,authenticated;
revoke all on function public.protect_legacy_disciplinary_history() from public,anon,authenticated;
revoke all on function public.protect_legacy_correspondence_projection() from public,anon,authenticated;
revoke all on function public.review_legacy_disciplinary_history(uuid,text,text,uuid,text,jsonb,text,date,date,text,text) from public,anon;
grant execute on function public.review_legacy_disciplinary_history(uuid,text,text,uuid,text,jsonb,text,date,date,text,text) to authenticated;
grant select on table public.hr_case_correspondence to authenticated;

drop trigger if exists hr_case_correspondence_updated_at on public.hr_case_correspondence;
create trigger hr_case_correspondence_updated_at before update on public.hr_case_correspondence
for each row execute procedure public.set_updated_at();
drop trigger if exists enforce_tenant_write on public.hr_case_correspondence;
create trigger enforce_tenant_write before insert or update or delete on public.hr_case_correspondence
for each row execute function public.enforce_current_tenant_write();

alter table public.hr_case_correspondence enable row level security;
drop policy if exists tenant_isolation on public.hr_case_correspondence;
create policy tenant_isolation on public.hr_case_correspondence
as restrictive for all to authenticated
using (tenant_id=public.current_tenant_id()) with check (tenant_id=public.current_tenant_id());
drop policy if exists hr_case_correspondence_select on public.hr_case_correspondence;
create policy hr_case_correspondence_select on public.hr_case_correspondence for select to authenticated using (
  public.current_user_has_permission('employee_relations.view')
  and public.current_user_scope_allows(
    coalesce(employee_record_id,source_record_id),
    jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
  )
);
drop policy if exists hr_case_correspondence_update on public.hr_case_correspondence;

-- Include unmatched legacy records in scoped review without weakening tenant RLS.
drop policy if exists hr_disciplinary_history_select on public.hr_disciplinary_history;
create policy hr_disciplinary_history_select on public.hr_disciplinary_history for select to authenticated using (
  public.current_user_has_permission('employee_relations.view')
  and public.current_user_scope_allows(
    coalesce(employee_record_id,source_record_id),
    jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
  )
);
drop policy if exists hr_disciplinary_history_update on public.hr_disciplinary_history;
create policy hr_disciplinary_history_update on public.hr_disciplinary_history for update to authenticated using (
  public.current_user_has_permission('employee_relations.update')
) with check (
  updated_by=auth.uid()
  and public.current_user_scope_allows(
    coalesce(employee_record_id,source_record_id),
    jsonb_build_object('employeeId',coalesce(employee_record_id,''),'department',coalesce(department,''))
  )
);

-- Idempotent backfill. Source rows, links, JSON, timestamps, and files remain unchanged.
do $$
declare
  source_record record;
begin
  for source_record in
    select tenant_id,module,record_id,data,updated_by
    from public.hr_records
    where module in ('disciplinary','memos')
    order by created_at,record_id
  loop
    perform public.sync_legacy_er_source(
      source_record.tenant_id,source_record.module,source_record.record_id,
      source_record.data,source_record.updated_by,false
    );
  end loop;
end;
$$;

comment on table public.hr_case_correspondence is
  'Legacy memoranda reclassified as optional Employee Relations correspondence while preserving source JSON and attachments.';
comment on column public.hr_disciplinary_history.source_snapshot is
  'Preserved source JSON synchronized from the untouched legacy record for controlled review.';
comment on function public.review_legacy_disciplinary_history(uuid,text,text,uuid,text,jsonb,text,date,date,text,text) is
  'Permission-controlled legacy history review; only explicit approval can create a qualifying verified occurrence.';

commit;
