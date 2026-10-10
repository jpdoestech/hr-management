import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadLineWorkers,workerAge,workerTableHTML,workerFiltersHTML} from '../../js/manpower/worker-monitoring.js';
import {submittedTableHTML} from '../../js/manpower/submitted-workspace.js';
test('worker query sends stable request/line IDs and bounded server filters',async()=>{
  const calls=[];const client={rpc:async(...args)=>{calls.push(args);return {data:{data:[],count:0}};}};
  await loadLineWorkers(client,'request','line',{page:2,size:25,search:' Name ',state:'Scheduled'});
  assert.deepEqual(calls,[['manpower_line_workers',{p_request:'request',p_line:'line',p_page:2,p_size:25,p_search:'Name',p_state:'Scheduled'}]]);
  for(const options of [{page:0},{size:100},{state:'Unknown'},{search:'x'.repeat(121)}])await assert.rejects(()=>loadLineWorkers(client,'request','line',options),/Invalid/);
  assert.equal(calls.length,1);
});
test('worker query rejects missing or inconsistent results and propagates denied access',async()=>{
  for(const data of [null,{data:[],count:-1},{data:[{}],count:0},{data:Array(11).fill({}),count:11}])await assert.rejects(()=>loadLineWorkers({rpc:async()=>({data})},'r','l'),/could not be verified/);
  await assert.rejects(()=>loadLineWorkers({rpc:async()=>({error:{code:'42501'}})},'r','l'),error=>error.code==='42501');
});
test('worker table escapes source names, separates scheduled/actual dates and ages only active reservations',()=>{
  const now=Date.parse('2026-10-10T00:00:00Z');assert.equal(workerAge('2026-10-01T00:00:00Z',now),9);assert.equal(workerAge('invalid',now),null);assert.equal(workerAge('2026-10-11',now),null);
  const html=workerTableHTML([{name:'<script>',candidate_id:'<id>',state:'Scheduled',created_at:'2026-10-01',scheduled_date:'2026-10-20',hiring_category:'New Hire'},{name:'Historical',state:'Ended',created_at:'2026-10-01',actual_date:'2026-10-02',ended_date:'2026-10-05'}],value=>value,now);
  assert.match(html,/9 days/);assert.match(html,/2026-10-20/);assert.match(html,/2026-10-02/);assert.match(html,/2026-10-05/);assert.match(html,/Not applicable/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|NaN|undefined/);assert.match(html,/scope="col"/);assert.match(html,/tabindex="0"/);
  assert.match(workerTableHTML([],value=>value),/No matching permitted workers/);
});
test('worker navigation respects source access and filter controls are labelled/escaped',()=>{
  const row={id:'line',ordinal:0};assert.doesNotMatch(submittedTableHTML([row],'lines',value=>value),/showManpowerLineWorkers/);
  assert.match(submittedTableHTML([row],'lines',value=>value,'',{canViewWorkers:true}),/View workers for line 1/);
  const filters=workerFiltersHTML('<script>','Reserved');assert.match(filters,/aria-label="Search line workers/);assert.match(filters,/aria-label="Filter assignment state/);assert.match(filters,/Back to Requisition Lines/);assert.doesNotMatch(filters,/<script>/);
});
test('worker SQL uses invoker RLS, scoped joins, bounded filtered totals and minimal source projection',()=>{
  const sql=readFileSync(new URL('../../supabase/proposals/0059_manpower_worker_monitoring.sql',import.meta.url),'utf8');
  assert.match(sql,/security invoker/);assert.doesNotMatch(sql,/security definer|insert into|update public|delete from|disable row level/);
  assert.match(sql,/onboarding.view/);assert.match(sql,/manpower.view/);assert.match(sql,/line.request_id=p_request/);assert.match(sql,/reservation.tenant_id=public.current_tenant_id/);
  assert.match(sql,/from filtered order by created_at desc,id/);assert.match(sql,/count\(\*\) from filtered/);assert.match(sql,/p_size not in \(10,25,50\)/);assert.match(sql,/from public,anon/);
  assert.doesNotMatch(sql,/to_jsonb\(candidate\)|candidate.data as/);
});
