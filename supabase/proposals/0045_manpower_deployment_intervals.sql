-- Gated prerequisite only: no actual confirmation/transfer API is enabled here.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions;
create extension if not exists btree_gist with schema extensions;
do $$ begin
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='btree_gist' and n.nspname='extensions') then
    raise exception 'btree_gist must be installed in extensions; review the existing installation first';
  end if;
end $$;
lock table public.hr_manpower_reservations in share row exclusive mode;

create function public.guard_manpower_deployment_dates()
returns trigger language plpgsql set search_path=public as $$
declare today date:=(now() at time zone 'Asia/Manila')::date;
begin
  if new.state in ('Deployed','Ended','Reversed') then
    if new.actual_date is null or not isfinite(new.actual_date) or new.actual_date>today
      or (new.state='Deployed' and new.ended_date is not null)
      or (new.state='Ended' and new.ended_date is null)
      or (new.ended_date is not null and (not isfinite(new.ended_date)
        or new.ended_date<=new.actual_date or new.ended_date>today)) then
      raise exception 'Actual dates must be finite and not future; end is the first unassigned day and must follow start'
        using errcode='23514';
    end if;
  elsif new.ended_date is not null then
    raise exception 'Planning and released reservations cannot have an actual end date' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_manpower_deployment_dates() from public,anon,authenticated;

-- Reject incompatible history without rewriting or removing it.
do $$ begin
  if exists(select 1 from public.hr_manpower_reservations where
    (state in ('Deployed','Ended','Reversed') and
      (actual_date is null or not isfinite(actual_date) or actual_date>(now() at time zone 'Asia/Manila')::date
      or (state='Deployed' and ended_date is not null) or (state='Ended' and ended_date is null)
      or (ended_date is not null and (not isfinite(ended_date) or ended_date<=actual_date
        or ended_date>(now() at time zone 'Asia/Manila')::date))))
    or (state not in ('Deployed','Ended','Reversed') and ended_date is not null)) then
    raise exception 'Existing deployment dates require reconciliation; no history was changed';
  end if;
end $$;
create trigger manpower_deployment_dates_guard before insert or update on public.hr_manpower_reservations
  for each row execute function public.guard_manpower_deployment_dates();

-- Half-open intervals allow old end = new start, including backdated transfers.
-- Reversed credits are retained for audit but no longer effective assignments.
alter table public.hr_manpower_reservations add constraint manpower_primary_deployment_no_overlap
  exclude using gist (tenant_id with =, employee_id with =,
    (daterange(actual_date,case when state='Deployed' then null else ended_date end,'[)')) with &&)
  where (state in ('Deployed','Ended'));
commit;
