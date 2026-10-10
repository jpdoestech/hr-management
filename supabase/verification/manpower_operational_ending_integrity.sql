-- Read-only owner checks for standalone endings; transferred and legacy endings remain distinct.
select h.deployment_id from public.hr_manpower_operational_ending_history h
left join public.hr_manpower_operational_deployments o on o.tenant_id=h.tenant_id and o.id=h.deployment_id
left join manpower_private.operational_ending_batches b on b.tenant_id=h.tenant_id and b.actor_id=h.actor_id and b.token=h.batch_token
where o.id is null or b.token is null or o.state<>'Ended'
  or o.actual_date is distinct from h.actual_date or o.ended_date is distinct from h.ended_date
  or o.end_reason is distinct from h.reason or o.end_audit_id is distinct from h.audit_id or b.audit_id is distinct from h.audit_id
  or not exists(select 1 from jsonb_array_elements(b.payload) item where item->>'deployment_id'=h.deployment_id::text
    and item->>'ended_date'=h.ended_date::text and item->>'reason'=h.reason)
  or not exists(select 1 from public.hr_audit_logs a where a.id=h.audit_id and a.tenant_id=h.tenant_id and a.user_id=h.actor_id);
select b.token from manpower_private.operational_ending_batches b where jsonb_array_length(b.payload)<>(
  select count(*) from public.hr_manpower_operational_ending_history h where h.tenant_id=b.tenant_id and h.actor_id=b.actor_id and h.batch_token=b.token);
select 'operational ending evidence exposed' as issue where has_table_privilege('authenticated','manpower_private.operational_ending_batches','SELECT')
  or has_table_privilege('authenticated','public.hr_manpower_operational_ending_history','UPDATE');
