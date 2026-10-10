-- Read-only check of 0046-created facts. Pre-existing actual facts need separate reconciliation.
select h.reservation_id from public.hr_manpower_confirmation_history h
join public.hr_manpower_reservations r on r.tenant_id=h.tenant_id and r.id=h.reservation_id
join public.hr_manpower_confirmation_batches b on b.tenant_id=h.tenant_id and b.actor_id=h.actor_id and b.token=h.batch_token
where r.state not in ('Deployed','Ended','Reversed') or r.actual_date is distinct from h.actual_date
  or r.confirmation_audit_id is distinct from h.audit_id or b.audit_id is distinct from h.audit_id
  or b.confirmed_at is distinct from h.confirmed_at
  or not exists(select 1 from public.hr_manpower_identity_reviews review where review.tenant_id=h.tenant_id
    and review.candidate_id=r.candidate_id and review.employee_id=r.employee_id
    and review.decision='SamePerson' and review.audit_id=h.identity_audit_id)
  or not exists(select 1 from public.hr_audit_logs audit where audit.id=h.audit_id
    and audit.tenant_id=h.tenant_id and audit.user_id=h.actor_id)
  or not exists(select 1 from jsonb_array_elements(b.payload) item
    where item->>'reservation_id'=h.reservation_id::text and (item->>'actual_date')::date=h.actual_date
      and (item->>'schedule_revision')::bigint=h.schedule_revision and item->>'reason'=h.reason);

select b.token from public.hr_manpower_confirmation_batches b
where jsonb_array_length(b.payload)<>(select count(*) from public.hr_manpower_confirmation_history h
  where h.tenant_id=b.tenant_id and h.actor_id=b.actor_id and h.batch_token=b.token);
