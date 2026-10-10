import {validateManpowerDraft} from '../core/manpower-draft.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

export function reviewManpowerSubmission(draft,catalogs,saved=draft){
  const payload=validateManpowerDraft(draft,catalogs);
  const errors=[...payload.errors];
  if(draft.unknownClient)errors.push('Select a Client Account from the suggestions.');
  for(const [key,label] of [['prf_number','PRF Number'],['client_id','Client Account'],['branch_reporting','Reporting Branch'],['requested_by','Requested By'],['date_requested','Date Requested'],['target_date','Target Deployment Date']]){
    if(!payload.header[key])errors.push(`${label} is required before submission.`);
  }
  if(payload.header.client_id&&!catalogs.clients.some(row=>row.id===payload.header.client_id&&row.active))errors.push('An active Client Account is required before submission.');
  if(!payload.lines.length)errors.push('Add at least one complete requisition line.');
  payload.lines.forEach((line,index)=>{
    if(!line.department||!line.position||!line.current_authorized)errors.push(`Line ${index+1}: department, position and positive headcount are required.`);
  });
  const revision=Number(saved.request.revision);
  if(!Number.isSafeInteger(revision)||revision<1)errors.push('Save the draft before reviewing it for submission.');
  if(saved.request.state&&saved.request.state!=='Draft')errors.push('Only a saved draft can be submitted.');
  const persisted=validateManpowerDraft(saved,catalogs);
  const signature=JSON.stringify({id:saved.request.id,revision,header:payload.header,lines:payload.lines});
  if(draft.request.id!==saved.request.id||JSON.stringify([payload.header,payload.lines])!==JSON.stringify([persisted.header,persisted.lines]))errors.push('Save your changes before reviewing this draft for submission.');
  return {id:saved.request.id,revision,header:payload.header,lines:payload.lines,signature,errors,
    total:payload.lines.reduce((sum,line)=>sum+(typeof line.current_authorized==='number'?line.current_authorized:0),0)};
}

export function manpowerSubmissionReviewHTML(review,catalogs){
  const client=catalogs.clients.find(row=>row.id===review.header.client_id);
  return `<section id="md_submission_review" class="manpower-submission-review" tabindex="-1" aria-labelledby="md_review_title"><div class="settings-section-head"><h3 id="md_review_title">Review submission</h3><button type="button" class="btn btn-ghost btn-sm" onclick="manpowerDraftCloseReview()">Back to editing</button></div><dl class="manpower-submission-summary">${[['PRF Number',review.header.prf_number],['Client',client?.name],['Reporting Branch',review.header.branch_reporting],['Requested By',review.header.requested_by],['Date Requested',review.header.date_requested],['Target Deployment',review.header.target_date],['Requisition Lines',review.lines.length],['Requested Headcount',review.total]].map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><div class="tablewrap" tabindex="0" role="region" aria-label="Submission line review"><table class="data-table" data-table-tools="external"><caption class="sr-only">Saved requisition lines to submit</caption><thead><tr>${['Line','Department','Position','Headcount','Demand Type','Target','Site / Purpose'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${review.lines.map((line,index)=>`<tr><td>${index+1}</td><td>${escape(line.department)}</td><td>${escape(line.position)}</td><td>${escape(line.current_authorized)}</td><td>${escape(line.demand_type)}</td><td>${escape(line.target_date||review.header.target_date)}</td><td>${escape(line.site||'Not specified')}<div class="cell-secondary">${escape(line.purpose)}</div></td></tr>`).join('')}</tbody></table></div><p class="small">Submission opens this request and records its original headcount. It does not reserve applicants or confirm deployment.</p><button id="md_submit" type="button" class="btn btn-primary" onclick="submitManpowerDraft()" data-confirm-change="false">Submit / Open Request</button></section>`;
}

export function manpowerSubmissionError(error){
  if(['PGRST202','42883'].includes(error.code))return 'Submission is not enabled in this database. Ask the System Administrator to complete the reviewed manpower release setup. Your draft is unchanged.';
  if(error.code==='40001')return 'This draft changed. Keep your entries and reload the latest saved draft before reviewing again.';
  if(error.code==='23505')return 'PRF number already exists in this organization. Use another number.';
  if(error.code==='42501')return 'Submission access denied. Check your permission and request scope.';
  return error.message||'Submission could not be confirmed. Reload the request to check its current state before retrying.';
}
