-- Read-only 0039 diagnostics. Historical fingerprints need not match current sources.
with sequence as (
  select review.*,lag(audit_id) over(partition by tenant_id,candidate_id,employee_id order by revision) previous_audit,
    row_number() over(partition by tenant_id,candidate_id,employee_id order by revision) expected_revision
  from public.hr_manpower_identity_reviews review
)
select sequence.tenant_id,sequence.candidate_id,sequence.employee_id,sequence.revision
from sequence left join public.hr_audit_logs audit on audit.id=sequence.audit_id
where sequence.revision<>sequence.expected_revision
  or sequence.supersedes_audit_id is distinct from sequence.previous_audit
  or audit.tenant_id is distinct from sequence.tenant_id or audit.user_id is distinct from sequence.reviewed_by;

with latest as (
  select distinct on(tenant_id,candidate_id,employee_id) * from public.hr_manpower_identity_reviews
    order by tenant_id,candidate_id,employee_id,revision desc
)
select latest.tenant_id,latest.candidate_id,latest.employee_id,latest.revision
from latest full join public.hr_manpower_identity_links link
  on link.tenant_id=latest.tenant_id and link.candidate_id=latest.candidate_id and link.employee_id=latest.employee_id
where (latest.decision='SamePerson' and link.revision is distinct from latest.revision)
  or (link.candidate_id is not null and (latest.decision is distinct from 'SamePerson' or latest.revision is distinct from link.revision));

with latest as (
  select distinct on(tenant_id,candidate_id,employee_id) * from public.hr_manpower_identity_reviews
    order by tenant_id,candidate_id,employee_id,revision desc
)
select latest.tenant_id,latest.candidate_id,latest.employee_id,latest.revision,'Source requires re-review' reason
from latest
left join public.hr_records candidate on candidate.tenant_id=latest.tenant_id and candidate.module='onboardingCandidates' and candidate.record_id=latest.candidate_id
left join public.hr_records employee on employee.tenant_id=latest.tenant_id and employee.module='employees' and employee.record_id=latest.employee_id
where candidate.record_id is null or employee.record_id is null
  or md5(candidate.data::text) is distinct from latest.candidate_fingerprint
  or md5(employee.data::text) is distinct from latest.employee_fingerprint;
