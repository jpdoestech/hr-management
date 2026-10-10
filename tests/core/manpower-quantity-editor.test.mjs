import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {quantityAmendmentPayload,quantityAmendmentHTML,quantityAmendmentError} from '../../js/manpower/quantity-editor.js';
import {submittedTableHTML} from '../../js/manpower/submitted-workspace.js';
const request={id:'request',state:'Open',revision:7};
const line={id:'line',ordinal:0,current_authorized:1000,original_requested:900,cancelled_unfilled:20};
test('quantity amendments use stable identifiers and preserve baseline/cancellation facts',()=>{
  const before=structuredClone(line),checked=quantityAmendmentPayload(request,line,'1100',' Additional client demand ');
  assert.deepEqual(checked.errors,{});assert.deepEqual(checked.payload,{p_id:'request',p_line_id:'line',p_expected_revision:7,p_quantity:1100,p_reason:'Additional client demand'});
  assert.deepEqual(line,before);assert.deepEqual(quantityAmendmentPayload(request,line,100,'Reduced demand').errors,{});
});
test('reject invalid, unchanged, overflowing and below-cancellation headcounts',()=>{
  for(const quantity of ['0','-1','1.5','bad','2147483648','1000','19'])assert.ok(quantityAmendmentPayload(request,line,quantity,'Reason').errors.quantity);
  assert.equal(quantityAmendmentPayload(request,line,2147483647,'Reason').payload.p_quantity,2147483647);
});
test('amendments require a bounded reason and an open saved request',()=>{
  for(const reason of ['', '   ', 'x'.repeat(1001)])assert.ok(quantityAmendmentPayload(request,line,1100,reason).errors.reason);
  for(const state of ['Draft','Closed','Cancelled'])assert.ok(quantityAmendmentPayload({...request,state},line,1100,'Reason').errors.request);
  assert.ok(quantityAmendmentPayload({...request,revision:0},line,1100,'Reason').errors.request);
});
test('inline controls have labels, linked errors and no editable original/cancelled fields',()=>{
  const html=quantityAmendmentHTML(line);
  assert.match(html,/label for="mp_quantity_value"/);assert.match(html,/label for="mp_quantity_reason"/);
  assert.match(html,/aria-describedby="mp_quantity_help mp_quantity_value_error"/);assert.match(html,/role="alert" tabindex="-1"/);
  assert.match(html,/Save/);assert.match(html,/Discard/);assert.doesNotMatch(html,/input[^>]*(?:original_requested|cancelled_unfilled)/);
  const readOnly=submittedTableHTML([line],'lines',value=>value);
  assert.doesNotMatch(readOnly,/openManpowerQuantityAmendment/);
  const editable=submittedTableHTML([{...line,id:'<script>"'}],'lines',value=>value,'',{canAmend:true});
  assert.match(editable,/openManpowerQuantityAmendment/);assert.doesNotMatch(editable,/<script>/);assert.match(editable,/aria-label="Amend authorized headcount for line 1"/);
});
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const save=app.slice(app.indexOf('async function saveManpowerQuantityAmendment(){'),app.indexOf('function openManpowerRequestForm('));
function fixture({quantity='1100',reason='Client requested more workers',error=null,choice='confirm',allowed=true,onConfirm=()=>{}}={}){
  let calls=0,refreshes=0,destination='',errors={};
  const controls=[{disabled:false},{disabled:false}];
  const root={isConnected:true,querySelectorAll:()=>controls,setAttribute(){},removeAttribute(){}};
  const elements={mp_quantity_editor:root,mp_quantity_value:{value:quantity},mp_quantity_reason:{value:reason}};
  const ui={edit:{line:structuredClone(line),request:structuredClone(request)},saving:false};
  const context={MANPOWER_SUBMITTED_UI:ui,SESSION:{id:'synthetic-user'},STATE:{view:'manpowerSubmittedDetails',manpowerSubmittedId:'request',tablePages:{'manpower:submitted-lines:request':{page:2,size:25}}},PAGE_EDIT_STATE:{view:'manpowerSubmittedDetails'},PENDING_PAGE_NAVIGATION:null,
    document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},quantityAmendmentPayload,quantityAmendmentError,hasPermission:()=>allowed,
    confirmDataChange:async()=>{onConfirm(context);return choice;},showManpowerQuantityErrors:items=>errors=items,
    clearManpowerQuantityEdit:()=>{ui.edit=null;context.PAGE_EDIT_STATE=null;},toast(){},go:async view=>destination=view,renderManpowerSubmittedDetails:async()=>{refreshes++;},
    supabase:{rpc:async(name,payload)=>{calls++;assert.equal(name,'amend_manpower_quantity');assert.equal(payload.p_expected_revision,7);return error?{error}:{data:{request:{...request,revision:8},line:{...line,current_authorized:1100}}};}}};
  runInNewContext(save,context);
  return {context,ui,controls,calls:()=>calls,refreshes:()=>refreshes,destination:()=>destination,errors:()=>errors};
}
test('successful amendment commits once and refreshes the same request/page',async()=>{
  const f=fixture();await Promise.all([f.context.saveManpowerQuantityAmendment(),f.context.saveManpowerQuantityAmendment()]);
  assert.equal(f.calls(),1);assert.equal(f.refreshes(),1);assert.equal(f.destination(),'');assert.equal(f.ui.edit,null);
  assert.deepEqual(f.context.STATE.tablePages['manpower:submitted-lines:request'],{page:2,size:25});assert.equal(f.ui.saving,false);
});
test('invalid input, cancel and denied permission never write or clear the editor',async()=>{
  for(const options of [{quantity:'1000'},{reason:''},{choice:false},{allowed:false}]){
    const f=fixture(options);await f.context.saveManpowerQuantityAmendment();assert.equal(f.calls(),0);assert.ok(f.ui.edit);assert.equal(f.refreshes(),0);assert.equal(f.ui.saving,false);
  }
});
test('session, permission and input changes during confirmation prevent submission',async()=>{
  for(const onConfirm of [context=>context.SESSION={id:'other'},context=>context.hasPermission=()=>false,context=>context.document.getElementById('mp_quantity_reason').value='Changed']){
    const f=fixture({onConfirm});await f.context.saveManpowerQuantityAmendment();assert.equal(f.calls(),0);assert.ok(f.ui.edit);assert.equal(f.ui.saving,false);
  }
});
test('capacity, stale, denied and missing backend failures retain inputs and unlock retry',async()=>{
  for(const error of [{code:'23514',message:'Release or reassign reservations first.'},{code:'40001'},{code:'42501'},{code:'PGRST202'},{code:'42883'}]){
    const f=fixture({error});await f.context.saveManpowerQuantityAmendment();assert.equal(f.calls(),1);assert.ok(f.ui.edit);assert.equal(f.refreshes(),0);assert.equal(f.errors().request,quantityAmendmentError(error));assert.ok(f.controls.every(control=>!control.disabled));
  }
});
test('successful Save-before-navigation honors the pending destination only after commit',async()=>{
  const f=fixture();f.context.PENDING_PAGE_NAVIGATION='manpowerSubmitted';await f.context.saveManpowerQuantityAmendment();assert.equal(f.destination(),'manpowerSubmitted');assert.equal(f.refreshes(),0);
  const failed=fixture({error:{code:'40001'}});failed.context.PENDING_PAGE_NAVIGATION='manpowerSubmitted';await failed.context.saveManpowerQuantityAmendment();assert.equal(failed.destination(),'');assert.equal(failed.context.PENDING_PAGE_NAVIGATION,null);
});
test('editor stays busy through the committed refresh so another edit cannot use a stale revision',async()=>{
  const f=fixture();let refreshStarted,finishRefresh;
  const started=new Promise(resolve=>refreshStarted=resolve);
  f.context.renderManpowerSubmittedDetails=()=>{refreshStarted();return new Promise(resolve=>finishRefresh=resolve);};
  const pending=f.context.saveManpowerQuantityAmendment();await started;
  assert.equal(f.ui.saving,true);finishRefresh();await pending;assert.equal(f.ui.saving,false);
});
test('pagination and tabs cannot change context during a write or its refresh',async()=>{
  const context={MANPOWER_SUBMITTED_UI:{saving:true},STATE:{view:'manpowerSubmittedDetails',manpowerSubmittedTab:'lines',tablePages:{}}};
  runInNewContext(app.slice(app.indexOf('async function manpowerSubmittedSetTab('),app.indexOf('function manpowerSubmittedInfo(')),context);
  await context.manpowerSubmittedSetTab('amendments');await context.manpowerSubmittedPageGo('manpower:submitted-lines:request',2);await context.manpowerSubmittedPageSize('manpower:submitted-lines:request',25);
  assert.equal(context.STATE.manpowerSubmittedTab,'lines');assert.deepEqual(context.STATE.tablePages,{});
});
test('local pagination and section navigation ask before discarding edited quantity',async()=>{
  const resolve=app.slice(app.indexOf('async function resolveManpowerQuantityEdit(){'),app.indexOf('async function openManpowerQuantityAmendment('));
  for(const choice of [false,'discard','confirm']){
    let clears=0,saves=0;
    const context={MANPOWER_SUBMITTED_UI:{saving:false},manpowerQuantityEditDirty:()=>true,confirmDataChange:async()=>choice,clearManpowerQuantityEdit:()=>clears++,saveManpowerQuantityAmendment:async()=>{saves++;return false;}};
    runInNewContext(resolve,context);const result=await context.resolveManpowerQuantityEdit();
    assert.equal(result,choice==='discard');assert.equal(clears,choice==='discard'?1:0);assert.equal(saves,choice==='confirm'?1:0);
  }
});
