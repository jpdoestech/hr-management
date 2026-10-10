import {manpowerQuantity} from '../core/manpower-demand.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const LIFECYCLE_LABELS={Close:'Close request',Cancel:'Cancel request',Reopen:'Reopen request',CancelLine:'Cancel line demand'};
export function lifecycleOperations(state){return state==='Open'?['Close','Cancel']:['Closed','Cancelled'].includes(state)?['Reopen']:[];}
export function lifecycleActionsHTML(request,allowed=false,includeHeader=false){
  return allowed?`<div class="rowactions" aria-label="Request lifecycle actions">${includeHeader&&request.state==='Open'?'<button type="button" class="btn btn-ghost btn-sm" data-header-edit onclick="openManpowerHeaderAmendment()">Edit Header</button>':''}${lifecycleOperations(request.state).map(operation=>`<button type="button" class="btn btn-ghost btn-sm" data-lifecycle-operation="${operation}" onclick="openManpowerLifecycle('${operation}')">${LIFECYCLE_LABELS[operation]}</button>`).join('')}</div>`:'';
}
export function lifecyclePayload(request,operation,line,quantity,reason){
  const errors={},note=String(reason??'').trim();let value=null;
  if(!request?.id||!Number.isSafeInteger(Number(request.revision))||Number(request.revision)<1)errors.request='Reload a saved submitted request before changing its lifecycle.';
  if(!(operation==='CancelLine'?request?.state==='Open':lifecycleOperations(request?.state).includes(operation)))errors.request='This operation is not available for the current request state.';
  if(!note||note.length>1000)errors.reason='Enter a reason between 1 and 1000 characters.';
  if(operation==='CancelLine'){
    if(!line?.id||line.request_id!==request?.id)errors.request='Select a saved line belonging to this request.';
    try{value=manpowerQuantity(quantity);}catch(error){errors.quantity=error.message;}
    if(value>Number(line?.current_authorized)-Number(line?.cancelled_unfilled))errors.quantity='Cancellation cannot exceed the remaining authorized demand. Reserved and fulfilled commitments are also checked when saving.';
  }
  return {errors,payload:{p_id:request?.id,p_expected_revision:Number(request?.revision),p_operation:operation,p_reason:note,p_line_id:operation==='CancelLine'?line?.id:null,p_cancel_quantity:value}};
}
export function lifecycleEditorHTML(request,operation,line){
  const label=LIFECYCLE_LABELS[operation];
  const effect=operation==='Reopen'?'Cancelled demand will not be restored. Historical deployments remain unchanged.':operation==='CancelLine'?'Only outstanding unfilled demand is cancelled. Release or reassign reservations on this line first. Historical deployments remain unchanged.':'Remaining unfilled demand will be cancelled across the entire request, not just this page. Release or reassign all reservations first. Historical deployments remain unchanged.';
  return `<section id="mp_lifecycle_editor" class="manpower-lifecycle-editor" aria-label="${escape(label)}"><h3>${escape(label)}${line?` / Line ${escape(Number(line.ordinal)+1)}`:''}</h3><p class="small">${escape(request.prf_number)}${line?` / ${escape(line.department)} / ${escape(line.position)}`:''}</p><p id="mp_lifecycle_help" class="small">${effect}</p><div id="mp_lifecycle_error" role="alert" tabindex="-1" hidden></div>${operation==='CancelLine'?'<div class="field"><label for="mp_lifecycle_quantity">Unfilled Headcount to Cancel</label><input id="mp_lifecycle_quantity" type="number" min="1" max="2147483647" step="1" aria-describedby="mp_lifecycle_help mp_lifecycle_quantity_error"><span id="mp_lifecycle_quantity_error" class="small" hidden></span></div>':''}<div class="field"><label for="mp_lifecycle_reason">Reason</label><textarea id="mp_lifecycle_reason" rows="2" maxlength="1000" aria-describedby="mp_lifecycle_help mp_lifecycle_reason_error"></textarea><span id="mp_lifecycle_reason_error" class="small" hidden></span></div><div class="rowactions"><button id="mp_lifecycle_save" type="button" class="btn btn-primary btn-sm" data-confirm-change="false" onclick="saveManpowerLifecycle()">${escape(label)}</button><button type="button" class="btn btn-ghost btn-sm" onclick="discardManpowerQuantityAmendment()">Discard</button></div></section>`;
}
export function lifecycleResultValid(data,request,operation,line,quantity){
  const state={Close:'Closed',Cancel:'Cancelled',Reopen:'Open',CancelLine:'Open'}[operation];
  if(!state||data?.request?.id!==request.id||data.request.state!==state||Number(data.request.revision)!==Number(request.revision)+1||!Array.isArray(data.line_changes))return false;
  if(operation==='Reopen')return data.line_changes.length===0;
  if(operation==='CancelLine'){
    const change=data.line_changes[0];
    return data.line_changes.length===1&&change.line_id===line.id&&change.previous_cancelled===line.cancelled_unfilled&&change.current_cancelled===Number(line.cancelled_unfilled)+quantity&&change.original_requested===line.original_requested&&change.current_authorized===line.current_authorized;
  }
  return data.line_changes.every(change=>change.line_id&&Number.isSafeInteger(change.previous_cancelled)&&Number.isSafeInteger(change.current_cancelled)&&change.previous_cancelled>=0&&change.current_cancelled>change.previous_cancelled&&change.current_cancelled<=change.current_authorized);
}
export function lifecycleError(error){
  if(['PGRST202','42883'].includes(error.code))return 'Lifecycle changes are not enabled in this database. Ask the System Administrator to complete the reviewed release setup. Your entries are retained.';
  if(error.code==='40001')return 'This request changed. Your entries are retained; discard and reload before reviewing a new lifecycle change.';
  if(error.code==='42501')return 'Lifecycle access denied. Check your permission and request scope.';
  return error.message||'The lifecycle change could not be confirmed. Check the saved request and lifecycle history before retrying.';
}
