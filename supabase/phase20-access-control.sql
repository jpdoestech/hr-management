-- Phase 20: tenant-aware RBAC, effective-access explanations, and account policy.
-- Run after phase19-tenant-scale-foundation.sql.

begin;

alter table public.profiles
  add column if not exists is_super_admin boolean not null default false,
  add column if not exists allow_password_self_service boolean not null default true;

update public.profiles set is_super_admin=true where role='Administrator';

create table if not exists public.access_permissions (
  permission_key text primary key,
  module_key text not null,
  action_key text not null,
  label text not null,
  active boolean not null default true,
  unique(module_key,action_key)
);

create table if not exists public.access_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hr_tenants(id),
  name text not null,
  description text not null default '',
  system_key text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,name),
  unique(tenant_id,system_key)
);

create table if not exists public.access_role_permissions (
  role_id uuid not null references public.access_roles(id) on delete cascade,
  permission_key text not null references public.access_permissions(permission_key) on delete cascade,
  primary key(role_id,permission_key)
);

create table if not exists public.access_user_roles (
  tenant_id uuid not null references public.hr_tenants(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.access_roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key(user_id,role_id)
);

create table if not exists public.access_user_overrides (
  tenant_id uuid not null references public.hr_tenants(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.access_permissions(permission_key) on delete cascade,
  effect text not null check(effect in ('grant','deny')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key(user_id,permission_key)
);

create table if not exists public.access_user_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hr_tenants(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope_type text not null check(scope_type in ('global','branch','department','self','team','resource')),
  scope_value text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists access_user_scopes_unique_idx on public.access_user_scopes(user_id,scope_type,scope_value);

create table if not exists public.access_resource_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hr_tenants(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  resource_type text not null,
  resource_id text not null,
  access_level text not null default 'view' check(access_level in ('view','edit','manage','approve')),
  created_at timestamptz not null default now(),
  unique(tenant_id,user_id,resource_type,resource_id)
);

insert into public.access_permissions(permission_key,module_key,action_key,label) values
('dashboard.view','dashboard','view','View dashboard'),
('employees.view','employees','view','View employees'),('employees.create','employees','create','Create employees'),('employees.update','employees','update','Update employees'),('employees.delete','employees','delete','Delete employees'),('employees.export','employees','export','Export employees'),('employees.manage','employees','manage','Manage employee records'),
('onboarding.view','onboarding','view','View onboarding'),('onboarding.create','onboarding','create','Create applicants'),('onboarding.update','onboarding','update','Update applicants'),('onboarding.delete','onboarding','delete','Delete applicants'),('onboarding.approve','onboarding','approve','Approve hiring'),('onboarding.export','onboarding','export','Export applicants'),
('lifecycle.view','lifecycle','view','View lifecycle'),('lifecycle.create','lifecycle','create','Create lifecycle records'),('lifecycle.update','lifecycle','update','Update lifecycle records'),('lifecycle.approve','lifecycle','approve','Approve lifecycle actions'),('lifecycle.manage','lifecycle','manage','Manage lifecycle'),
('leave.view','leave','view','View leave'),('leave.create','leave','create','Create leave records'),('leave.update','leave','update','Update leave records'),('leave.delete','leave','delete','Delete leave records'),('leave.export','leave','export','Export leave'),('leave.approve','leave','approve','Approve leave'),
('manpower.view','manpower','view','View manpower'),('manpower.create','manpower','create','Create manpower records'),('manpower.update','manpower','update','Update manpower records'),('manpower.delete','manpower','delete','Delete manpower records'),('manpower.export','manpower','export','Export manpower'),('manpower.approve','manpower','approve','Approve manpower'),
('employee_relations.view','employee_relations','view','View employee relations'),('employee_relations.create','employee_relations','create','Create employee relations records'),('employee_relations.update','employee_relations','update','Update employee relations records'),('employee_relations.delete','employee_relations','delete','Delete employee relations records'),('employee_relations.export','employee_relations','export','Export employee relations'),('employee_relations.approve','employee_relations','approve','Approve employee relations actions'),('employee_relations.manage','employee_relations','manage','Manage employee relations'),
('documents.view','documents','view','View documents'),('documents.create','documents','create','Create documents'),('documents.update','documents','update','Update documents'),('documents.delete','documents','delete','Delete documents'),('documents.export','documents','export','Export documents'),('documents.manage','documents','manage','Manage documents'),
('workflow.view','workflow','view','View workflows'),('workflow.create','workflow','create','Create workflows'),('workflow.update','workflow','update','Update workflows'),('workflow.approve','workflow','approve','Approve workflows'),('workflow.manage','workflow','manage','Manage workflows'),
('analytics.view','analytics','view','View analytics'),('analytics.export','analytics','export','Export analytics'),
('automation.view','automation','view','View automation'),('automation.manage','automation','manage','Manage automation'),
('organization.view','organization','view','View organization structure'),('organization.create','organization','create','Create organization entries'),('organization.update','organization','update','Update organization entries'),('organization.manage','organization','manage','Manage organization structure'),
('settings.view','settings','view','View settings'),('settings.manage','settings','manage','Manage settings'),
('access_control.view','access_control','view','View access control'),('access_control.manage','access_control','manage','Manage access control'),
('self_service.view','self_service','view','View own HR portal'),('self_service.update','self_service','update','Submit own HR changes')
on conflict(permission_key) do update set module_key=excluded.module_key,action_key=excluded.action_key,label=excluded.label,active=true;

insert into public.access_roles(tenant_id,name,description,system_key)
select tenant.id,seed.name,seed.description,seed.system_key
from public.hr_tenants tenant
cross join (values
  ('Administrator','Full tenant administration','Administrator'),
  ('HR Staff','HR operations and employee record management','HR Staff'),
  ('Manager','Team approvals and workforce visibility','Manager'),
  ('Employee','Employee self-service access','Employee'),
  ('Viewer','Read-only HR reporting access','Viewer')
) seed(name,description,system_key)
on conflict(tenant_id,system_key) do update set name=excluded.name,description=excluded.description,updated_at=now();

insert into public.access_role_permissions(role_id,permission_key)
select role.id,permission.permission_key
from public.access_roles role
join public.access_permissions permission on permission.active
where role.system_key='Administrator'
   or (role.system_key='HR Staff' and permission.permission_key not in ('settings.manage','access_control.manage'))
   or (role.system_key='Viewer' and ((permission.action_key='view' and permission.module_key not in ('access_control','settings','organization')) or permission.permission_key='analytics.export'))
   or (role.system_key='Manager' and permission.permission_key in ('dashboard.view','employees.view','leave.view','leave.approve','workflow.view','workflow.approve','analytics.view','self_service.view','self_service.update'))
   or (role.system_key='Employee' and permission.permission_key in ('self_service.view','self_service.update'))
on conflict do nothing;

insert into public.access_user_roles(tenant_id,user_id,role_id,assigned_by)
select profile.tenant_id,profile.id,role.id,profile.id
from public.profiles profile
join public.access_roles role on role.tenant_id=profile.tenant_id and role.system_key=profile.role
on conflict do nothing;

insert into public.access_user_scopes(tenant_id,user_id,scope_type,scope_value)
select profile.tenant_id,profile.id,case when profile.role='Manager' then 'team' else 'self' end,''
from public.profiles profile where profile.role in ('Manager','Employee')
on conflict(user_id,scope_type,scope_value) do nothing;

create or replace function public.current_user_is_super_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select is_super_admin from public.profiles where id=auth.uid()),false);
$$;

create or replace function public.current_user_has_permission(p_permission_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(
    (select true from public.profiles where id=auth.uid() and is_super_admin limit 1),
    case
      when exists(select 1 from public.access_user_overrides where user_id=auth.uid() and permission_key=p_permission_key and effect='deny') then false
      when exists(select 1 from public.access_user_overrides where user_id=auth.uid() and permission_key=p_permission_key and effect='grant') then true
      else exists(
        select 1 from public.access_user_roles user_role
        join public.access_roles role on role.id=user_role.role_id and role.active
        join public.access_role_permissions role_permission on role_permission.role_id=role.id
        where user_role.user_id=auth.uid() and role_permission.permission_key=p_permission_key
      )
    end,
    false
  );
$$;

revoke all on function public.current_user_is_super_admin() from public;
revoke all on function public.current_user_has_permission(text) from public;
grant execute on function public.current_user_is_super_admin() to authenticated;
grant execute on function public.current_user_has_permission(text) to authenticated;

create or replace function public.get_effective_access(p_user_id uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  target public.profiles%rowtype;
  result jsonb;
begin
  select * into target from public.profiles where id=p_user_id;
  if target.id is null or (p_user_id<>auth.uid() and not public.current_user_has_permission('access_control.view')) then raise exception 'Access denied'; end if;
  if target.tenant_id is distinct from public.current_tenant_id() then raise exception 'Tenant boundary violation'; end if;
  select jsonb_build_object(
    'user_id',target.id,
    'is_super_admin',target.is_super_admin,
    'roles',coalesce((select jsonb_agg(jsonb_build_object('id',role.id,'name',role.name,'active',role.active) order by role.name) from public.access_user_roles ur join public.access_roles role on role.id=ur.role_id where ur.user_id=target.id),'[]'::jsonb),
    'role_permissions',coalesce((select jsonb_agg(distinct rp.permission_key) from public.access_user_roles ur join public.access_roles role on role.id=ur.role_id and role.active join public.access_role_permissions rp on rp.role_id=role.id where ur.user_id=target.id),'[]'::jsonb),
    'direct_grants',coalesce((select jsonb_agg(permission_key order by permission_key) from public.access_user_overrides where user_id=target.id and effect='grant'),'[]'::jsonb),
    'direct_denies',coalesce((select jsonb_agg(permission_key order by permission_key) from public.access_user_overrides where user_id=target.id and effect='deny'),'[]'::jsonb),
    'scopes',coalesce((select jsonb_agg(jsonb_build_object('type',scope_type,'value',scope_value) order by scope_type,scope_value) from public.access_user_scopes where user_id=target.id),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('type',resource_type,'id',resource_id,'level',access_level) order by resource_type,resource_id) from public.access_resource_assignments where user_id=target.id),'[]'::jsonb),
    'permissions',coalesce((select jsonb_object_agg(permission.permission_key,jsonb_build_object(
      'allowed',case when target.is_super_admin then true when deny.permission_key is not null then false when grant_override.permission_key is not null then true when role_permission.permission_key is not null then true else false end,
      'source',case when target.is_super_admin then 'superadmin' when deny.permission_key is not null then 'direct-deny' when grant_override.permission_key is not null then 'direct-grant' when role_permission.permission_key is not null then 'role' else 'not-granted' end
    )) from public.access_permissions permission
    left join lateral (select permission_key from public.access_user_overrides where user_id=target.id and permission_key=permission.permission_key and effect='deny' limit 1) deny on true
    left join lateral (select permission_key from public.access_user_overrides where user_id=target.id and permission_key=permission.permission_key and effect='grant' limit 1) grant_override on true
    left join lateral (select rp.permission_key from public.access_user_roles ur join public.access_roles role on role.id=ur.role_id and role.active join public.access_role_permissions rp on rp.role_id=role.id where ur.user_id=target.id and rp.permission_key=permission.permission_key limit 1) role_permission on true
    where permission.active),'{}'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.save_user_access(
  p_user_id uuid,p_full_name text,p_username text,p_primary_role text,p_role_ids uuid[],
  p_employee_record_id text,p_manager_profile_id uuid,p_allow_password_self_service boolean,
  p_overrides jsonb default '[]'::jsonb,p_scopes jsonb default '[]'::jsonb,p_assignments jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare target_tenant uuid;
begin
  if not public.current_user_has_permission('access_control.manage') then raise exception 'Access denied'; end if;
  select tenant_id into target_tenant from public.profiles where id=p_user_id;
  if target_tenant is null or target_tenant is distinct from public.current_tenant_id() then raise exception 'Tenant boundary violation'; end if;
  if p_primary_role not in ('Administrator','HR Staff','Manager','Employee','Viewer') then raise exception 'Invalid primary role'; end if;
  update public.profiles set full_name=trim(p_full_name),username=lower(trim(p_username)),role=p_primary_role,
    employee_record_id=nullif(p_employee_record_id,''),manager_profile_id=p_manager_profile_id,
    allow_password_self_service=case when p_primary_role='Employee' then coalesce(p_allow_password_self_service,true) else true end,updated_at=now()
  where id=p_user_id;
  delete from public.access_user_roles where user_id=p_user_id;
  insert into public.access_user_roles(tenant_id,user_id,role_id,assigned_by)
    select target_tenant,p_user_id,role.id,auth.uid() from public.access_roles role
    where role.tenant_id=target_tenant and role.active and role.id=any(coalesce(p_role_ids,array[]::uuid[]));
  insert into public.access_user_roles(tenant_id,user_id,role_id,assigned_by)
    select target_tenant,p_user_id,id,auth.uid() from public.access_roles where tenant_id=target_tenant and system_key=p_primary_role and active limit 1
    on conflict do nothing;
  delete from public.access_user_overrides where user_id=p_user_id;
  insert into public.access_user_overrides(tenant_id,user_id,permission_key,effect,created_by)
    select target_tenant,p_user_id,item.permission_key,item.effect,auth.uid()
    from jsonb_to_recordset(coalesce(p_overrides,'[]'::jsonb)) item(permission_key text,effect text)
    join public.access_permissions permission on permission.permission_key=item.permission_key
    where item.effect in ('grant','deny');
  delete from public.access_user_scopes where user_id=p_user_id;
  insert into public.access_user_scopes(tenant_id,user_id,scope_type,scope_value)
    select target_tenant,p_user_id,item.scope_type,coalesce(item.scope_value,'')
    from jsonb_to_recordset(coalesce(p_scopes,'[]'::jsonb)) item(scope_type text,scope_value text)
    where item.scope_type in ('global','branch','department','self','team','resource');
  delete from public.access_resource_assignments where user_id=p_user_id;
  insert into public.access_resource_assignments(tenant_id,user_id,resource_type,resource_id,access_level)
    select target_tenant,p_user_id,item.resource_type,item.resource_id,coalesce(item.access_level,'view')
    from jsonb_to_recordset(coalesce(p_assignments,'[]'::jsonb)) item(resource_type text,resource_id text,access_level text)
    where nullif(trim(item.resource_type),'') is not null and nullif(trim(item.resource_id),'') is not null and coalesce(item.access_level,'view') in ('view','edit','manage','approve');
end;
$$;

create or replace function public.save_access_role(p_role_id uuid,p_name text,p_description text,p_active boolean,p_permission_keys text[])
returns uuid language plpgsql security definer set search_path=public as $$
declare v_role_id uuid; tenant uuid:=public.current_tenant_id(); system_name text;
begin
  if not public.current_user_has_permission('access_control.manage') then raise exception 'Access denied'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Role name is required'; end if;
  if p_role_id is null then
    insert into public.access_roles(tenant_id,name,description,active) values(tenant,trim(p_name),coalesce(trim(p_description),''),coalesce(p_active,true)) returning id into v_role_id;
  else
    select system_key into system_name from public.access_roles where id=p_role_id and tenant_id=tenant;
    if not found then raise exception 'Role not found'; end if;
    if system_name='Administrator' and not coalesce(p_active,true) then raise exception 'The Administrator role cannot be deactivated'; end if;
    update public.access_roles set name=case when system_name is null then trim(p_name) else name end,description=coalesce(trim(p_description),''),active=coalesce(p_active,true),updated_at=now() where id=p_role_id;
    v_role_id:=p_role_id;
  end if;
  delete from public.access_role_permissions where role_id=v_role_id;
  insert into public.access_role_permissions(role_id,permission_key) select v_role_id,permission_key from public.access_permissions where active and permission_key=any(coalesce(p_permission_keys,array[]::text[]));
  return v_role_id;
end;
$$;

create or replace function public.clone_access_role(p_source_id uuid,p_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid; tenant uuid:=public.current_tenant_id(); source_role public.access_roles%rowtype;
begin
  if not public.current_user_has_permission('access_control.manage') then raise exception 'Access denied'; end if;
  select * into source_role from public.access_roles where id=p_source_id and tenant_id=tenant;
  if source_role.id is null then raise exception 'Role not found'; end if;
  insert into public.access_roles(tenant_id,name,description,active) values(tenant,trim(p_name),source_role.description,true) returning id into new_id;
  insert into public.access_role_permissions(role_id,permission_key) select new_id,permission_key from public.access_role_permissions where role_id=p_source_id;
  return new_id;
end;
$$;

create or replace function public.password_self_service_allowed(p_email text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select case when role='Employee' then allow_password_self_service else true end from public.profiles where lower(email)=lower(trim(p_email)) limit 1),true);
$$;

create or replace function public.sync_profile_email_from_auth()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.email is distinct from old.email then update public.profiles set email=lower(new.email),updated_at=now() where id=new.id; end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated after update of email on auth.users for each row execute function public.sync_profile_email_from_auth();

alter table public.access_roles enable row level security;
alter table public.access_role_permissions enable row level security;
alter table public.access_user_roles enable row level security;
alter table public.access_user_overrides enable row level security;
alter table public.access_user_scopes enable row level security;
alter table public.access_resource_assignments enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using(
  tenant_id=public.current_tenant_id() and (
    id=auth.uid() or manager_profile_id=auth.uid() or public.current_user_has_permission('access_control.view')
  )
);

drop policy if exists access_roles_read on public.access_roles;
create policy access_roles_read on public.access_roles for select to authenticated using(tenant_id=public.current_tenant_id() and public.current_user_has_permission('access_control.view'));
drop policy if exists access_role_permissions_read on public.access_role_permissions;
create policy access_role_permissions_read on public.access_role_permissions for select to authenticated using(exists(select 1 from public.access_roles role where role.id=role_id and role.tenant_id=public.current_tenant_id()) and public.current_user_has_permission('access_control.view'));
drop policy if exists access_user_roles_read on public.access_user_roles;
create policy access_user_roles_read on public.access_user_roles for select to authenticated using(tenant_id=public.current_tenant_id() and (user_id=auth.uid() or public.current_user_has_permission('access_control.view')));
drop policy if exists access_user_overrides_read on public.access_user_overrides;
create policy access_user_overrides_read on public.access_user_overrides for select to authenticated using(tenant_id=public.current_tenant_id() and (user_id=auth.uid() or public.current_user_has_permission('access_control.view')));
drop policy if exists access_user_scopes_read on public.access_user_scopes;
create policy access_user_scopes_read on public.access_user_scopes for select to authenticated using(tenant_id=public.current_tenant_id() and (user_id=auth.uid() or public.current_user_has_permission('access_control.view')));
drop policy if exists access_resource_assignments_read on public.access_resource_assignments;
create policy access_resource_assignments_read on public.access_resource_assignments for select to authenticated using(tenant_id=public.current_tenant_id() and (user_id=auth.uid() or public.current_user_has_permission('access_control.view')));

revoke all on function public.get_effective_access(uuid) from public;
revoke all on function public.save_user_access(uuid,text,text,text,uuid[],text,uuid,boolean,jsonb,jsonb,jsonb) from public;
revoke all on function public.save_access_role(uuid,text,text,boolean,text[]) from public;
revoke all on function public.clone_access_role(uuid,text) from public;
revoke all on function public.password_self_service_allowed(text) from public;
grant execute on function public.get_effective_access(uuid) to authenticated;
grant execute on function public.save_user_access(uuid,text,text,text,uuid[],text,uuid,boolean,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.save_access_role(uuid,text,text,boolean,text[]) to authenticated;
grant execute on function public.clone_access_role(uuid,text) to authenticated;
grant execute on function public.password_self_service_allowed(text) to anon,authenticated;

create or replace function public.hr_record_permission_key(p_module text,p_action text)
returns text language sql immutable as $$
  select (case
    when p_module='employees' then 'employees'
    when p_module='onboardingCandidates' then 'onboarding'
    when p_module in ('leaves') then 'leave'
    when p_module in ('evaluations','transfers','lifecycleChecklists') then 'lifecycle'
    when p_module in ('prf','manpowerRequests','manpowerRequirements','manpowerSlots','oncall') then 'manpower'
    when p_module in ('disciplinary','nte','memos','nod','offenseCatalog','cvr','incidents','atd') then 'employee_relations'
    when p_module='documents' then 'documents'
    when p_module='workflowTasks' then 'workflow'
    when p_module='automationRuns' then 'automation'
    else 'employees'
  end)||'.'||p_action;
$$;

create or replace function public.current_user_scope_allows(p_record_id text,p_data jsonb)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when not exists(select 1 from public.access_user_scopes where user_id=auth.uid()) then true
    else exists(
      select 1 from public.access_user_scopes scope
      where scope.user_id=auth.uid() and (
        scope.scope_type='global'
        or (scope.scope_type='branch' and lower(scope.scope_value)=lower(coalesce(p_data->>'branchReporting',p_data->>'branch','')))
        or (scope.scope_type='department' and lower(scope.scope_value)=lower(coalesce(p_data->>'department','')))
        or (scope.scope_type='self' and (p_record_id=public.current_employee_record_id() or p_data->>'employeeId'=public.current_employee_record_id()))
        or (scope.scope_type='team' and (public.is_managed_employee_record(p_record_id) or public.is_managed_employee_record(p_data->>'employeeId')))
        or (scope.scope_type='resource' and exists(select 1 from public.access_resource_assignments assignment where assignment.user_id=auth.uid() and assignment.resource_id in (p_record_id,coalesce(p_data->>'employeeId',''))))
      )
    )
  end;
$$;

revoke all on function public.hr_record_permission_key(text,text) from public;
revoke all on function public.current_user_scope_allows(text,jsonb) from public;
grant execute on function public.hr_record_permission_key(text,text) to authenticated;
grant execute on function public.current_user_scope_allows(text,jsonb) to authenticated;

-- Replace the broad legacy HR-record policies with permission and scope checks.
-- Employee/manager self-service reads are preserved for the linked record set.
drop policy if exists hr_records_select on public.hr_records;
create policy hr_records_select on public.hr_records for select to authenticated using (
  tenant_id=public.current_tenant_id() and (
    (public.current_user_has_permission(public.hr_record_permission_key(module,'view')) and public.current_user_scope_allows(record_id,data))
    or (module in ('employees','leaves','evaluations','documents') and (
      record_id=public.current_employee_record_id() or data->>'employeeId'=public.current_employee_record_id()
      or public.is_managed_employee_record(record_id) or public.is_managed_employee_record(data->>'employeeId')
    ))
  )
);
drop policy if exists hr_records_insert on public.hr_records;
create policy hr_records_insert on public.hr_records for insert to authenticated with check (
  tenant_id=public.current_tenant_id() and public.current_user_has_permission(public.hr_record_permission_key(module,'create')) and public.current_user_scope_allows(record_id,data)
);
drop policy if exists hr_records_update on public.hr_records;
create policy hr_records_update on public.hr_records for update to authenticated using (
  tenant_id=public.current_tenant_id() and public.current_user_has_permission(public.hr_record_permission_key(module,'update')) and public.current_user_scope_allows(record_id,data)
) with check (
  tenant_id=public.current_tenant_id() and public.current_user_has_permission(public.hr_record_permission_key(module,'update')) and public.current_user_scope_allows(record_id,data)
);
drop policy if exists hr_records_delete on public.hr_records;
create policy hr_records_delete on public.hr_records for delete to authenticated using (
  tenant_id=public.current_tenant_id() and public.current_user_has_permission(public.hr_record_permission_key(module,'delete')) and public.current_user_scope_allows(record_id,data)
);

drop policy if exists hr_settings_read on public.hr_settings;
create policy hr_settings_read on public.hr_settings for select to authenticated using(tenant_id=public.current_tenant_id() and (public.current_user_has_permission('settings.view') or public.current_user_has_permission('organization.view')));
drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write on public.hr_settings for all to authenticated using(tenant_id=public.current_tenant_id() and public.current_user_has_permission('settings.manage')) with check(tenant_id=public.current_tenant_id() and public.current_user_has_permission('settings.manage'));

create or replace function public.save_organization_structure(p_departments jsonb,p_positions jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare next_data jsonb; active_tenant uuid:=public.current_tenant_id();
begin
  if active_tenant is null or not public.current_user_has_permission('organization.manage') then raise exception 'Access denied'; end if;
  if jsonb_typeof(p_departments) is distinct from 'array' or jsonb_typeof(p_positions) is distinct from 'array' then raise exception 'Departments and positions must be JSON arrays'; end if;
  if jsonb_array_length(p_departments)>200 or jsonb_array_length(p_positions)>1000 then raise exception 'Organization structure exceeds the supported catalog size'; end if;
  if exists(select 1 from jsonb_array_elements(p_departments) item where jsonb_typeof(item)<>'object' or length(trim(coalesce(item->>'name',''))) not between 1 and 60 or jsonb_typeof(item->'active') is distinct from 'boolean') then raise exception 'Each department requires a valid name and active status'; end if;
  if (select count(*)<>count(distinct lower(trim(item->>'name'))) from jsonb_array_elements(p_departments) item) then raise exception 'Department names must be unique'; end if;
  if exists(select 1 from jsonb_array_elements(p_positions) item where jsonb_typeof(item)<>'object' or length(trim(coalesce(item->>'name',''))) not between 1 and 80 or length(trim(coalesce(item->>'department',''))) not between 1 and 60 or jsonb_typeof(item->'active') is distinct from 'boolean' or not exists(select 1 from jsonb_array_elements(p_departments) department where lower(trim(department->>'name'))=lower(trim(item->>'department')))) then raise exception 'Each position requires a valid name, active status, and existing department'; end if;
  if (select count(*)<>count(distinct lower(trim(item->>'department'))||'|'||lower(trim(item->>'name'))) from jsonb_array_elements(p_positions) item) then raise exception 'Position names must be unique within each department'; end if;
  insert into public.hr_settings(tenant_id,id,data,updated_at,updated_by) values(active_tenant,'singleton',jsonb_build_object('departments',p_departments,'positions',p_positions),now(),auth.uid())
  on conflict(tenant_id,id) do update set data=jsonb_set(jsonb_set(coalesce(public.hr_settings.data,'{}'::jsonb),'{departments}',p_departments,true),'{positions}',p_positions,true),updated_at=now(),updated_by=auth.uid()
  returning data into next_data;
  return next_data;
end;
$$;

comment on table public.access_roles is 'Tenant-scoped RBAC roles. System roles preserve compatibility with the legacy profiles.role column.';
comment on column public.profiles.allow_password_self_service is 'Controls employee access to password setup/reset actions exposed by this application.';

commit;
