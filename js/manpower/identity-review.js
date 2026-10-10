const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function identityPreviewValid(data,candidate,employee){
  return Boolean(data&&typeof candidate==='string'&&candidate&&typeof employee==='string'&&employee&&data.candidate_id===candidate&&data.employee_id===employee&&
    /^[a-f0-9]{32}$/.test(data.candidate_fingerprint||'')&&/^[a-f0-9]{32}$/.test(data.employee_fingerprint||'')&&
    Number.isSafeInteger(data.review_revision)&&data.review_revision>=0);
}
export function identityReviewPayload(preview,employee,decision,reason){
  const errors={},note=String(reason??'').trim();
  if(!identityPreviewValid(preview,preview?.candidate_id,employee))errors.preview='Select an employee and load the current comparison before saving.';
  if(!['SamePerson','SeparatePersons'].includes(decision))errors.decision='Choose a manual identity decision.';
  if(!note||note.length>1000)errors.reason='Enter a review reason between 1 and 1000 characters.';
  return {errors,payload:{p_candidate:preview?.candidate_id,p_employee:employee,p_decision:decision,p_reason:note,p_candidate_fingerprint:preview?.candidate_fingerprint,p_employee_fingerprint:preview?.employee_fingerprint,p_expected_revision:Number(preview?.review_revision)}};
}
export function identityComparisonHTML(data){
  return `<div class="formgrid"><div class="field"><label>Applicant</label><b>${escape(data.candidate_name||'Name unavailable')}</b><span class="small">${escape(data.candidate_department||'Unassigned')}</span></div><div class="field"><label>Employee</label><b>${escape(data.employee_name||'Name unavailable')}</b><span class="small">${escape(data.employee_department||'Unassigned')}</span></div></div><p class="small">Review revision: ${escape(data.review_revision)}. ${data.previous_decision?'Previous decision: '+escape(data.previous_decision)+'. ':''}${data.source_changed?'Source records changed since the previous review. ':''}${data.linked_employee_id?'An existing conversion link must be preserved. ':''}Review identity evidence manually; similarity is not proof.</p>`;
}
export function identityReviewResultValid(data,payload){
  return data?.candidate_id===payload.p_candidate&&data?.employee_id===payload.p_employee&&data?.decision===payload.p_decision&&data?.reason===payload.p_reason&&
    data?.candidate_fingerprint===payload.p_candidate_fingerprint&&data?.employee_fingerprint===payload.p_employee_fingerprint&&
    Number(data.revision)===payload.p_expected_revision+1&&typeof data.audit_id==='string'&&Boolean(data.audit_id);
}
export function identityReviewError(error){
  if(['PGRST202','42883'].includes(error.code))return 'Identity review is not enabled in this database. Ask the System Administrator to complete the reviewed release setup.';
  if(error.code==='42501')return 'Identity review access denied. Check your applicant, employee and identity-review permissions and scope.';
  if(error.code==='40001')return 'The sources or review changed. Entries are retained; refresh the comparison and review it before saving again.';
  if(error.code==='23514')return 'The decision conflicts with existing identity or assignment evidence. Reconcile the records with HR before proceeding.';
  return 'The identity review could not be confirmed. Check saved review history before retrying; your entries are retained.';
}
