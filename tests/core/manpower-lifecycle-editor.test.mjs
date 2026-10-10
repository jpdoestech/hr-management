import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {LIFECYCLE_LABELS,lifecycleOperations,lifecycleActionsHTML,lifecyclePayload,lifecycleEditorHTML,lifecycleResultValid,lifecycleError} from '../../js/manpower/lifecycle-editor.js';
import {submittedTableHTML,loadSubmittedRows} from '../../js/manpower/submitted-workspace.js';
const request={id:'request',state:'Open',revision:7,prf_number:'Synthetic PRF'};
const line={id:'line',request_id:'request',ordinal:10,current_authorized:100,original_requested:90,cancelled_unfilled:20,department:'Production',position:'Operator'};
test('lifecycle actions honor administrative states and read-only defaults',()=>{
  assert.deepEqual(lifecycleOperations('Open'),['Close','Cancel']);
  for(const state of ['Closed','Cancelled'])assert.deepEqual(lifecycleOperations(state),['Reopen']);
  assert.deepEqual(lifecycleOperations('Draft'),[]);assert.equal(lifecycleActionsHTML(request),'');
  assert.match(lifecycleActionsHTML(request,true),/Close request/);
  assert.doesNotMatch(lifecycleActionsHTML({...request,state:'Closed'},true),/Close request|Cancel request/);
  assert.doesNotMatch(submittedTableHTML([line],'lines',v=>v),/openManpowerLifecycle/);
  assert.match(submittedTableHTML([line],'lines',v=>v,'',{canManage:true}),/Cancel unfilled demand for line 11/);
});
test('reasoned lifecycle payload preserves facts and supplies only applicable line fields',()=>{
  const before=structuredClone(line);
  assert.deepEqual(lifecyclePayload(request,'Close',null,12,' Client completed ').payload,{p_id:'request',p_expected_revision:7,p_operation:'Close',p_reason:'Client completed',p_line_id:null,p_cancel_quantity:null});
  const checked=lifecyclePayload(request,'CancelLine',line,5,'Demand reduced');assert.deepEqual(checked.errors,{});assert.equal(checked.payload.p_cancel_quantity,5);assert.equal(checked.payload.p_line_id,'line');
  assert.deepEqual(line,before);
});
test('lifecycle validation rejects invalid states, revisions, reasons and wrong request lines',()=>{
  for(const operation of ['Reopen','Unknown'])assert.ok(lifecyclePayload(request,operation,null,null,'Reason').errors.request);
  for(const state of ['Closed','Cancelled','Draft'])assert.ok(lifecyclePayload({...request,state},'Close',null,null,'Reason').errors.request);
  for(const revision of [0,'bad',1.5])assert.ok(lifecyclePayload({...request,revision},'Close',null,null,'Reason').errors.request);
  for(const reason of ['', ' ', 'x'.repeat(1001)])assert.ok(lifecyclePayload(request,'Close',null,null,reason).errors.reason);
  assert.ok(lifecyclePayload(request,'CancelLine',{...line,request_id:'other'},1,'Reason').errors.request);
  for(const quantity of ['',0,-1,1.5,'bad',2147483648,81])assert.ok(lifecyclePayload(request,'CancelLine',line,quantity,'Reason').errors.quantity);
  assert.deepEqual(lifecyclePayload({...request,state:'Cancelled'},'Reopen',null,null,'New demand review').errors,{});
});
test('lifecycle result validation requires exact revision/state and preserved line facts',()=>{
  const data={request:{...request,revision:8},line_changes:[{line_id:'line',previous_cancelled:20,current_cancelled:25,current_authorized:100,original_requested:90}]};
  assert.equal(lifecycleResultValid(data,request,'CancelLine',line,5),true);
  for(const change of [{line_id:'other'},{previous_cancelled:19},{current_cancelled:24},{original_requested:80},{current_authorized:99}])assert.equal(lifecycleResultValid({...data,line_changes:[{...data.line_changes[0],...change}]},request,'CancelLine',line,5),false);
  assert.equal(lifecycleResultValid({...data,request:{...data.request,revision:9}},request,'CancelLine',line,5),false);
  assert.equal(lifecycleResultValid({request:{...request,state:'Closed',revision:8},line_changes:[]},request,'Close'),true);
  assert.equal(lifecycleResultValid({request:{...request,revision:8},line_changes:[]},{...request,state:'Closed'},'Reopen'),true);
  assert.equal(lifecycleResultValid(data,{...request,state:'Closed'},'Reopen'),false);
});
test('lifecycle editor escapes context, labels fields and explains preserved demand/history',()=>{
  const html=lifecycleEditorHTML({...request,prf_number:'<script>'},'CancelLine',{...line,position:'<script>'});
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
  assert.match(html,/label for="mp_lifecycle_quantity"/);assert.match(html,/label for="mp_lifecycle_reason"/);
  assert.match(html,/role="alert" tabindex="-1"/);assert.match(html,/aria-describedby="mp_lifecycle_help/);
  assert.match(html,/Historical deployments remain unchanged/);
  assert.doesNotMatch(lifecycleEditorHTML(request,'Close'),/id="mp_lifecycle_quantity"/);
  assert.match(lifecycleEditorHTML(request,'Reopen'),/Cancelled demand will not be restored/);
});
test('bounded line projection includes authoritative parent identifier for cancellation',async()=>{
  let projection='';const query={select(value){projection=value;return query;},eq(){return query;},order(){return query;},range(){return Promise.resolve({data:[],count:0});}};
  await loadSubmittedRows({from:()=>query},'request','lines');assert.match(projection,/id,request_id,ordinal/);assert.doesNotMatch(projection,/\*/);
});
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const save=app.slice(app.indexOf('async function saveManpowerLifecycle(){'),app.indexOf('function openManpowerRequestForm('));
function fixture({operation='CancelLine',quantity='5',reason='Synthetic client change',choice='confirm',error=null,onConfirm=()=>{},allowed=true,badResult=false}={}){
  let calls=0,refreshes=0,errors={},destination='';const controls=[{disabled:false},{disabled:false}];
  const root={isConnected:true,querySelectorAll:selector=>{assert.equal(selector,'input,textarea,button');return [...controls,elements.mp_lifecycle_quantity,elements.mp_lifecycle_reason];},setAttribute(){},removeAttribute(){}};
  const elements={mp_lifecycle_editor:root,mp_lifecycle_quantity:{value:quantity},mp_lifecycle_reason:{value:reason}};
  const ui={edit:{kind:'lifecycle',operation,request:{...request,state:operation==='Reopen'?'Closed':'Open'},line:operation==='CancelLine'?structuredClone(line):null},saving:false};
  const context={MANPOWER_SUBMITTED_UI:ui,SESSION:{id:'synthetic-user'},STATE:{view:'manpowerSubmittedDetails',manpowerSubmittedId:'request',manpowerSubmittedTab:'lines',tablePages:{'manpower:submitted-lines:request':{page:2,size:10}}},PENDING_PAGE_NAVIGATION:null,PAGE_EDIT_STATE:{view:'manpowerSubmittedDetails'},
    document:{getElementById:id=>elements[id],querySelector:()=>null},hasPermission:()=>allowed,lifecyclePayload,lifecycleResultValid,lifecycleError,LIFECYCLE_LABELS,
    showManpowerLifecycleErrors:value=>errors=value,confirmDataChange:async()=>{onConfirm(context,elements);return choice;},clearManpowerQuantityEdit:()=>{ui.edit=null;context.PAGE_EDIT_STATE=null;},toast(){},go:async view=>destination=view,renderManpowerSubmittedDetails:async()=>{refreshes++;},
    supabase:{rpc:async(name,payload)=>{calls++;assert.equal(name,'change_manpower_lifecycle');assert.equal(payload.p_expected_revision,7);
      return error?{error}:{data:{request:{...request,state:{Close:'Closed',Cancel:'Cancelled',Reopen:'Open',CancelLine:'Open'}[operation],revision:badResult?9:8},line_changes:operation==='CancelLine'?[{line_id:'line',previous_cancelled:20,current_cancelled:25,current_authorized:100,original_requested:90}]:[]}};
    }}};
  runInNewContext(save,context);return {context,ui,controls,elements,calls:()=>calls,refreshes:()=>refreshes,errors:()=>errors,destination:()=>destination};
}
test('each lifecycle operation confirms once and retains selected request/tab/page',async()=>{
  for(const operation of ['Close','Cancel','Reopen','CancelLine']){
    const f=fixture({operation});const results=await Promise.all([f.context.saveManpowerLifecycle(),f.context.saveManpowerLifecycle()]);
    assert.equal(results[0],true);assert.equal(f.calls(),1);assert.equal(f.refreshes(),1);assert.equal(f.destination(),'');assert.equal(f.ui.edit,null);
    assert.deepEqual(f.context.STATE.tablePages['manpower:submitted-lines:request'],{page:2,size:10});assert.equal(f.context.STATE.manpowerSubmittedTab,'lines');assert.equal(f.ui.saving,false);
  }
});
test('invalid entry, cancelled confirmation and denied access never write or clear lifecycle input',async()=>{
  for(const options of [{quantity:'0'},{reason:''},{choice:'cancel'},{allowed:false}]){
    const f=fixture(options);f.context.PENDING_PAGE_NAVIGATION='dashboard';assert.equal(await f.context.saveManpowerLifecycle(),false);
    assert.equal(f.calls(),0);assert.ok(f.ui.edit);assert.equal(f.context.PENDING_PAGE_NAVIGATION,null);
  }
});
test('missing/stale/capacity/permission errors and ambiguous responses retain lifecycle entries',async()=>{
  for(const options of [{error:{code:'PGRST202'}},{error:{code:'40001'}},{error:{code:'42501'}},{error:{code:'23514',message:'Release or reassign reservations first.'}},{badResult:true},{error:{message:''}}]){
    const f=fixture(options);assert.equal(await f.context.saveManpowerLifecycle(),false);assert.ok(f.ui.edit);assert.equal(f.refreshes(),0);assert.ok(f.errors().request);
    assert.equal(f.elements.mp_lifecycle_reason.value,'Synthetic client change');assert.equal(f.ui.saving,false);assert.ok(f.controls.every(control=>!control.disabled));
  }
});
test('changed session, access, request or input during confirmation cannot mutate',async()=>{
  for(const onConfirm of [context=>context.SESSION={id:'other'},context=>context.hasPermission=()=>false,context=>context.STATE.manpowerSubmittedId='other',(_context,elements)=>elements.mp_lifecycle_reason.value='Changed']){
    const f=fixture({onConfirm});assert.equal(await f.context.saveManpowerLifecycle(),false);assert.equal(f.calls(),0);assert.ok(f.ui.edit);
  }
});
test('pending workspace navigation occurs only after confirmed lifecycle save',async()=>{
  const f=fixture();f.context.PENDING_PAGE_NAVIGATION='dashboard';assert.equal(await f.context.saveManpowerLifecycle(),true);assert.equal(f.destination(),'dashboard');assert.equal(f.refreshes(),0);assert.equal(f.context.PENDING_PAGE_NAVIGATION,null);
});
test('lifecycle fields and actions are locked during confirmation and restored on cancellation',async()=>{
  const f=fixture({choice:'cancel',onConfirm:(_context,elements)=>{assert.equal(elements.mp_lifecycle_quantity.disabled,true);assert.equal(elements.mp_lifecycle_reason.disabled,true);}});
  assert.equal(await f.context.saveManpowerLifecycle(),false);assert.equal(f.calls(),0);
  assert.equal(f.elements.mp_lifecycle_quantity.disabled,false);assert.equal(f.elements.mp_lifecycle_reason.disabled,false);
});
test('lifecycle busy guard covers refresh and preserves pending navigation on a second save',async()=>{
  const f=fixture();let finish;f.context.renderManpowerSubmittedDetails=()=>new Promise(resolve=>finish=resolve);
  const pending=f.context.saveManpowerLifecycle();while(!finish)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ui.saving,true);f.context.PENDING_PAGE_NAVIGATION='dashboard';assert.equal(await f.context.saveManpowerLifecycle(),false);assert.equal(f.context.PENDING_PAGE_NAVIGATION,'dashboard');
  finish();assert.equal(await pending,true);assert.equal(f.ui.saving,false);
});
test('dirty lifecycle navigation dispatches its own Save and preserves failed/kept edits',async()=>{
  const handlers=app.slice(app.indexOf('async function resolveManpowerQuantityEdit(){'),app.indexOf('async function openManpowerQuantityAmendment('));
  for(const choice of ['confirm','discard','cancel']){
    let saves=0,clears=0;
    const context={MANPOWER_SUBMITTED_UI:{edit:{kind:'lifecycle'},saving:false},manpowerQuantityEditDirty:()=>true,confirmDataChange:async()=>choice,clearManpowerQuantityEdit:()=>clears++,saveManpowerLifecycle:async()=>{saves++;return false;}};
    runInNewContext(handlers,context);assert.equal(await context.resolveManpowerQuantityEdit(),choice==='discard');assert.equal(saves,choice==='confirm'?1:0);assert.equal(clears,choice==='discard'?1:0);
  }
});
