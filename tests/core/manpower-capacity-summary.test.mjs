import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {capacityResultValid,loadLineCapacity,lineCapacityHTML,capacityErrorHTML} from '../../js/manpower/capacity-summary.js';
import {submittedTableHTML} from '../../js/manpower/submitted-workspace.js';
const valid={original_requested:1000,current_authorized:900,cancelled_unfilled:100,effective_capacity:800,reserved:10,scheduled:3,fulfilled:200,active_deployed:180,available:590};
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
test('capacity validates all canonical integer counters and subset relations',()=>{
  assert.equal(capacityResultValid(valid),true);
  for(const patch of [{available:591},{reserved:-1},{scheduled:11},{active_deployed:201},{fulfilled:'200'},{original_requested:0},{available:Infinity},{available:Number.MAX_SAFE_INTEGER+1},{effective_capacity:801}])assert.equal(capacityResultValid({...valid,...patch}),false);
  assert.equal(capacityResultValid(null),false);assert.equal(capacityResultValid({}),false);
});
test('capacity reads only the scoped existing RPC and rejects failures or inconsistent results',async()=>{
  const calls=[];const client={rpc:async(...args)=>{calls.push(args);return {data:valid};}};
  assert.deepEqual(await loadLineCapacity(client,'line'),valid);assert.deepEqual(calls,[['manpower_line_capacity',{p_line:'line'}]]);
  await assert.rejects(()=>loadLineCapacity({rpc:async()=>({error:{code:'42501'}})},'line'),error=>error.code==='42501');
  await assert.rejects(()=>loadLineCapacity({rpc:async()=>({data:{...valid,available:0}})},'line'),/could not be verified/);
});
test('capacity disclosure distinguishes historical credit, scheduled subset and operational progress',()=>{
  const html=lineCapacityHTML(valid);
  for(const label of ['Original Requested','Current Authorized','Cancelled Unfilled','Effective Capacity','Reserved','Scheduled','Historically Fulfilled','Active Deployed','Available'])assert.ok(html.includes(label));
  assert.match(html,/Partially Filled/);assert.match(html,/Scheduled workers are included in Reserved/);
  assert.match(lineCapacityHTML({...valid,fulfilled:800,reserved:0,scheduled:0,available:0}),/Filled/);
  assert.match(lineCapacityHTML({...valid,fulfilled:0,active_deployed:0,available:790}),/Open/);
  assert.match(lineCapacityHTML({...valid,cancelled_unfilled:900,effective_capacity:0,reserved:0,scheduled:0,fulfilled:0,active_deployed:0,available:0}),/No effective demand/);
  assert.throws(()=>lineCapacityHTML({...valid,available:-1}),/Invalid/);
});
test('errors never expose backend text or present fake zero counts',()=>{
  for(const code of ['PGRST202','42883','42501','23514','unknown']){
    const html=capacityErrorHTML({code,message:'Private worker <script>'});assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Private worker|<script>|Available.*0/);
  }
});
test('line capacity is lazy and scoped to the chosen escaped stable ID',()=>{
  const html=submittedTableHTML([{id:'<unsafe>',ordinal:0,department:'Synthetic',position:'Operator',current_authorized:1000,original_requested:1000,cancelled_unfilled:0}],'lines',value=>value||'');
  assert.match(html,/View capacity for line 1/);assert.match(html,/data-line-capacity aria-live="polite"/);assert.match(html,/&lt;unsafe&gt;/);assert.doesNotMatch(html,/<unsafe>|Historically Fulfilled/);
  assert.doesNotMatch(submittedTableHTML([],'history',value=>value),/showManpowerLineCapacity/);
});
function fixture(){
  const host={isConnected:true,innerHTML:'',setAttribute(){},removeAttribute(){}};
  const button={disabled:false,textContent:'View capacity',parentElement:{querySelector:()=>host}};
  const pending=[];const state={request_id:'request',id:'line'};
  const context={SESSION:{id:'user'},STATE:{view:'manpowerSubmittedDetails',manpowerSubmittedId:'request'},MANPOWER_SUBMITTED_UI:{rows:[state],record:{revision:2},saving:false},hasPermission:()=>true,supabase:{},loadLineCapacity:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),lineCapacityHTML,capacityErrorHTML};
  runInNewContext(app.slice(app.indexOf('async function showManpowerLineCapacity('),app.indexOf('function manpowerQuantityEditDirty(')),context);
  return {host,button,pending,context};
}
test('capacity locks duplicate reads, refreshes in place and retains focus target',async()=>{
  const {host,button,pending,context}=fixture();const read=context.showManpowerLineCapacity('line',button);
  assert.equal(button.disabled,true);assert.match(host.innerHTML,/Loading/);
  await context.showManpowerLineCapacity('line',button);assert.equal(pending.length,1);
  pending[0].resolve(valid);await read;assert.match(host.innerHTML,/590/);assert.equal(button.disabled,false);assert.equal(button.textContent,'Refresh capacity');
});
test('capacity ignores late reads after navigation, session, permission, revision or host changes',async()=>{
  for(const mutate of [ctx=>ctx.SESSION={id:'other'},ctx=>ctx.STATE.manpowerSubmittedId='other',ctx=>ctx.STATE.view='onboarding',ctx=>ctx.hasPermission=()=>false,ctx=>ctx.MANPOWER_SUBMITTED_UI.record.revision++,(_ctx,host)=>host.isConnected=false]){
    const {host,button,pending,context}=fixture();const read=context.showManpowerLineCapacity('line',button);mutate(context,host);pending[0].resolve(valid);await read;assert.doesNotMatch(host.innerHTML,/Historically Fulfilled/);
  }
});
test('capacity errors are announced and retryable, while denied, unknown and busy contexts do no read',async()=>{
  const {host,button,pending,context}=fixture();const read=context.showManpowerLineCapacity('line',button);pending[0].reject({code:'PGRST202'});await read;
  assert.match(host.innerHTML,/not enabled/);assert.equal(button.textContent,'Retry capacity');assert.equal(button.disabled,false);
  context.MANPOWER_SUBMITTED_UI.saving=true;await context.showManpowerLineCapacity('line',button);
  context.MANPOWER_SUBMITTED_UI.saving=false;await context.showManpowerLineCapacity('unknown',button);
  context.hasPermission=()=>false;await context.showManpowerLineCapacity('line',button);assert.equal(pending.length,1);
});
