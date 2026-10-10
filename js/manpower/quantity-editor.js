import {manpowerQuantity} from '../core/manpower-demand.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function quantityAmendmentPayload(request,line,quantity,reason){
  const errors={};let value;
  try{value=manpowerQuantity(quantity);}catch(error){errors.quantity=error.message;}
  const note=String(reason??'').trim();
  if(!note||note.length>1000)errors.reason='Enter an amendment reason between 1 and 1000 characters.';
  if(value===Number(line.current_authorized))errors.quantity='Enter a different authorized headcount.';
  if(value<Number(line.cancelled_unfilled))errors.quantity='Authorized headcount cannot be less than cancelled demand.';
  if(request.state!=='Open'||!Number.isSafeInteger(Number(request.revision))||Number(request.revision)<1)errors.request='Only an open submitted request with a saved revision can be amended.';
  if(!request.id||!line.id)errors.request='Reload the request and select a saved requisition line.';
  return {errors,payload:{p_id:request.id,p_line_id:line.id,p_expected_revision:Number(request.revision),p_quantity:value,p_reason:note}};
}
export function quantityAmendmentHTML(line){
  return `<div id="mp_quantity_editor" class="manpower-quantity-editor" role="group" aria-label="Amend authorized headcount for line ${escape(Number(line.ordinal)+1)}"><div id="mp_quantity_error" role="alert" tabindex="-1" hidden></div><div class="field"><label for="mp_quantity_value">Authorized Headcount</label><input id="mp_quantity_value" type="number" min="1" max="2147483647" step="1" value="${escape(line.current_authorized)}" aria-describedby="mp_quantity_help mp_quantity_value_error"><span id="mp_quantity_value_error" class="small" hidden></span></div><div class="field"><label for="mp_quantity_reason">Amendment Reason</label><textarea id="mp_quantity_reason" rows="2" maxlength="1000" aria-describedby="mp_quantity_reason_error"></textarea><span id="mp_quantity_reason_error" class="small" hidden></span></div><p id="mp_quantity_help" class="small">Original headcount and cancelled demand stay unchanged. Reserved and fulfilled commitments are checked when saving.</p><div class="rowactions"><button id="mp_quantity_save" type="button" class="btn btn-primary btn-sm" data-confirm-change="false" onclick="saveManpowerQuantityAmendment()">Save</button><button type="button" class="btn btn-ghost btn-sm" onclick="discardManpowerQuantityAmendment()">Discard</button></div></div>`;
}
export function quantityAmendmentError(error){
  if(['PGRST202','42883'].includes(error.code))return 'Quantity amendments are not enabled in this database. Ask the System Administrator to complete the reviewed release setup. Your entries are retained.';
  if(error.code==='40001')return 'This request changed. Your entries are retained; discard and reload the request before reviewing a new amendment.';
  if(error.code==='42501')return 'Amendment access denied. Check your permission and request scope.';
  return error.message||'The amendment could not be confirmed. Check the saved request and amendment history before retrying.';
}
