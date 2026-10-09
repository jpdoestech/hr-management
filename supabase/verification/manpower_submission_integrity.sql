-- Read-only checks AFTER reviewed proposal 0036 is deployed.
-- All three exception queries should return zero rows.
begin transaction isolation level repeatable read read only;

select request.tenant_id,request.id,line.id line_id,request.state,
  line.original_requested,line.current_authorized
from public.hr_manpower_requests request
left join public.hr_manpower_lines line on line.tenant_id=request.tenant_id and line.request_id=request.id
where (request.state='Open' and (request.submitted_at is null or request.submitted_by is null
  or line.id is null or line.original_requested is null))
  or (request.state='Draft' and (request.submitted_at is not null or line.original_requested is not null));

select line.tenant_id,line.id line_id,history.audit_id
from public.hr_manpower_lines line
join public.hr_manpower_requests request on request.tenant_id=line.tenant_id and request.id=line.request_id
left join public.hr_manpower_quantity_history history on history.tenant_id=line.tenant_id and history.line_id=line.id and history.event_type='Submitted'
left join public.hr_audit_logs audit on audit.id=history.audit_id
where request.state='Open' and (history.line_id is null
  or history.original_requested is distinct from line.original_requested
  or history.original_requested is distinct from history.current_authorized
  or audit.id is null or audit.tenant_id is distinct from line.tenant_id
  or audit.user_id is distinct from request.submitted_by);

select history.tenant_id,history.line_id
from public.hr_manpower_quantity_history history
join public.hr_manpower_lines line on line.tenant_id=history.tenant_id and line.id=history.line_id
join public.hr_manpower_requests request on request.tenant_id=line.tenant_id and request.id=line.request_id
where request.state<>'Open';

rollback;
