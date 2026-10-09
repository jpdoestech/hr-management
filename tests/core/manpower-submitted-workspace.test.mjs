import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {paginationMeta,paginationHTML} from '../../js/core/pagination.js';
import {loadSubmittedRequests,loadSubmittedRequest,loadSubmittedRows,submittedListRowsHTML,submittedHeaderHTML,submittedTableHTML} from '../../js/manpower/submitted-workspace.js';
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
function clientFixture(result={data:[],count:0}){
  const calls=[];const query={};
  for(const name of ['select','eq','order','range','ilike','single'])query[name]=(...args)=>{calls.push([name,...args]);return query;};
  query.then=resolve=>Promise.resolve(resolve(result));
  return {calls,client:{from:table=>{calls.push(['from',table]);return query;}}};
}
test('submitted list is database-filtered, bounded and excludes nested lines',async()=>{
  const {client,calls}=clientFixture();await loadSubmittedRequests(client,{page:2,size:25,search:'PRF_%',branch:'Davao'});
  assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='state'&&call[2]==='Open'));
  assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='branch_reporting'&&call[2]==='Davao'));
  assert.deepEqual(calls.find(call=>call[0]==='range'),['range',25,49]);
  assert.deepEqual(calls.find(call=>call[0]==='ilike'),['ilike','prf_number','%PRF\\_\\%%']);
  assert.doesNotMatch(calls.find(call=>call[0]==='select')[1],/\*|hr_manpower_lines/);
});
test('request detail requires submitted state and does not fetch all requisition lines',async()=>{
  const {client,calls}=clientFixture({data:{id:'request'}});assert.equal((await loadSubmittedRequest(client,'request')).id,'request');
  assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='state'&&call[2]==='Open'));
  assert.doesNotMatch(calls.find(call=>call[0]==='select')[1],/hr_manpower_lines/);
});
test('lines and history have separate bounded queries and request-linked history filtering',async()=>{
  const lines=clientFixture();await loadSubmittedRows(lines.client,'request','lines',{page:3,size:10});
  assert.deepEqual(lines.calls.find(call=>call[0]==='range'),['range',20,29]);
  assert.deepEqual(lines.calls.find(call=>call[0]==='eq'),['eq','request_id','request']);
  const history=clientFixture();await loadSubmittedRows(history.client,'request','history',{size:100000});
  assert.match(history.calls.find(call=>call[0]==='select')[1],/hr_manpower_lines!inner/);
  assert.deepEqual(history.calls.find(call=>call[0]==='eq'),['eq','hr_manpower_lines.request_id','request']);
  assert.deepEqual(history.calls.find(call=>call[0]==='range'),['range',0,9]);
});
test('amendment reads are lazy, request-filtered and independently paginated',async()=>{
  const {client,calls}=clientFixture();await loadSubmittedRows(client,'request','amendments',{page:2,size:25});
  assert.deepEqual(calls[0],['from','hr_manpower_quantity_amendments']);
  assert.deepEqual(calls.find(call=>call[0]==='range'),['range',25,49]);
  assert.deepEqual(calls.find(call=>call[0]==='eq'),['eq','hr_manpower_lines.request_id','request']);
  assert.match(calls.find(call=>call[0]==='select')[1],/previous_authorized.*reason.*hr_manpower_lines!inner/);
  assert.doesNotMatch(calls.find(call=>call[0]==='select')[1],/\*|audit_id/);
});
test('amendment reason disclosure is escaped, accessible and read-only',()=>{
  const html=submittedTableHTML([{line_id:'line',previous_authorized:100,current_authorized:125,request_revision:3,reason:'<script>alert(1)</script>'}],'amendments',value=>value);
  assert.match(html,/100/);assert.match(html,/125/);assert.match(html,/&lt;script&gt;/);
  assert.match(html,/<details><summary>Amendment reason/);assert.match(html,/scope="col"/);
  assert.match(html,/tabindex="0"/);assert.doesNotMatch(html,/<script>|onclick=|undefined|NaN/);
  assert.match(submittedTableHTML([],'amendments',value=>value),/No quantity amendments recorded/);
});
test('backend failures are propagated rather than displayed as empty success',async()=>{
  const {client}=clientFixture({error:{code:'42P01',message:'Missing'}});
  await assert.rejects(()=>loadSubmittedRequests(client),error=>error.code==='42P01');
  await assert.rejects(()=>loadSubmittedRows(client,'request','history'),error=>error.code==='42P01');
  await assert.rejects(()=>loadSubmittedRows(client,'request','amendments'),error=>error.code==='42P01');
});
test('read-only views escape data, disclose details and use the header target fallback',()=>{
  const row={id:'request',ordinal:0,prf_number:'<script>',department:'Production',position:'Operator',original_requested:1000,current_authorized:1000,cancelled_unfilled:0,purpose:'<script>',demand_type:'Replacement'};
  const list=submittedListRowsHTML([row],value=>value||'');assert.match(list,/&lt;script&gt;/);assert.doesNotMatch(list,/<script>|Edit|Delete|Export/);
  const header=submittedHeaderHTML({...row,hr_manpower_clients:{name:'<script>'},remarks:'<script>'},value=>value||'');assert.doesNotMatch(header,/<script>/);
  const table=submittedTableHTML([row],'lines',value=>value||'','2026-10-10');assert.match(table,/<details>/);assert.match(table,/2026-10-10/);
  assert.match(table,/scope="col"/);assert.doesNotMatch(table,/undefined|NaN|<script>/);
  assert.match(submittedTableHTML([],'history',value=>value),/No quantity history available/);
});
function controllerFixture(){
  const host={innerHTML:'',isConnected:true};const pending=[];
  const context={SESSION:{id:'user'},STATE:{view:'manpowerSubmitted'},document:{getElementById:id=>id==='content'?{}:host},hasPermission:()=>true,setTitle:()=>{},
    loadSubmittedRequests:()=>new Promise(resolve=>pending.push(resolve)),supabase:{},paginationMeta,paginationHTML,submittedListRowsHTML,fmtDate:value=>value||'',esc:value=>String(value)};
  runInNewContext(app.slice(app.indexOf('const MANPOWER_SUBMITTED_UI='),app.indexOf('function openManpowerRequestForm(')),context);
  return {host,pending,context};
}
test('missing amendment storage explains the limitation without claiming an empty history',()=>{
  const {context}=controllerFixture();const html=context.manpowerSubmittedErrorHTML({code:'42P01'},'renderManpowerSubmittedDetails','amendments');
  assert.match(html,/Quantity amendments unavailable/);assert.match(html,/Requisition lines and submission history remain available/);
  assert.match(html,/role="alert"/);assert.doesNotMatch(html,/No quantity amendments recorded/);
});
test('late responses cannot overwrite a newer submitted list',async()=>{
  const {context,pending,host}=controllerFixture();const first=context.renderManpowerSubmitted(),second=context.renderManpowerSubmitted();
  pending[1]({data:[{id:'new',prf_number:'New response'}],count:1});await second;
  pending[0]({data:[{id:'old',prf_number:'Old response'}],count:1});await first;
  assert.match(host.innerHTML,/New response/);assert.doesNotMatch(host.innerHTML,/Old response/);
});
test('session changes discard in-flight list responses, and denied users perform no reads',async()=>{
  const {context,pending,host}=controllerFixture();const request=context.renderManpowerSubmitted();context.SESSION={id:'other'};
  pending[0]({data:[{id:'old',prf_number:'Private result'}],count:1});await request;assert.doesNotMatch(host.innerHTML,/Private result/);
  context.hasPermission=()=>false;await context.renderManpowerSubmitted();assert.equal(pending.length,1);
});
test('permission revocation during a read discards the result',async()=>{
  const {context,pending,host}=controllerFixture();const request=context.renderManpowerSubmitted();context.hasPermission=()=>false;
  pending[0]({data:[{id:'old',prf_number:'Private result'}],count:1});await request;assert.doesNotMatch(host.innerHTML,/Private result/);
});
test('search resets preserve the selected bounded page size',()=>{
  const {context}=controllerFixture();context.STATE.tablePageSizes={'manpower:submitted':25};context.STATE.tablePages={};
  assert.equal(context.manpowerSubmittedPageSettings('manpower:submitted').size,25);
  context.STATE.tablePageSizes['manpower:submitted']=100000;context.STATE.tablePages={};
  assert.equal(context.manpowerSubmittedPageSettings('manpower:submitted').size,10);
});
test('draft editor and list cannot treat submitted requests as editable drafts',()=>{
  assert.match(app,/\.eq\('state','Draft'\)/);
  assert.match(app,/draft.request.state!=='Draft'\)\{STATE.manpowerSubmittedId=id;await go\('manpowerSubmittedDetails'/);
  const readOnly=app.slice(app.indexOf('const MANPOWER_SUBMITTED_UI='),app.indexOf('function openManpowerRequestForm('));
  assert.doesNotMatch(readOnly,/\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
});
