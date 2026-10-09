-- Manual bootstrap only: run in the NEW project's Supabase SQL Editor.
-- Replace the email below with the account created in Authentication > Users.
-- Requires the tenant and access-control migrations (0016 and 0017).
-- Do not put this script in migrations: promotion must be an explicit operation.
begin;

do $$
declare
  target_email text := 'REPLACE_WITH_YOUR_EMAIL';
  target_user_id uuid;
  target_tenant_id uuid;
  administrator_role_id uuid;
begin
  if target_email='REPLACE_WITH_YOUR_EMAIL' or btrim(target_email)='' then
    raise exception 'Replace target_email with the exact account email before running this script.';
  end if;

  select id into strict target_user_id
  from auth.users where lower(email)=lower(btrim(target_email));

  select tenant_id into strict target_tenant_id
  from public.profiles where id=target_user_id;

  select id into strict administrator_role_id
  from public.access_roles
  where tenant_id=target_tenant_id and system_key='Administrator' and active;

  update public.profiles
  set role='Administrator', is_super_admin=true, can_export=true,
      allow_password_self_service=true, updated_at=now()
  where id=target_user_id;

  insert into public.access_user_roles(tenant_id,user_id,role_id)
  values(target_tenant_id,target_user_id,administrator_role_id)
  on conflict(user_id,role_id) do nothing;

  insert into public.hr_audit_logs(tenant_id,user_name,action)
  values(target_tenant_id,'SQL administrator',
    'Manual SQL promotion to superadmin for account '||target_user_id::text);

  raise notice 'Promoted account % to superadmin. Sign out and sign in again.', target_email;
exception
  when no_data_found then
    raise exception 'Account, HRIS profile, or active Administrator role not found. Check the email and apply the HRIS migrations first.';
  when too_many_rows then
    raise exception 'Multiple matching accounts or roles found. No promotion was performed.';
end;
$$;

commit;

select id,email,role,is_super_admin,can_export
from public.profiles
where is_super_admin
order by email;
