-- Read-only checks after verified 0037 deployment; each result must be empty.
select * from public.hr_manpower_amendment_intents;

select amendment.tenant_id,amendment.line_id,amendment.request_revision
from public.hr_manpower_quantity_amendments amendment
join public.hr_manpower_lines line on line.tenant_id=amendment.tenant_id and line.id=amendment.line_id
join public.hr_manpower_requests request on request.tenant_id=line.tenant_id and request.id=line.request_id
left join public.hr_audit_logs audit on audit.id=amendment.audit_id
where audit.id is null or audit.tenant_id is distinct from amendment.tenant_id
  or audit.user_id is null or amendment.request_revision>request.revision
  or line.original_requested is null;

with sequence as (
  select tenant_id,line_id,request_revision,previous_authorized,current_authorized,
    lag(current_authorized) over(partition by tenant_id,line_id order by request_revision) as prior_quantity,
    row_number() over(partition by tenant_id,line_id order by request_revision desc) as latest
  from public.hr_manpower_quantity_amendments
)
select sequence.tenant_id,sequence.line_id,sequence.request_revision
from sequence join public.hr_manpower_lines line on line.tenant_id=sequence.tenant_id and line.id=sequence.line_id
where sequence.previous_authorized<>coalesce(sequence.prior_quantity,line.original_requested)
  or (sequence.latest=1 and sequence.current_authorized<>line.current_authorized);
