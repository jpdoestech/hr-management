import test from 'node:test';
import assert from 'node:assert/strict';
import {paginationHTML,paginationMeta,paginateRows,paginationReset} from '../../js/core/pagination.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {loadSubmittedRequests,loadSubmittedRows} from '../../js/manpower/submitted-workspace.js';
import {loadLineWorkers} from '../../js/manpower/worker-monitoring.js';

test('pagination can expose a bounded set of page sizes',()=>{
  const html=paginationHTML({page:1,pages:4,size:10,total:186},'records:employees',{go:'serverTablePageGo',size:'serverTablePageSize',sizes:[10,25,50]});
  assert.match(html,/>10<\/option>/);
  assert.match(html,/>25<\/option>/);
  assert.match(html,/>50<\/option>/);
  assert.doesNotMatch(html,/>100<\/option>/);
  assert.doesNotMatch(html,/>All<\/option>/);
});

test('fresh tables default to 25 and retain explicit page-size choices across resets',()=>{
  const state={},rows=Array.from({length:60},(_,i)=>i);
  const initial=paginateRows(rows,state,'employees');
  assert.equal(initial.meta.size,25);assert.equal(initial.rows.length,25);assert.equal(initial.meta.pages,3);
  assert.match(paginationHTML(initial.meta,'employees'),/<option value="25" selected>/);
  state.tablePages.employees={page:2,size:10};assert.equal(paginationMeta(state,'employees',60).size,10);
  paginationReset(state,'employees');assert.equal(paginationMeta(state,'employees',60).size,10);
  assert.equal(paginationMeta({tablePages:{x:{size:7}}},'x',60).size,25);
});

test('server-backed table state defaults to 25 while honoring selected sizes',()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const helper=app.slice(app.indexOf('function requestedPageState('),app.indexOf('async function queryRecordPage('));
  const sandbox={STATE:{},ALL_ROWS_SIZE:100000};runInNewContext(helper+'\nthis.read=requestedPageState;',sandbox);
  assert.equal(sandbox.read('records:employees').size,25);
  sandbox.STATE.tablePages['records:employees']={page:1,size:10};assert.equal(sandbox.read('records:employees').size,10);
  assert.equal(sandbox.read('attendance').size,25);
  const enhancer=readFileSync(new URL('../../js/core/table-enhancer.js',import.meta.url),'utf8');
  assert.doesNotMatch(app+enhancer,/defaultSize[:=]10\b|size:10\b|Number\(size\)\|\|10\b/);
});

test('submitted request, history and worker query defaults are bounded to 25',async()=>{
  const ranges=[],query={};
  for(const name of ['select','in','order','eq'])query[name]=()=>query;
  query.range=(start,end)=>{ranges.push([start,end]);return query;};
  query.then=resolve=>Promise.resolve(resolve({data:[],count:0}));
  const client={from:()=>query};
  await loadSubmittedRequests(client);await loadSubmittedRows(client,'synthetic','lines');
  assert.deepEqual(ranges,[[0,24],[0,24]]);
  let size;await loadLineWorkers({rpc:async(_name,params)=>{size=params.p_size;return {data:{data:[],count:0}};}},'synthetic','line');
  assert.equal(size,25);
});
