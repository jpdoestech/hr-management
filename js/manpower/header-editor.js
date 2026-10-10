const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const HEADER_AMENDMENT_FIELDS={prf_number:'PRF Number',requested_by:'Requested By',date_requested:'Date Requested',target_date:'Target Deployment Date',priority:'Priority',remarks:'General Remarks'};
export function readHeaderAmendment(document){return Object.fromEntries(Object.keys(HEADER_AMENDMENT_FIELDS).map(key=>[key,document.getElementById('mp_header_'+key).value]));}
export function headerAmendmentPayload(request,values,reason){
  const errors={},header={},note=String(reason??'').trim();
  for(const key of Object.keys(HEADER_AMENDMENT_FIELDS)){
    header[key]=String(values[key]??'');if(key!=='remarks')header[key]=header[key].trim();
  }
  header.prf_number=header.prf_number.replace(/\s+/g,' ');
  if(!header.prf_number||header.prf_number.length>120)errors.prf_number='Enter a PRF number between 1 and 120 characters.';
  if(!header.requested_by||header.requested_by.length>120)errors.requested_by='Enter Requested By between 1 and 120 characters.';
  for(const key of ['date_requested','target_date']){
    const date=new Date(header[key]+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(header[key])||header[key].startsWith('0000')||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==header[key])errors[key]='Enter a complete valid date.';
  }
  if(!errors.date_requested&&!errors.target_date&&header.target_date<header.date_requested)errors.target_date='Target date cannot precede the request date.';
  if(!['Low','Normal','High','Urgent'].includes(header.priority))errors.priority='Select a valid priority.';
  if(header.remarks.length>10000)errors.remarks='Remarks cannot exceed 10000 characters.';
  if(!note||note.length>1000)errors.reason='Enter an amendment reason between 1 and 1000 characters.';
  if(request.state!=='Open'||!request.id||!Number.isSafeInteger(Number(request.revision))||Number(request.revision)<1)errors.request='Reload an open submitted request before amending its header.';
  const patch=Object.fromEntries(Object.entries(header).filter(([key,value])=>value!==String(request[key]??'')));
  if(!Object.keys(patch).length)errors.request='Change at least one header value before saving.';
  return {errors,payload:{p_id:request.id,p_expected_revision:Number(request.revision),p_header:patch,p_reason:note}};
}
export function headerEditorHTML(request){
  return `<section id="mp_header_editor" class="manpower-header-editor" aria-label="Amend request header"><h3>Amend Request Header</h3><div id="mp_header_error" role="alert" tabindex="-1" hidden></div><div class="manpower-header-fields">${Object.entries(HEADER_AMENDMENT_FIELDS).map(([key,label])=>{
    const error=`<span id="mp_header_${key}_error" class="small" hidden></span>`,linked=`aria-describedby="mp_header_${key}_error"`;
    const control=key==='remarks'?`<textarea id="mp_header_${key}" rows="2" maxlength="10000" ${linked}>${escape(request[key])}</textarea>`:key==='priority'?`<select id="mp_header_priority" ${linked}>${['Low','Normal','High','Urgent'].map(value=>`<option ${request.priority===value?'selected':''}>${value}</option>`).join('')}</select>`:`<input id="mp_header_${key}" type="${key.endsWith('date')||key==='date_requested'?'date':'text'}" value="${escape(request[key])}" ${linked} ${key.endsWith('date')||key==='date_requested'?'min="0001-01-01" max="9999-12-31"':'maxlength="120"'}>`;
    return `<div class="field"><label for="mp_header_${key}">${label}</label>${control}${error}</div>`;
  }).join('')}</div><div class="field"><label for="mp_header_reason">Amendment Reason</label><textarea id="mp_header_reason" rows="2" maxlength="1000" aria-describedby="mp_header_reason_error"></textarea><span id="mp_header_reason_error" class="small" hidden></span></div><p class="small">Client, branch, line quantities and worker assignments remain unchanged. Date changes do not reschedule deployments.</p><div class="rowactions"><button id="mp_header_save" type="button" class="btn btn-primary btn-sm" data-confirm-change="false" onclick="saveManpowerHeaderAmendment()">Save Header</button><button type="button" class="btn btn-ghost btn-sm" onclick="discardManpowerQuantityAmendment()">Discard</button></div></section>`;
}
export function headerAmendmentResultValid(data,request,payload){
  return data?.request?.id===request.id&&data.request.state===request.state&&Number(data.request.revision)===Number(request.revision)+1&&
    data.request.branch_reporting===request.branch_reporting&&data.request.client_id===request.client_id&&data.request.submitted_by===request.submitted_by&&new Date(data.request.submitted_at).getTime()===new Date(request.submitted_at).getTime()&&
    Object.keys(HEADER_AMENDMENT_FIELDS).every(key=>data.request[key]===(payload.p_header[key]??request[key]));
}
export function headerAmendmentError(error){
  if(['PGRST202','42883'].includes(error.code))return 'Header amendments are not enabled in this database. Ask the System Administrator to complete the reviewed release setup. Your entries are retained.';
  if(error.code==='23505')return 'This PRF number is already assigned in your organization. Enter a different number; your entries are retained.';
  if(error.code==='40001')return 'This request changed. Your entries are retained; discard and reload before reviewing a new header amendment.';
  if(error.code==='42501')return 'Header amendment access denied. Check your permission and request scope.';
  return error.message||'The header amendment could not be confirmed. Check the saved request and header history before retrying.';
}
export function headerHistoryChangesHTML(row){
  return `<details><summary>Changed header fields</summary><dl>${Object.entries(HEADER_AMENDMENT_FIELDS).filter(([key])=>row.before_header?.[key]!==row.after_header?.[key]).map(([key,label])=>`<dt>${label}</dt><dd><span>Previous: ${escape(row.before_header?.[key]||'Not specified')}</span><br><span>Current: ${escape(row.after_header?.[key]||'Not specified')}</span></dd>`).join('')}</dl></details>`;
}
