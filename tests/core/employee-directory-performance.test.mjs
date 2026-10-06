import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../../supabase/phase18-employee-directory-performance.sql',import.meta.url),'utf8');

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
