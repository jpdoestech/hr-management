import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');

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
