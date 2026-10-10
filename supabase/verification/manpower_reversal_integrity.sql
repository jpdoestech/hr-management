-- Read-only owner checks for 0057 corrections.
select h.reservation_id from public.hr_manpower_reversal_history h
left join public.hr_manpower_reservations r on r.tenant_id=h.tenant_id and r.id=h.reservation_id
left join manpower_private.reversal_batches b on b.tenant_id=h.tenant_id and b.actor_id=h.actor_id and b.token=h.batch_token
where r.id is null or b.token is null or r.state<>'Reversed' or h.credit_delta<>-1
  or r.actual_date is distinct from h.actual_date or r.ended_date is distinct from h.ended_date
  or r.confirmation_audit_id is distinct from h.confirmation_audit_id or b.audit_id is distinct from h.audit_id
  or b.payload->>'source_id' is distinct from h.reservation_id::text or b.payload->>'reason' is distinct from h.reason
  or b.before_row->>'state' is distinct from h.previous_state
  or (to_jsonb(r)-'state') is distinct from (b.before_row-'state')
  or not exists(select 1 from public.hr_audit_logs a where a.id=h.audit_id and a.tenant_id=h.tenant_id and a.user_id=h.actor_id)
  or exists(select 1 from manpower_private.primary_intervals i where i.tenant_id=h.tenant_id and i.source_kind='reservation' and i.source_id=h.reservation_id);
select b.token from manpower_private.reversal_batches b where not exists(select 1 from public.hr_manpower_reversal_history h
  where h.tenant_id=b.tenant_id and h.actor_id=b.actor_id and h.batch_token=b.token);
select 'reversal evidence exposed' as issue where has_table_privilege('authenticated','manpower_private.reversal_batches','SELECT')
  or has_table_privilege('authenticated','public.hr_manpower_reversal_history','UPDATE');
