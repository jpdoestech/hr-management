-- Read-only: run after 0045. Empty results are expected; not production acceptance.
select id,state from public.hr_manpower_reservations
where (state in ('Deployed','Ended','Reversed') and
  (actual_date is null or not isfinite(actual_date) or actual_date>(now() at time zone 'Asia/Manila')::date
  or (state='Deployed' and ended_date is not null) or (state='Ended' and ended_date is null)
  or (ended_date is not null and (not isfinite(ended_date) or ended_date<=actual_date
    or ended_date>(now() at time zone 'Asia/Manila')::date))))
  or (state not in ('Deployed','Ended','Reversed') and ended_date is not null);

select a.id,b.id as conflicting_id from public.hr_manpower_reservations a
join public.hr_manpower_reservations b on a.tenant_id=b.tenant_id and a.employee_id=b.employee_id and a.id<b.id
where a.state in ('Deployed','Ended') and b.state in ('Deployed','Ended')
  and daterange(a.actual_date,case when a.state='Deployed' then null else a.ended_date end,'[)')
    && daterange(b.actual_date,case when b.state='Deployed' then null else b.ended_date end,'[)');
