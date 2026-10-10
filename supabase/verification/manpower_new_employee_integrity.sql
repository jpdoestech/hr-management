-- Read-only owner checks. History remains valid after later employment changes.
select b.token from manpower_private.new_employee_batches b
left join public.hr_records e on e.tenant_id=b.tenant_id and e.module='employees' and e.record_id=b.employee_id
left join public.hr_manpower_reservations r on r.tenant_id=b.tenant_id and r.id=b.reservation_id
where e.record_id is null or e.data->>'id' is distinct from b.employee_id
  or r.employee_id is distinct from b.employee_id or r.candidate_id is distinct from b.candidate_id
  or r.worker_key is distinct from 'employee:'||b.employee_id
  or not exists(select 1 from manpower_private.handoff_batches h where h.tenant_id=b.tenant_id and h.actor_id=b.actor_id
    and h.token='new-hire:'||md5(b.token) and h.employee_id=b.employee_id and h.reservation_id=b.reservation_id)
  or not exists(select 1 from public.hr_audit_logs a where a.id=b.audit_id and a.tenant_id=b.tenant_id and a.user_id=b.actor_id);

select transaction_id,record_id from manpower_private.source_intents;
select 'creation evidence exposed' as issue where has_table_privilege('authenticated','manpower_private.new_employee_batches','SELECT')
  or has_table_privilege('anon','manpower_private.new_employee_batches','SELECT');
