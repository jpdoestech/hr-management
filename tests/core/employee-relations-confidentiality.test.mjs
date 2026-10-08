import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../../supabase/migrations/0029_employee_relations_confidentiality.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');

test('Phase 32 is transaction-wrapped, additive, and protects confidential case data',()=>{
  assert.match(migration,/add column if not exists confidential boolean not null default true/);
  assert.match(migration,/employee_relations\.view_confidential/);
  assert.match(migration,/current_user_can_access_er_case/);
  assert.match(migration,/as restrictive for all to authenticated/);
  assert.match(migration,/hr_case_evidence/);
  assert.match(migration,/hr_case_revisions/);
  assert.match(migration,/storage\.objects as restrictive for select/);
  assert.match(migration,/enforce_employee_relations_stage_permission/);
  assert.match(migration,/employee_relations\.override_tda_recommendation/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});

test('case UI captures confidentiality and gates stage-sensitive actions',()=>{
  assert.match(app,/id="case_confidential"/);
  assert.match(app,/ensureCaseConfidentialityReady/);
  assert.match(app,/hasErCapability\('record_response'\)/);
  assert.match(app,/hasErCapability\('manage_hearing'\)/);
  assert.match(app,/hasErCapability\('propose_decision'\)/);
  assert.match(app,/hasErCapability\('approve_decision','approve'\)/);
  assert.match(app,/hasErCapability\('implement_action'\)/);
  assert.match(app,/function caseTransitionCapability/);
});
