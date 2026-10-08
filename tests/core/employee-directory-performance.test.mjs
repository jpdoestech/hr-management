import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const enhancer=await readFile(new URL('../../js/core/table-enhancer.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../../supabase/migrations/0015_employee_directory_performance.sql',import.meta.url),'utf8');

test('employee directory paints cached rows before refreshing from Supabase',()=>{
  const start=source.indexOf('function renderEmployees(){');
  const end=source.indexOf('function openEmployeeWorkspaceModal',start);
  const renderer=source.slice(start,end);

  assert.ok(start>0&&end>start,'employee renderer should be present');
  assert.doesNotMatch(renderer,/await\s+queryRecordPage/);
  assert.match(renderer,/paginateRows\(localEmployeeDirectoryRows\(query\)/);
  assert.match(renderer,/refreshEmployeeDirectoryPage\(query,signature\)/);
});

test('employee directory ignores stale server responses and bounds its page cache',()=>{
  assert.match(source,/EMPLOYEE_DIRECTORY_REQUEST_TOKEN/);
  assert.match(source,/token===EMPLOYEE_DIRECTORY_REQUEST_TOKEN/);
  assert.match(source,/while\(EMPLOYEE_DIRECTORY_PAGE_CACHE\.size>24\)/);
  assert.match(source,/invalidateEmployeeDirectoryCache\(\)/);
});

test('opening employee filters is a local UI action',()=>{
  const start=source.indexOf('function toggleEmployeeDirectoryFilters(){');
  const end=source.indexOf('const EMPLOYEE_COLUMN_DEFS',start);
  const handler=source.slice(start,end);

  assert.match(handler,/classList\.toggle\('expanded'/);
  assert.doesNotMatch(handler,/renderEmployees\(\)/);
});

test('employee metadata and dynamic column definitions are revision cached',()=>{
  assert.match(source,/EMPLOYEE_DIRECTORY_METADATA_CACHE\.revision===EMPLOYEE_DIRECTORY_REVISION/);
  assert.match(source,/EMPLOYEE_COLUMN_CACHE\.revision===EMPLOYEE_DIRECTORY_REVISION/);
});

test('employee directory uses the projected Phase 18 RPC with a Phase 16 fallback',()=>{
  assert.match(source,/supabase\.rpc\('search_employee_directory'/);
  assert.match(source,/p_fields:\[\.\.\.new Set\(fields\.filter\(Boolean\)\)\]/);
  assert.match(source,/pageResult\|\|queryRecordPage/);
  assert.match(source,/employeeDirectoryRequestedFields\(columns\)/);
  assert.match(source,/return employeeDirectoryProjection\(columns\)/);
});

test('Phase 18 keeps RLS and adds employee-specific search indexes',()=>{
  assert.match(migration,/security invoker/i);
  assert.match(migration,/employee_directory_search_trgm_idx/);
  assert.match(migration,/where module = 'employees'/);
  assert.match(migration,/jsonb_object_agg\(field\.key, field\.value\)/);
  assert.match(migration,/grant execute on function public\.search_employee_directory[\s\S]*to authenticated/);
  assert.match(migration,/hr_records_employee_name_idx/);
  assert.match(migration,/lastName[\s\S]*asc/i);
});

test('employee directory defaults to employee name A-Z locally and on the indexed query',()=>{
  const start=source.indexOf('function localEmployeeDirectoryRows');
  const end=source.indexOf('function employeeDirectoryRowsHTML',start);
  const localSort=source.slice(start,end);
  assert.match(localSort,/employeeDisplayName\(left\)\.localeCompare\(employeeDisplayName\(right\)/);
  assert.doesNotMatch(localSort,/sort\(\(left,right\)=>String\(right\.employeeNo/);
});

test('employee rows expose one lightweight workspace action',()=>{
  const start=source.indexOf('function employeeDirectoryRowsHTML');
  const end=source.indexOf('function employeeDirectoryHasFilters',start);
  const rowsRenderer=source.slice(start,end);

  assert.match(rowsRenderer,/employee-directory-action/);
  assert.match(rowsRenderer,/Open employee workspace/);
  assert.doesNotMatch(rowsRenderer,/openTransferForEmployee/);
  assert.doesNotMatch(rowsRenderer,/deleteEmployee/);
});

test('employee profile paints before related modules are hydrated',()=>{
  const start=source.indexOf('async function openEmployeeProfile(id)',source.indexOf('const EMPLOYEE_PROFILE_MODULES'));
  const end=source.indexOf('/* ================================================================',start);
  const profileRenderer=source.slice(start,end);

  assert.ok(start>0&&end>start,'optimized employee profile should be present');
  assert.match(profileRenderer,/openEmployeeWorkspaceModal/);
  assert.doesNotMatch(profileRenderer,/requestAnimationFrame\(\(\)=>hydrateEmployeeProfile/);
  assert.doesNotMatch(profileRenderer,/await ensureRecordModules/);
  assert.match(source,/Promise\.all\(\[loadEmployeeProfileRecords\(employee\),loadEmployeeProfileCases\(employee\)\]\)/);
  assert.match(source,/if\(tab==='history'&&!cached&&!workspace\.dataset\.historyLoading\)/);
});

test('single employee row actions remain direct and selection avoids duplicate full scans',()=>{
  assert.match(source,/if\(buttons\.length===1\)\{group\.dataset\.menuEnhanced='true';return;\}/);
  assert.match(source,/onclick="openEmployeeProfile\('\$\{employee\.id\}'\)"/);
  assert.doesNotMatch(source,/onclick="selectEmployeeDirectoryRow\('\$\{employee\.id\}'\);openEmployeeProfile/);
});

test('employee profile uses stable employee ids and tabbed detail rendering',()=>{
  assert.match(source,/\.eq\('employee_record_id',String\(employee\.id\)\)/);
  assert.match(source,/supabase\.from\('hr_records'\)[\s\S]*\.or\(identityFilter\)/);
  assert.match(source,/await ensureRecordModules\(EMPLOYEE_PROFILE_MODULES\)/);
  assert.match(source,/function employeeProfileSetTab/);
  assert.match(source,/\['summary','Overview'\],\['personal','Personal'\],\['pay','Pay & IDs'\],\['history','History'\]/);
  assert.match(source,/EMPLOYEE_PROFILE_CACHE_TTL/);
});

test('employee directory follows bounded server pagination and never fetches all rows',()=>{
  const queryStart=source.indexOf('async function queryEmployeeDirectoryPage');
  const queryEnd=source.indexOf('function serverTablePageGo',queryStart);
  const employeeQuery=source.slice(queryStart,queryEnd);
  const paginationStart=source.indexOf('function employeeDirectoryPaginationHTML');
  const paginationEnd=source.indexOf('function applyEmployeeDirectoryPage',paginationStart);
  const employeePagination=source.slice(paginationStart,paginationEnd);

  assert.match(source,/scope==='records:employees'\?\[10,25,50\]/);
  assert.match(source,/if\(scope==='records:employees'\)\{[\s\S]*STATE\.tablePageSizes\[scope\]=size;[\s\S]*STATE\.tablePages\[scope\]=\{\.\.\.stored,page,size\}/);
  assert.doesNotMatch(employeeQuery,/requested\.size===ALL_ROWS_SIZE/);
  assert.match(employeePagination,/sizes:\[10,25,50\]/);
  assert.match(source,/data-view-all-disabled="true"/);
});

test('table enhancer skips unchanged tables and avoids self-triggered reorder churn',()=>{
  assert.match(enhancer,/sameTableShape\(existing\.shape,initialShape\)\) return/);
  assert.match(enhancer,/cells\.every\(\(cell,index\)=>cell\.dataset\.tableColumn===order\[index\]\)/);
  assert.match(enhancer,/if\(!ordered\)order\.forEach/);
  assert.match(enhancer,/cancelAnimationFrame\(observerFrame\)/);
});

test('frozen columns cache layout work until structure or viewport changes',()=>{
  assert.match(enhancer,/const frozenStates=new WeakMap\(\)/);
  assert.match(enhancer,/previous\?\.signature===signature&&sameTableShape\(previous\.shape,shape\)/);
  assert.match(enhancer,/applyFrozenColumns\(entry\.table,entry\.layout,true\)/);
});
