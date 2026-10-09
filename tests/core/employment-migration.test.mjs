import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EMPLOYMENT_TYPES,EMPLOYMENT_STATUSES,STATUS_REASONS} from '../../js/core/employment.js';
const sql=readFileSync(new URL('../../supabase/migrations/0032_employee_employment_model.sql',import.meta.url),'utf8');
test('employment migration mirrors the shared contract/status/reason model and keeps query RLS',()=>{
  for(const value of [...EMPLOYMENT_TYPES,...EMPLOYMENT_STATUSES,...Object.values(STATUS_REASONS).flat()])assert.ok(sql.includes(`'${value}'`),value);
  assert.equal((sql.match(/security invoker/gi)||[]).length,2);
  assert.match(sql,/legacyEmploymentSnapshot/);assert.match(sql,/employmentModelVersion/);
  assert.doesNotMatch(sql,/delete from|drop table|disable row level security|security definer/i);
  assert.match(sql,/limit least\(greatest\(p_limit, 1\), 100\)/);
});
