-- Read-only checks after verified 0042 deployment. Every result must be empty.
select * from public.hr_manpower_amendment_intents;

select event.tenant_id,event.request_id,event.request_revision
from public.hr_manpower_lifecycle_history event
join public.hr_manpower_requests request on request.tenant_id=event.tenant_id and request.id=event.request_id
left join public.hr_audit_logs audit on audit.id=event.audit_id
where audit.id is null or audit.tenant_id is distinct from event.tenant_id or audit.user_id is null
  or event.request_revision>request.revision
  or not ((event.operation='CancelLine' and event.previous_state='Open' and event.current_state='Open')
    or (event.operation in ('Close','Cancel') and event.previous_state='Open'
      and event.current_state=case event.operation when 'Close' then 'Closed' else 'Cancelled' end)
    or (event.operation='Reopen' and event.previous_state in ('Closed','Cancelled') and event.current_state='Open'))
  or (event.operation='Reopen' and event.line_changes<>'[]'::jsonb);

with sequence as (
  select event.*,lag(current_state) over(partition by tenant_id,request_id order by request_revision) prior_state,
    row_number() over(partition by tenant_id,request_id order by request_revision desc) latest
  from public.hr_manpower_lifecycle_history event
)
select sequence.tenant_id,sequence.request_id,sequence.request_revision
from sequence join public.hr_manpower_requests request on request.tenant_id=sequence.tenant_id and request.id=sequence.request_id
where sequence.previous_state<>coalesce(sequence.prior_state,'Open')
  or (sequence.latest=1 and sequence.current_state<>request.state);

with facts as (
  select event.tenant_id,event.request_id,event.request_revision,change,
    lag((change->>'current_cancelled')::integer) over(partition by event.tenant_id,change->>'line_id' order by event.request_revision) prior_cancelled,
    row_number() over(partition by event.tenant_id,change->>'line_id' order by event.request_revision desc) latest
  from public.hr_manpower_lifecycle_history event cross join lateral jsonb_array_elements(event.line_changes) change
)
select facts.tenant_id,facts.request_id,facts.request_revision,facts.change->>'line_id' line_id
from facts left join public.hr_manpower_lines line on line.tenant_id=facts.tenant_id and line.id=facts.change->>'line_id'
where line.id is null or line.request_id<>facts.request_id
  or (facts.change->>'original_requested')::integer is distinct from line.original_requested
  or (facts.change->>'current_cancelled')::integer<=(facts.change->>'previous_cancelled')::integer
  or (facts.prior_cancelled is not null and (facts.change->>'previous_cancelled')::integer<>facts.prior_cancelled)
  or (facts.latest=1 and (facts.change->>'current_cancelled')::integer<>line.cancelled_unfilled);

select request.tenant_id,request.id,line.id line_id
from public.hr_manpower_requests request
join public.hr_manpower_lines line on line.tenant_id=request.tenant_id and line.request_id=request.id
where request.state in ('Closed','Cancelled') and exists(select 1 from public.hr_manpower_reservations reservation
  where reservation.tenant_id=line.tenant_id and reservation.line_id=line.id and reservation.state in ('Reserved','Scheduled'));
