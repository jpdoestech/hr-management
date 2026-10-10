-- Read-only checks after reviewed 0058 deployment. Every result must be empty.
select * from public.hr_manpower_amendment_intents;

select amendment.tenant_id,amendment.request_id,amendment.request_revision
from public.hr_manpower_header_amendments amendment
join public.hr_manpower_requests request on request.tenant_id=amendment.tenant_id and request.id=amendment.request_id
left join public.hr_audit_logs audit on audit.id=amendment.audit_id
where audit.id is null or audit.tenant_id is distinct from amendment.tenant_id or audit.user_id is null
  or amendment.request_revision>request.revision or amendment.before_header=amendment.after_header;

with sequence as (
  select amendment.*,lag(after_header) over(partition by tenant_id,request_id order by request_revision) prior_values,
    row_number() over(partition by tenant_id,request_id order by request_revision desc) latest
  from public.hr_manpower_header_amendments amendment
)
select sequence.tenant_id,sequence.request_id,sequence.request_revision
from sequence join public.hr_manpower_requests request on request.tenant_id=sequence.tenant_id and request.id=sequence.request_id
where (sequence.prior_values is not null and sequence.before_header<>sequence.prior_values)
  or (sequence.latest=1 and sequence.after_header<>jsonb_build_object(
    'prf_number',request.prf_number,'requested_by',request.requested_by,'date_requested',request.date_requested,
    'target_date',request.target_date,'priority',request.priority,'remarks',request.remarks));
