-- Read-only owner checks. Links are informative, not capacity units.
with deployments as (
  select tenant_id,'reservation'::text kind,id,employee_id,actual_date,ended_date,state from public.hr_manpower_reservations
  union all select tenant_id,'operational',id,employee_id,actual_date,ended_date,state from public.hr_manpower_operational_deployments
)
select s.line_id,s.source_id from public.hr_manpower_replacement_sources s
left join deployments d on d.tenant_id=s.tenant_id and d.kind=s.source_kind and d.id=s.source_id
left join public.hr_manpower_lines l on l.tenant_id=s.tenant_id and l.id=s.line_id
left join manpower_private.replacement_link_batches b on b.tenant_id=s.tenant_id and b.actor_id=s.actor_id and b.token=s.batch_token
where d.id is null or l.id is null or b.token is null or d.state<>'Ended' or l.demand_type<>'Replacement'
  or d.employee_id is distinct from s.employee_id or d.actual_date is distinct from s.actual_date or d.ended_date is distinct from s.ended_date
  or b.audit_id is distinct from s.audit_id or b.payload->>'line_id' is distinct from s.line_id
  or not exists(select 1 from jsonb_array_elements(b.payload->'items') item where item->>'source_kind'=s.source_kind
    and item->>'source_id'=s.source_id::text and item->>'reason'=s.reason)
  or not exists(select 1 from public.hr_audit_logs a where a.id=s.audit_id and a.tenant_id=s.tenant_id and a.user_id=s.actor_id);
select b.token from manpower_private.replacement_link_batches b where jsonb_array_length(b.payload->'items')<>(
  select count(*) from public.hr_manpower_replacement_sources s where s.tenant_id=b.tenant_id and s.actor_id=b.actor_id and s.batch_token=b.token);
select 'replacement evidence exposed' as issue where has_table_privilege('authenticated','manpower_private.replacement_link_batches','SELECT')
  or has_table_privilege('authenticated','public.hr_manpower_replacement_sources','UPDATE');
