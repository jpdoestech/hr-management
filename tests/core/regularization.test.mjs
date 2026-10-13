import test from 'node:test';
import assert from 'node:assert/strict';
import {regularizationDate,regularizationWorkItems,regularizationToday} from '../../js/core/regularization.js';
import {readFileSync} from 'node:fs';
test('regularization uses six calendar months with month-end and leap-year clamping',()=>{
  assert.equal(regularizationToday(new Date('2026-10-12T16:05:00Z')),'2026-10-13');
  for(const [hire,due] of [['2024-08-31','2025-02-28'],['2023-08-31','2024-02-29'],['2024-02-29','2024-08-29'],['2026-04-13','2026-10-13']])assert.equal(regularizationDate(hire),due);
  for(const value of ['','bad','2024-02-30'])assert.equal(regularizationDate(value),'');
});
test('alerts include only employed Probationary workers and recent completed events',()=>{
  const base={id:'synthetic',dateHired:'2026-04-13',employmentType:'Probationary',status:'Active'};
  const items=regularizationWorkItems([base,{...base,id:'inactive',status:'Inactive'},{...base,id:'excluded',status:'Separated'},{...base,id:'project',employmentType:'Project-Based'}],'2026-10-13');
  assert.deepEqual(items.map(row=>row.employeeId),['synthetic','inactive']);assert.ok(items.every(row=>row.level==='danger'));
  assert.equal(regularizationWorkItems([base],'2026-10-01')[0].level,'warning');assert.equal(regularizationWorkItems([base],'2026-09-01').length,0);
  const completed={...base,employmentType:'Regular / Permanent',automaticRegularization:{policy:'six-calendar-months-v1',effectiveDate:'2026-10-13',processedAt:'2026-10-13T00:00:00Z'}};
  assert.equal(regularizationWorkItems([completed],'2026-10-13')[0].completed,true);assert.equal(regularizationWorkItems([completed],'2026-11-01').length,0);
});
test('database boundary preserves authorization and does not backfill during migration',()=>{
  const sql=readFileSync(new URL('../../supabase/migrations/0061_automatic_employee_regularization.sql',import.meta.url),'utf8');
  assert.match(sql,/security invoker/);assert.match(sql,/current_user_scope_allows\(record_id,data\)/);assert.match(sql,/current_user_has_permission\('employees.update'\)/);
  assert.match(sql,/revoke all on function public.run_scheduled_employee_regularization\(\) from public,anon,authenticated/);
  assert.doesNotMatch(sql,/disable row level|drop policy|create extension|delete from/);
});
