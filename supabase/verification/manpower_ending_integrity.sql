-- Read-only owner checks after 0051. Reversal remains a separate future workflow.
select h.reservation_id from public.hr_manpower_ending_history h
left join public.hr_manpower_reservations r on r.tenant_id=h.tenant_id and r.id=h.reservation_id
where r.id is null or r.state not in ('Ended','Reversed')
  or r.actual_date is distinct from h.actual_date or r.ended_date is distinct from h.ended_date
  or r.confirmation_audit_id is distinct from h.confirmation_audit_id
  or not exists(select 1 from manpower_private.ending_batches b cross join jsonb_array_elements(b.payload) item
    where b.tenant_id=h.tenant_id and b.actor_id=h.actor_id and b.token=h.batch_token and b.audit_id=h.audit_id
      and item->>'reservation_id'=h.reservation_id::text and item->>'reason'=h.reason
      and (item->>'actual_date')::date=h.actual_date and (item->>'ended_date')::date=h.ended_date
      and item->>'confirmation_audit_id'=h.confirmation_audit_id::text)
  or not exists(select 1 from public.hr_audit_logs a where a.id=h.audit_id and a.tenant_id=h.tenant_id and a.user_id=h.actor_id);

select b.token from manpower_private.ending_batches b
where jsonb_array_length(b.payload)<>(select count(*) from public.hr_manpower_ending_history h
  where h.tenant_id=b.tenant_id and h.actor_id=b.actor_id and h.batch_token=b.token and h.audit_id=b.audit_id);
select transaction_id,reservation_id from public.hr_manpower_reservation_intents;
select 'ending evidence exposed' as issue where has_table_privilege('authenticated','manpower_private.ending_batches','SELECT')
  or has_table_privilege('anon','public.hr_manpower_ending_history','SELECT')
  or has_table_privilege('authenticated','public.hr_manpower_ending_history','UPDATE');
