import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../../supabase/migrations/0028_employee_relations_revisions.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');

test('Phase 31 is additive, transaction-wrapped, scoped, and approval protected',()=>{
  assert.match(migration,/create table if not exists public\.hr_case_revisions/);
  assert.match(migration,/create or replace function public\.controlled_case_revision/);
  assert.match(migration,/current_user_has_permission\('employee_relations\.approve'\)/);
  assert.match(migration,/current_user_scope_allows/);
  assert.match(migration,/length\(trim\(coalesce\(p_reason,''\)\)\) < 10/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});

test('decision amendment preserves finalized records and creates a replacement version',()=>{
  assert.match(migration,/decision_status=case when p_action='Supersede Decision' then 'Superseded' else 'Reversed' end/);
  assert.match(migration,/update public\.hr_disciplinary_history/);
  assert.match(migration,/status in \('Pending','In Progress'\)/);
  assert.match(migration,/insert into public\.hr_case_decisions/);
  assert.match(migration,/replacement_decision_id/);
  assert.match(migration,/supersedes_decision_id/);
  assert.match(migration,/preserve_amended_history_occurrence/);
  assert.match(migration,/nod_status[\s\S]*'Not Prepared'/);
});

test('material cases are retained and the revision UI is permission controlled',()=>{
  assert.match(migration,/prevent_material_hr_case_delete/);
  assert.match(migration,/Material HR cases cannot be deleted/);
  assert.match(app,/async function openCaseRevisionForm/);
  assert.match(app,/async function saveCaseRevision/);
  assert.match(app,/hasPermission\('employee_relations\.approve'\)/);
  assert.match(app,/Minimum 10 characters/);
  assert.match(app,/Delete empty draft case/);
});
