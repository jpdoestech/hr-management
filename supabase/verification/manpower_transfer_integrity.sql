-- Read-only owner checks; no production acceptance implied.
with deployments as (
  select tenant_id,'reservation'::text kind,id,employee_id,actual_date,ended_date from public.hr_manpower_reservations
  union all select tenant_id,'operational',id,employee_id,actual_date,ended_date from public.hr_manpower_operational_deployments
)
select h.batch_token from public.hr_manpower_transfer_history h
left join deployments s on s.tenant_id=h.tenant_id and s.kind=h.source_kind and s.id=h.source_id
left join deployments t on t.tenant_id=h.tenant_id and t.kind=h.target_kind and t.id=h.target_id
left join manpower_private.transfer_batches b on b.tenant_id=h.tenant_id and b.actor_id=h.actor_id and b.token=h.batch_token
where s.id is null or t.id is null or b.token is null
  or s.employee_id is distinct from h.employee_id or t.employee_id is distinct from h.employee_id
  or s.actual_date is distinct from h.source_actual_date or s.ended_date is distinct from h.transferred_date
  or t.actual_date is distinct from h.transferred_date or b.audit_id is distinct from h.audit_id
  or b.target_id is distinct from h.target_id or b.target_kind is distinct from h.target_kind
  or b.payload->>'source_id' is distinct from h.source_id::text or b.payload->>'source_kind' is distinct from h.source_kind
  or b.payload->>'date' is distinct from h.transferred_date::text or b.payload->>'reason' is distinct from h.reason
  or not exists(select 1 from public.hr_audit_logs a where a.id=h.audit_id and a.tenant_id=h.tenant_id and a.user_id=h.actor_id);
select b.token from manpower_private.transfer_batches b where not exists(select 1 from public.hr_manpower_transfer_history h
  where h.tenant_id=b.tenant_id and h.actor_id=b.actor_id and h.batch_token=b.token);
select 'transfer evidence exposed' as issue where has_table_privilege('authenticated','manpower_private.transfer_batches','SELECT')
  or has_table_privilege('authenticated','public.hr_manpower_transfer_history','UPDATE');
