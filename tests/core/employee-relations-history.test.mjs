import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {qualifyingDisciplinaryHistory,nextPotentialOccurrence} from '../../js/core/employee-relations.js';

const migration=await readFile(new URL('../../supabase/migrations/0022_disciplinary_history.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');

test('progressive occurrence includes only active verified finalized findings',()=>{
  const records=[
    {employee_record_id:'EMP-1',tda_rule_id:'TDA-1',finding:'Substantiated',verification_status:'Verified',status:'Active',finalization_date:'2026-01-10'},
    {employee_record_id:'EMP-1',tda_rule_id:'TDA-1',finding:'Partially Substantiated',verification_status:'Verified',status:'Active',finalization_date:'2026-03-10'},
    {employee_record_id:'EMP-1',tda_rule_id:'TDA-1',finding:'Substantiated',verification_status:'Legacy Unverified',status:'Active',finalization_date:'2025-01-10'},
    {employee_record_id:'EMP-1',tda_rule_id:'TDA-1',finding:'Substantiated',verification_status:'Verified',status:'Reversed',finalization_date:'2025-02-10'},
    {employee_record_id:'EMP-1',tda_rule_id:'TDA-1',finding:'Unsubstantiated',verification_status:'Verified',status:'Active',finalization_date:'2025-03-10'},
    {employee_record_id:'EMP-2',tda_rule_id:'TDA-1',finding:'Substantiated',verification_status:'Verified',status:'Active',finalization_date:'2025-04-10'},
  ];
  const options={employeeRecordId:'EMP-1',tdaRuleId:'TDA-1'};
  assert.equal(qualifyingDisciplinaryHistory(records,options).length,2);
  assert.equal(nextPotentialOccurrence(records,options),3);
});

test('Phase 25 migration is additive, tenant-scoped, protected, and idempotent',()=>{
  assert.match(migration,/create table if not exists public\.hr_disciplinary_history/);
  assert.match(migration,/unique \(tenant_id,case_id,decision_id,allegation_id\)/);
  assert.match(migration,/create or replace function public\.generate_case_disciplinary_history/);
  assert.match(migration,/on conflict \(tenant_id,case_id,decision_id,allegation_id\) do update/);
  assert.match(migration,/Preserve an already-issued occurrence/);
  assert.match(migration,/protect_finalized_case_allegation/);
  assert.match(migration,/create policy tenant_isolation on public\.hr_disciplinary_history/);
  assert.match(migration,/current_user_has_permission\('employee_relations\.view'\)/);
  assert.match(migration,/order by coalesce\(d\.nod_served_at/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});

test('history UI uses normalized rows and keeps reports and legacy records separate',()=>{
  assert.match(app,/supabase\.from\('hr_disciplinary_history'\)/);
  assert.match(app,/function tdaEmployeeOffenseCount[\s\S]{0,500}qualifyingDisciplinaryHistory\(DISCIPLINARY_HISTORY_CACHE/);
  assert.match(app,/Verified History/);
  assert.match(app,/Legacy Review/);
  assert.match(app,/Not counted as findings/);
  const summary=app.slice(app.indexOf('async function renderOffenseSummary'),app.indexOf('WORKFLOW & APPROVAL CENTER'));
  assert.match(summary,/history\.forEach/);
  assert.match(summary,/row\.legacy\+=1/);
  assert.match(summary,/row\.reports\+=1/);
  assert.doesNotMatch(summary,/DB\.cvr[\s\S]{0,180}row\.confirmed/);
});
