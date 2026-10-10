-- Gated concurrency prerequisite. No conversion or production enablement.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
create schema manpower_private;
revoke all on schema manpower_private from public,anon,authenticated;

create function manpower_private.lock_source_snapshot(p_tenant uuid) returns void
language plpgsql set search_path=public as $$ begin
  if p_tenant is null then raise exception 'Tenant context required' using errcode='42501';end if;
  if current_setting('transaction_isolation') not in ('read committed','serializable') then
    raise exception 'Manpower source transactions require read committed or serializable isolation' using errcode='25000';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':manpower-source-snapshot',0));
end $$;
revoke all on function manpower_private.lock_source_snapshot(uuid) from public,anon,authenticated;

-- Move verified bodies behind a non-browser namespace instead of copying them.
alter function public.reserve_manpower_applicants(text,jsonb) set schema manpower_private;
alter function public.release_manpower_reservation(uuid,text) set schema manpower_private;
alter function public.schedule_manpower_reservation(uuid,bigint,date,text) set schema manpower_private;
alter function public.confirm_manpower_deployments(text,jsonb) set schema manpower_private;
alter function public.record_manpower_identity_review(text,text,text,text,text,text,bigint) set schema manpower_private;
alter function public.record_manpower_identity_review(text,text,text,text,text,text) set schema manpower_private;
revoke all on function manpower_private.reserve_manpower_applicants(text,jsonb),
  manpower_private.release_manpower_reservation(uuid,text),manpower_private.schedule_manpower_reservation(uuid,bigint,date,text),
  manpower_private.confirm_manpower_deployments(text,jsonb),
  manpower_private.record_manpower_identity_review(text,text,text,text,text,text,bigint),
  manpower_private.record_manpower_identity_review(text,text,text,text,text,text) from public,anon,authenticated;

create function public.reserve_manpower_applicants(p_token text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  perform manpower_private.lock_source_snapshot(public.current_tenant_id());
  return manpower_private.reserve_manpower_applicants(p_token,p_items);
end $$;
create function public.release_manpower_reservation(p_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  perform manpower_private.lock_source_snapshot(public.current_tenant_id());
  return manpower_private.release_manpower_reservation(p_id,p_reason);
end $$;
create function public.schedule_manpower_reservation(p_id uuid,p_expected_revision bigint,p_date date,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  perform manpower_private.lock_source_snapshot(public.current_tenant_id());
  return manpower_private.schedule_manpower_reservation(p_id,p_expected_revision,p_date,p_reason);
end $$;
create function public.confirm_manpower_deployments(p_token text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  perform manpower_private.lock_source_snapshot(public.current_tenant_id());
  return manpower_private.confirm_manpower_deployments(p_token,p_items);
end $$;
create function public.record_manpower_identity_review(p_candidate text,p_employee text,p_decision text,p_reason text,
  p_candidate_fingerprint text,p_employee_fingerprint text,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  perform manpower_private.lock_source_snapshot(public.current_tenant_id());
  return manpower_private.record_manpower_identity_review(p_candidate,p_employee,p_decision,p_reason,
    p_candidate_fingerprint,p_employee_fingerprint,p_expected_revision);
end $$;
create function public.record_manpower_identity_review(p_candidate text,p_employee text,p_decision text,p_reason text,
  p_candidate_fingerprint text,p_employee_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public as $$ begin
  perform manpower_private.lock_source_snapshot(public.current_tenant_id());
  return manpower_private.record_manpower_identity_review(p_candidate,p_employee,p_decision,p_reason,
    p_candidate_fingerprint,p_employee_fingerprint);
end $$;
revoke all on function public.reserve_manpower_applicants(text,jsonb),public.release_manpower_reservation(uuid,text),
  public.schedule_manpower_reservation(uuid,bigint,date,text),public.confirm_manpower_deployments(text,jsonb),
  public.record_manpower_identity_review(text,text,text,text,text,text,bigint),
  public.record_manpower_identity_review(text,text,text,text,text,text) from public,anon;
grant execute on function public.reserve_manpower_applicants(text,jsonb),public.release_manpower_reservation(uuid,text),
  public.schedule_manpower_reservation(uuid,bigint,date,text),public.confirm_manpower_deployments(text,jsonb),
  public.record_manpower_identity_review(text,text,text,text,text,text,bigint),
  public.record_manpower_identity_review(text,text,text,text,text,text) to authenticated;

create function public.guard_manpower_source_snapshot() returns trigger
language plpgsql security definer set search_path=public as $$
declare source public.hr_records;target uuid;row_tenants uuid[];
begin
  if tg_op='DELETE' then source:=old;else source:=new;end if;
  if source.module not in ('employees','onboardingCandidates','oncall','manpowerSlots')
    and (tg_op<>'UPDATE' or old.module not in ('employees','onboardingCandidates','oncall','manpowerSlots')) then
    if tg_op='DELETE' then return old;end if;return new;
  end if;
  if tg_op='UPDATE' then row_tenants:=array[old.tenant_id,new.tenant_id];else row_tenants:=array[source.tenant_id];end if;
  for target in select distinct value from unnest(row_tenants) value order by value loop
    perform manpower_private.lock_source_snapshot(target);
  end loop;
  -- Run before the existing source guard so it sees committed assignment state after waiting.
  if tg_op<>'DELETE' and new.module='manpowerSlots' and exists(select 1 from public.hr_manpower_reservations r
    where r.tenant_id=new.tenant_id and r.state in ('Reserved','Scheduled','Deployed')
      and (r.candidate_id=new.data->>'candidateId' or r.employee_id=new.data->>'employeeId')) then
    raise exception 'Resolve typed assignments before adding legacy slots' using errcode='23514';
  end if;
  if tg_op<>'DELETE' and new.module='oncall' and exists(select 1 from public.hr_manpower_reservations r
    join public.hr_records e on e.tenant_id=r.tenant_id and e.module='employees' and e.record_id=r.employee_id
    where r.tenant_id=new.tenant_id and r.state='Deployed'
      and (r.employee_id=new.data->>'employeeId' or r.candidate_id=new.data->>'candidateId'
        or public.manpower_identity_name_key(e.data)=public.manpower_identity_name_key(jsonb_build_object('name',new.data->>'employeeName')))) then
    raise exception 'Active primary deployment requires controlled on-call conflict review, not a legacy write' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.guard_manpower_source_snapshot() from public,anon,authenticated;
create trigger manpower_00_source_snapshot_guard before insert or update or delete on public.hr_records
  for each row execute function public.guard_manpower_source_snapshot();
commit;
