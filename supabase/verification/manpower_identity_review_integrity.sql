-- Read-only operator diagnostic after verified 0038 deployment.
-- Missing/stale sources are reconciliation exceptions, never automatic relinks.
select review.tenant_id,review.candidate_id,review.employee_id,
  case when candidate.record_id is null or employee.record_id is null then 'Missing source'
    when candidate.data->>'id' is distinct from review.candidate_id or employee.data->>'id' is distinct from review.employee_id then 'Identifier mismatch'
    when md5(candidate.data::text)<>review.candidate_fingerprint or md5(employee.data::text)<>review.employee_fingerprint then 'Source changed since review'
    else 'Audit mismatch' end exception
from public.hr_manpower_identity_reviews review
left join public.hr_records candidate on candidate.tenant_id=review.tenant_id and candidate.module='onboardingCandidates' and candidate.record_id=review.candidate_id
left join public.hr_records employee on employee.tenant_id=review.tenant_id and employee.module='employees' and employee.record_id=review.employee_id
left join public.hr_audit_logs audit on audit.id=review.audit_id
where candidate.record_id is null or employee.record_id is null
  or candidate.data->>'id' is distinct from review.candidate_id or employee.data->>'id' is distinct from review.employee_id
  or md5(candidate.data::text)<>review.candidate_fingerprint or md5(employee.data::text)<>review.employee_fingerprint
  or audit.tenant_id is distinct from review.tenant_id or audit.user_id is distinct from review.reviewed_by;
