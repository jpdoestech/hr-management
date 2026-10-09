-- Stage A1: additive client master. No legacy PRF, employee or slot backfill.
begin;
create table public.hr_manpower_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.hr_tenants(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  active boolean not null default true,
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);
create unique index hr_manpower_clients_name_unique on public.hr_manpower_clients
  (tenant_id,lower(btrim(regexp_replace(name,'[[:space:]]+',' ','g'))));
alter table public.hr_manpower_clients enable row level security;
create policy hr_manpower_clients_read on public.hr_manpower_clients for select to authenticated
using(tenant_id=public.current_tenant_id() and (
  public.current_user_has_permission('manpower.view') or public.current_user_has_permission('settings.manage')));
-- No direct browser write/delete policies. All mutations use the checked RPC.
revoke all on public.hr_manpower_clients from anon,authenticated;
grant select on public.hr_manpower_clients to authenticated;

create or replace function public.save_manpower_client(
  p_id uuid,p_name text,p_active boolean,p_expected_revision integer default 0
) returns public.hr_manpower_clients
language plpgsql security definer set search_path=public as $$
declare
  account public.hr_manpower_clients;
  actor public.profiles;
  normalized_name text:=btrim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
  active_tenant uuid:=public.current_tenant_id();
begin
  select * into actor from public.profiles where id=auth.uid();
  if auth.uid() is null or active_tenant is null or actor.tenant_id is distinct from active_tenant
    or not coalesce(actor.is_super_admin or actor.role='Administrator',false)
    or not coalesce(public.current_user_has_permission('settings.manage'),false) then
    raise exception 'Only a system administrator can manage Client Accounts' using errcode='42501';
  end if;
  if p_id is null or p_active is null or length(normalized_name) not between 1 and 120 or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'Client id, name, status and revision are required' using errcode='23514';
  end if;
  select * into account from public.hr_manpower_clients where id=p_id for update;
  if found then
    if account.tenant_id<>active_tenant then raise exception 'Client account is not accessible' using errcode='42501';end if;
    if account.revision<>p_expected_revision then raise exception 'Client account changed. Reload before saving.' using errcode='40001';end if;
    update public.hr_manpower_clients set name=normalized_name,active=p_active,revision=revision+1,updated_at=now(),updated_by=auth.uid()
    where id=p_id returning * into account;
  else
    if p_expected_revision<>0 then raise exception 'Client account no longer exists. Reload before saving.' using errcode='40001';end if;
    insert into public.hr_manpower_clients(id,tenant_id,name,active,created_by,updated_by)
    values(p_id,active_tenant,normalized_name,p_active,auth.uid(),auth.uid()) returning * into account;
  end if;
  insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
  values(active_tenant,auth.uid(),coalesce(actor.full_name,'System administrator'),
    format('Client Account %s: %s [%s], revision %s',case when p_expected_revision=0 then 'created' else 'updated' end,account.name,account.id,account.revision));
  return account;
end;$$;
revoke all on function public.save_manpower_client(uuid,text,boolean,integer) from public,anon;
grant execute on function public.save_manpower_client(uuid,text,boolean,integer) to authenticated;
commit;
