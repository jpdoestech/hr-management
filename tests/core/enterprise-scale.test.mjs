import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measureAsync,performanceSnapshot,recordPerformance} from '../../js/core/performance.js';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../../supabase/migrations/0016_tenant_scale_foundation.sql',import.meta.url),'utf8');
const resetScript=await readFile(new URL('../../supabase/maintenance/reset_hr_data_preserve_users.sql',import.meta.url),'utf8');

test('authentication loads a bounded bootstrap module set',()=>{
  assert.match(source,/const BOOTSTRAP_RECORD_MODULES = \[/);
  assert.match(source,/\.in\('module',BOOTSTRAP_RECORD_MODULES\)/);
  assert.match(source,/function ensureRecordModules\(modules\)/);
  assert.match(source,/const VIEW_RECORD_MODULES=\{/);
  assert.match(source,/await ensureViewRecordModules\(view\)/);
  assert.match(source,/MODULE_LOAD_QUEUE=MODULE_LOAD_QUEUE\.catch\(\(\)=>\{\}\)\.then/);
  assert.match(source,/LOADED_RECORD_MODULES\.clear\(\)/);
});

test('record saves cannot delete unloaded modules',()=>{
  assert.match(source,/const loadedModules=\[\.\.\.LOADED_RECORD_MODULES\]/);
  assert.match(source,/saveDBInternal\(snapshot,loadedModules\)/);
  assert.match(source,/buildRecordChanges\(DB_SNAPSHOT\|\|blankDB\(\),state,modules\)/);
  assert.match(source,/modules\.forEach\(module=>\{nextSnapshot\[module\]/);
});

test('performance monitor is bounded and contains no business payload',async()=>{
  const value=await measureAsync('test.operation',async()=>42,{view:'test'});
  assert.equal(value,42);
  for(let index=0;index<130;index+=1)recordPerformance('bounded',index);
  const snapshot=performanceSnapshot();
  assert.equal(snapshot.samples.length,120);
  assert.ok(snapshot.summary.some(item=>item.name==='bounded'&&item.count>0));
  assert.deepEqual(Object.keys(snapshot.samples.at(-1)).sort(),['at','duration','name'].sort());
});

test('Phase 19 adds restrictive tenant isolation without replacing role policies',()=>{
  assert.match(migration,/create table if not exists public\.hr_tenants/);
  assert.match(migration,/create or replace function public\.current_tenant_id\(\)/);
  assert.match(migration,/as restrictive for all to authenticated/i);
  assert.match(migration,/tenant_id=public\.current_tenant_id\(\)/);
  assert.match(migration,/primary key \(tenant_id,id\)/);
  assert.match(migration,/create trigger enforce_tenant_write/);
  assert.match(migration,/Tenant boundary violation/);
});

test('Phase 19 scopes new storage paths and preserves default-tenant legacy paths',()=>{
  assert.match(source,/TENANT_SCHEMA_READY\?`\$\{SESSION\.tenantId\|\|DEFAULT_TENANT_ID\}/);
  assert.match(migration,/storage_object_in_current_tenant/);
  assert.match(migration,/\(storage\.foldername\(name\)\)\[2\]=auth\.uid\(\)::text/);
  assert.match(migration,/profile\.id::text=\(storage\.foldername\(object_name\)\)\[1\]/);
});

test('direct employee actions hydrate their owning modules',()=>{
  assert.match(source,/async function openEmployeeProfile[\s\S]*await ensureRecordModules\(\['leaves','disciplinary'/);
  assert.match(source,/async function openTransferForEmployee[\s\S]*ensureRecordModules\(\['employees','transfers'\]\)/);
  assert.match(source,/async function exportEmployeesCSV[\s\S]*ensureRecordModules\(RECORD_MODULES\)/);
});

test('tenant-aware reset cannot erase another tenant',()=>{
  assert.match(resetScript,/target_tenant uuid/);
  assert.match(resetScript,/delete from public\.%I where tenant_id=\$1/);
  assert.match(resetScript,/on conflict \(tenant_id,id\)/);
});
