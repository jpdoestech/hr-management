-- Read-only owner verification; the private interval index is derived, not history.
with expected as (
  select tenant_id,'reservation'::text source_kind,id source_id,employee_id,actual_date,ended_date
    from public.hr_manpower_reservations where state in ('Deployed','Ended')
  union all
  select tenant_id,'operational',id,employee_id,actual_date,ended_date from public.hr_manpower_operational_deployments
)
select coalesce(e.source_id,p.source_id) source_id from expected e full join manpower_private.primary_intervals p
  on p.tenant_id=e.tenant_id and p.source_kind=e.source_kind and p.source_id=e.source_id
where e.source_id is null or p.source_id is null or (e.employee_id,e.actual_date,e.ended_date) is distinct from (p.employee_id,p.actual_date,p.ended_date);

select transaction_id,source_id from manpower_private.operational_intents;
select 'operational storage exposed' as issue where has_table_privilege('authenticated','manpower_private.primary_intervals','SELECT')
  or has_table_privilege('authenticated','manpower_private.operational_intents','INSERT')
  or has_table_privilege('authenticated','public.hr_manpower_operational_deployments','INSERT');
