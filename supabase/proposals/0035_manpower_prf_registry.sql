-- Stage A4 proposal, NOT an automatically deployed migration.
-- Verify production migrations 0033/0034 and the PRF baseline before promotion.
-- Existing duplicate numbers are preserved; no source records are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
lock table public.hr_records,public.hr_manpower_requests in share row exclusive mode;

create table public.hr_manpower_prf_registry (
  tenant_id uuid not null references public.hr_tenants(id),
  normalized_prf text not null check(normalized_prf<>'' and normalized_prf=public.normalize_manpower_prf(normalized_prf)),
  -- Several owners are allowed only when seeding pre-existing conflicts.
  owners jsonb not null check(jsonb_typeof(owners)='object' and owners<>'{}'::jsonb),
  primary key(tenant_id,normalized_prf)
);
alter table public.hr_manpower_prf_registry enable row level security;
revoke all on public.hr_manpower_prf_registry from public,anon,authenticated;

insert into public.hr_manpower_prf_registry(tenant_id,normalized_prf,owners)
select tenant_id,normalized_prf,jsonb_object_agg(owner_key,true)
from (
  select tenant_id,public.normalize_manpower_prf(data->>'prfNumber') normalized_prf,'legacy:'||record_id owner_key
  from public.hr_records where module='manpowerRequests'
  union all
  select tenant_id,normalized_prf,'quantity:'||id from public.hr_manpower_requests
) sources where normalized_prf<>'' group by tenant_id,normalized_prf;

create index hr_records_manpower_normalized_prf_idx
  on public.hr_records(tenant_id,public.normalize_manpower_prf(data->>'prfNumber'))
  where module='manpowerRequests';

create function public.guard_manpower_prf_number() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  old_number text:='';
  new_number text:='';
  owner_key text;
  row_tenant uuid;
  claimed text;
  actor_name text;
begin
  if tg_table_name='hr_records' then
    if tg_op='DELETE' then
      if old.module<>'manpowerRequests' then return old;end if;
    elsif tg_op='INSERT' then
      if new.module<>'manpowerRequests' then return new;end if;
    elsif old.module<>'manpowerRequests' and new.module<>'manpowerRequests' then
      return new;
    end if;
    if tg_op='UPDATE' and old.module='manpowerRequests'
      and (new.module is distinct from old.module or new.record_id is distinct from old.record_id or new.tenant_id is distinct from old.tenant_id) then
      raise exception 'Manpower request identity cannot be changed' using errcode='23514';
    end if;
    if tg_op<>'INSERT' and old.module='manpowerRequests' then old_number:=public.normalize_manpower_prf(old.data->>'prfNumber');end if;
    if tg_op<>'DELETE' then
      new_number:=public.normalize_manpower_prf(new.data->>'prfNumber');
      owner_key:='legacy:'||new.record_id;row_tenant:=new.tenant_id;
    else owner_key:='legacy:'||old.record_id;row_tenant:=old.tenant_id;
    end if;
  else
    if tg_op='UPDATE' and (new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id) then
      raise exception 'Manpower request identity cannot be changed' using errcode='23514';
    end if;
    if tg_op<>'INSERT' then old_number:=public.normalize_manpower_prf(old.prf_number);end if;
    if tg_op<>'DELETE' then
      new_number:=public.normalize_manpower_prf(new.prf_number);owner_key:='quantity:'||new.id;row_tenant:=new.tenant_id;
    else owner_key:='quantity:'||old.id;row_tenant:=old.tenant_id;
    end if;
  end if;

  if new_number<>'' then
    -- The shared unique row is the arbiter, not a snapshot-dependent SELECT.
    -- ON CONFLICT locks the current row and only permits its existing owner.
    insert into public.hr_manpower_prf_registry as registry(tenant_id,normalized_prf,owners)
    values(row_tenant,new_number,jsonb_build_object(owner_key,true))
    on conflict(tenant_id,normalized_prf) do update set owners=registry.owners
      where registry.owners ? owner_key
    returning normalized_prf into claimed;
    if claimed is null then
      raise exception 'PRF number is already assigned in this organization. Use a different number.' using errcode='23505';
    end if;
  end if;
  if old_number<>'' and old_number<>new_number then
    -- Delete a sole claim instead of persisting an empty owners object.
    delete from public.hr_manpower_prf_registry
      where tenant_id=row_tenant and normalized_prf=old_number and owners=jsonb_build_object(owner_key,true);
    update public.hr_manpower_prf_registry set owners=owners-owner_key
      where tenant_id=row_tenant and normalized_prf=old_number and owners ? owner_key;
  end if;
  if tg_op='UPDATE' and old_number<>new_number then
    select full_name into actor_name from public.profiles where id=auth.uid() and tenant_id=row_tenant;
    insert into public.hr_audit_logs(tenant_id,user_id,user_name,action)
    values(row_tenant,auth.uid(),coalesce(actor_name,'SQL administrator'),
      format('Manpower PRF number changed [%s]: %s -> %s',owner_key,nullif(old_number,''),nullif(new_number,'')));
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
revoke all on function public.guard_manpower_prf_number() from public,anon,authenticated;

-- AFTER ROW avoids phantom claims from INSERT ... ON CONFLICT DO NOTHING
-- or from upserts that ultimately update rather than insert a request.
create trigger manpower_prf_number_guard after insert or update or delete on public.hr_records
  for each row execute function public.guard_manpower_prf_number();
create trigger manpower_prf_number_guard after insert or update or delete on public.hr_manpower_requests
  for each row execute function public.guard_manpower_prf_number();

comment on table public.hr_manpower_prf_registry is
  'Private cross-model PRF number ownership. Existing conflicts retained; new collisions blocked. Submission remains gated.';
commit;
