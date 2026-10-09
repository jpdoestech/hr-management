-- Read-only after verified 0040 deployment. Each result is a reconciliation exception.
select reservation.tenant_id,reservation.id
from public.hr_manpower_reservations reservation
left join public.hr_manpower_reservation_batches batch on batch.tenant_id=reservation.tenant_id
  and batch.actor_id=reservation.created_by and batch.token=reservation.batch_token
left join public.hr_audit_logs audit on audit.id=batch.audit_id
left join public.hr_records candidate on candidate.tenant_id=reservation.tenant_id
  and candidate.module='onboardingCandidates' and candidate.record_id=reservation.candidate_id
left join public.hr_audit_logs release_audit on release_audit.id=reservation.release_audit_id
where audit.tenant_id is distinct from reservation.tenant_id or audit.user_id is distinct from reservation.created_by
  or candidate.record_id is null or candidate.data->>'id' is distinct from reservation.candidate_id
  or not exists(select 1 from jsonb_array_elements(batch.payload) item where item->>'candidate_id'=reservation.candidate_id and item->>'line_id'=reservation.line_id)
  or (reservation.state='Released' and release_audit.tenant_id is distinct from reservation.tenant_id);

select line.tenant_id,line.id,line.current_authorized,line.cancelled_unfilled,
  count(reservation.id) filter(where reservation.state in ('Reserved','Scheduled')) reserved,
  count(reservation.id) filter(where reservation.state in ('Deployed','Ended')) fulfilled
from public.hr_manpower_lines line left join public.hr_manpower_reservations reservation
  on reservation.tenant_id=line.tenant_id and reservation.line_id=line.id
where line.original_requested is not null
group by line.tenant_id,line.id,line.current_authorized,line.cancelled_unfilled
having line.current_authorized-line.cancelled_unfilled<count(reservation.id) filter(where reservation.state in ('Reserved','Scheduled','Deployed','Ended'));

select * from public.hr_manpower_reservation_intents;
