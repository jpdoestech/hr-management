-- Owner/operator read-only checks after 0048; not live acceptance evidence.
select transaction_id,record_id from manpower_private.source_intents;

select b.token from manpower_private.handoff_batches b
join public.hr_manpower_reservations r on r.tenant_id=b.tenant_id and r.id=b.reservation_id
where r.employee_id is distinct from b.employee_id or r.worker_key is distinct from 'employee:'||b.employee_id
  or r.candidate_id is distinct from b.payload->>'candidate_id'
  or not exists(select 1 from public.hr_manpower_identity_reviews review where review.tenant_id=b.tenant_id
    and review.candidate_id=r.candidate_id and review.employee_id=b.employee_id and review.decision='SamePerson' and review.audit_id=b.audit_id)
  or not exists(select 1 from public.hr_audit_logs audit where audit.id=b.audit_id and audit.tenant_id=b.tenant_id and audit.user_id=b.actor_id);

select 'handoff storage exposed' as issue where has_table_privilege('authenticated','manpower_private.source_intents','INSERT')
  or has_table_privilege('authenticated','manpower_private.handoff_batches','SELECT');
