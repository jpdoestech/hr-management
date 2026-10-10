import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {HEADER_AMENDMENT_FIELDS,readHeaderAmendment,headerAmendmentPayload,headerEditorHTML,headerAmendmentResultValid,headerAmendmentError,headerHistoryChangesHTML} from '../../js/manpower/header-editor.js';
import {lifecycleActionsHTML} from '../../js/manpower/lifecycle-editor.js';
import {loadSubmittedRows,submittedTableHTML} from '../../js/manpower/submitted-workspace.js';
const request={id:'request',revision:7,state:'Open',prf_number:'PRF 01',requested_by:'Synthetic HR',date_requested:'2026-10-09',target_date:'2026-10-20',priority:'Normal',remarks:'',branch_reporting:'Davao',client_id:'synthetic-client',submitted_at:'2026-10-09T00:00:00Z',submitted_by:'synthetic-user'};
test('header amendments send only changed allowed values, stable ID/revision and trimmed reason',()=>{
  const original=structuredClone(request),result=headerAmendmentPayload(request,{...request,prf_number:'  PRF   renamed ',id:'other',client_id:'other'},' Reviewed correction ');
  assert.deepEqual(result.errors,{});assert.deepEqual(result.payload,{p_id:'request',p_expected_revision:7,p_header:{prf_number:'PRF renamed'},p_reason:'Reviewed correction'});assert.deepEqual(request,original);
});
test('header validation catches unchanged, missing, excessive and invalid fields and dates',()=>{
  assert.ok(headerAmendmentPayload(request,request,'Reason').errors.request);
  for(const [field,value] of [['prf_number',''],['prf_number','x'.repeat(121)],['requested_by',' '],['priority','Unknown'],['remarks','x'.repeat(10001)],['date_requested','2026-02-31'],['date_requested','0000-01-01'],['target_date','2026-10-01'],['target_date','']])assert.ok(headerAmendmentPayload(request,{...request,[field]:value},'Reason').errors[field]);
  for(const reason of ['', ' ', 'x'.repeat(1001)])assert.ok(headerAmendmentPayload(request,{...request,priority:'High'},reason).errors.reason);
  for(const state of ['Draft','Closed','Cancelled'])assert.ok(headerAmendmentPayload({...request,state},{...request,priority:'High'},'Reason').errors.request);
  assert.ok(headerAmendmentPayload({...request,revision:0},{...request,priority:'High'},'Reason').errors.request);
});
test('header controls and journal safely expose labels, changed fields and preserved-context warnings',()=>{
  const html=headerEditorHTML({...request,prf_number:'<script>',remarks:'</textarea><script>'});
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/role="alert" tabindex="-1"/);
  for(const key of [...Object.keys(HEADER_AMENDMENT_FIELDS),'reason'])assert.match(html,new RegExp(`label for="mp_header_${key}"`));
  assert.doesNotMatch(html,/id="mp_header_(?:client_id|branch_reporting|state)"/);
  assert.match(html,/Date changes do not reschedule deployments/);
  assert.doesNotMatch(lifecycleActionsHTML(request,false,true),/Edit Header/);
  assert.doesNotMatch(lifecycleActionsHTML({...request,state:'Closed'},true,true),/Edit Header/);
  assert.match(lifecycleActionsHTML(request,true,true),/Edit Header/);
  const journal=headerHistoryChangesHTML({before_header:request,after_header:{...request,prf_number:'<script>'}});
  assert.match(journal,/Previous: PRF 01/);assert.match(journal,/Current: &lt;script&gt;/);assert.doesNotMatch(journal,/Target Deployment Date/);
});
test('header history is bounded, request-scoped and escaped with explicit empty state',async()=>{
  const calls=[],query={};for(const name of ['select','eq','order','range'])query[name]=(...args)=>{calls.push([name,...args]);return query;};query.then=resolve=>Promise.resolve(resolve({data:[],count:0}));
  await loadSubmittedRows({from:table=>{calls.push(['from',table]);return query;}},'request','header-amendments',{page:2,size:25});
  assert.deepEqual(calls[0],['from','hr_manpower_header_amendments']);assert.deepEqual(calls.find(call=>call[0]==='range'),['range',25,49]);assert.deepEqual(calls.find(call=>call[0]==='eq'),['eq','request_id','request']);
  const html=submittedTableHTML([{request_revision:8,before_header:request,after_header:{...request,prf_number:'<script>'},reason:'<script>'}],'header-amendments',v=>v);
  assert.doesNotMatch(html,/<script>/);assert.match(html,/Header amendment reason/);assert.match(html,/scope="col"/);assert.match(submittedTableHTML([],'header-amendments',v=>v),/No header amendments recorded/);
});
test('header response validation checks confirmed patch plus immutable scope/submission metadata',()=>{
  const payload=headerAmendmentPayload(request,{...request,priority:'High'},'Reason').payload;
  const saved={...request,priority:'High',revision:8};assert.equal(headerAmendmentResultValid({request:saved},request,payload),true);
  for(const change of [{id:'other'},{revision:9},{state:'Closed'},{client_id:'other'},{branch_reporting:'Other'},{submitted_by:'other'},{submitted_at:'2026-10-10T00:00:00Z'},{priority:'Normal'},{requested_by:'Other'}])assert.equal(headerAmendmentResultValid({request:{...saved,...change}},request,payload),false);
});
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const save=app.slice(app.indexOf('async function saveManpowerHeaderAmendment(){'),app.indexOf('function openManpowerRequestForm('));
function fixture({reason='Synthetic correction',choice='confirm',error=null,allowed=true,onConfirm=()=>{},badResult=false}={}){
  let calls=0,refreshes=0,errors={},destination='';const controls=[{disabled:false},{disabled:false}];
  const root={isConnected:true,querySelectorAll:()=>[...controls,...Object.values(elements).filter(element=>'value' in element)],setAttribute(){},removeAttribute(){}};
  const elements=Object.fromEntries(Object.keys(HEADER_AMENDMENT_FIELDS).map(key=>['mp_header_'+key,{value:request[key]}]));
  elements.mp_header_editor=root;elements.mp_header_reason={value:reason};elements.mp_header_prf_number.value='PRF Renamed';
  const ui={edit:{kind:'header',request:structuredClone(request)},saving:false};
  const context={MANPOWER_SUBMITTED_UI:ui,SESSION:{id:'synthetic-user'},STATE:{view:'manpowerSubmittedDetails',manpowerSubmittedId:'request',manpowerSubmittedTab:'lines',tablePages:{'manpower:submitted-lines:request':{page:2,size:10}}},PAGE_EDIT_STATE:{view:'manpowerSubmittedDetails'},PENDING_PAGE_NAVIGATION:null,
    document:{getElementById:id=>elements[id],querySelector:()=>null},hasPermission:()=>allowed,HEADER_AMENDMENT_FIELDS,readHeaderAmendment,headerAmendmentPayload,headerAmendmentResultValid,headerAmendmentError,
    confirmDataChange:async()=>{onConfirm(context,elements);return choice;},showManpowerHeaderErrors:items=>errors=items,
    clearManpowerQuantityEdit:()=>{ui.edit=null;context.PAGE_EDIT_STATE=null;},toast(){},go:async view=>destination=view,renderManpowerSubmittedDetails:async()=>{refreshes++;},
    supabase:{rpc:async(name,payload)=>{calls++;assert.equal(name,'amend_manpower_header');assert.equal(payload.p_expected_revision,7);return error?{error}:{data:{request:{...request,...payload.p_header,revision:badResult?9:8}}};}}};
  runInNewContext(save,context);return {context,ui,elements,controls,calls:()=>calls,refreshes:()=>refreshes,errors:()=>errors,destination:()=>destination};
}
test('header save writes once, restores the same request/tab/page and clears only confirmed edits',async()=>{
  const f=fixture();await Promise.all([f.context.saveManpowerHeaderAmendment(),f.context.saveManpowerHeaderAmendment()]);
  assert.equal(f.calls(),1);assert.equal(f.refreshes(),1);assert.equal(f.ui.edit,null);assert.equal(f.destination(),'');
  assert.deepEqual(f.context.STATE.tablePages['manpower:submitted-lines:request'],{page:2,size:10});assert.equal(f.context.STATE.manpowerSubmittedTab,'lines');
});
test('invalid reason, cancellation, revoked session/access and changed confirmed input never write',async()=>{
  for(const options of [{reason:''},{choice:'cancel'},{allowed:false},{onConfirm:context=>context.SESSION={id:'other'}},{onConfirm:context=>context.hasPermission=()=>false},{onConfirm:(_context,elements)=>elements.mp_header_prf_number.value='Changed'}]){
    const f=fixture(options);f.context.PENDING_PAGE_NAVIGATION='dashboard';assert.equal(await f.context.saveManpowerHeaderAmendment(),false);assert.equal(f.calls(),0);assert.ok(f.ui.edit);assert.equal(f.context.PENDING_PAGE_NAVIGATION,null);
  }
});
test('duplicate PRF, missing RPC, stale revision and ambiguous responses retain edits',async()=>{
  for(const options of [{error:{code:'23505'}},{error:{code:'PGRST202'}},{error:{code:'40001'}},{error:{code:'42501'}},{error:{code:'23514',message:'Request date follows a line target.'}},{badResult:true},{error:{message:''}}]){
    const f=fixture(options);assert.equal(await f.context.saveManpowerHeaderAmendment(),false);assert.ok(f.ui.edit);assert.equal(f.refreshes(),0);assert.ok(Object.keys(f.errors()).length);assert.equal(f.elements.mp_header_prf_number.value,'PRF Renamed');
    if(options.error?.code==='23505')assert.match(f.errors().prf_number,/already assigned/);
  }
});
test('header fields lock during confirmation and unlock after cancellation; navigation waits for commit',async()=>{
  const f=fixture({choice:'cancel',onConfirm:(_context,elements)=>assert.equal(elements.mp_header_prf_number.disabled,true)});
  assert.equal(await f.context.saveManpowerHeaderAmendment(),false);assert.equal(f.elements.mp_header_prf_number.disabled,false);
  const saved=fixture();saved.context.PENDING_PAGE_NAVIGATION='dashboard';assert.equal(await saved.context.saveManpowerHeaderAmendment(),true);assert.equal(saved.destination(),'dashboard');assert.equal(saved.refreshes(),0);
});
test('header editor remains busy through refresh and local unsaved navigation selects the correct save',async()=>{
  const f=fixture();let finish;f.context.renderManpowerSubmittedDetails=()=>new Promise(resolve=>finish=resolve);
  const pending=f.context.saveManpowerHeaderAmendment();while(!finish)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.ui.saving,true);assert.equal(await f.context.saveManpowerHeaderAmendment(),false);finish();assert.equal(await pending,true);
  const handlers=app.slice(app.indexOf('async function resolveManpowerQuantityEdit(){'),app.indexOf('async function openManpowerQuantityAmendment('));
  for(const choice of ['confirm','discard','cancel']){
    let saves=0,clears=0;const context={MANPOWER_SUBMITTED_UI:{edit:{kind:'header'},saving:false},manpowerQuantityEditDirty:()=>true,confirmDataChange:async()=>choice,clearManpowerQuantityEdit:()=>clears++,saveManpowerHeaderAmendment:async()=>{saves++;return false;}};
    runInNewContext(handlers,context);assert.equal(await context.resolveManpowerQuantityEdit(),choice==='discard');assert.equal(saves,choice==='confirm'?1:0);assert.equal(clears,choice==='discard'?1:0);
  }
});
