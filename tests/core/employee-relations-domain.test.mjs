import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  CASE_WORKFLOW_STAGES,
  canTransitionCase,
  caseStageOptions,
  caseTransitionValidation,
  isCaseReportSource,
  nextPotentialOccurrence,
  qualifyingDisciplinaryHistory,
} from '../../js/core/employee-relations.js';

const migration=await readFile(new URL('../../supabase/phase23-employee-relations-case-foundation.sql',import.meta.url),'utf8');

test('case workflow removes the mandatory memo stage and restricts transitions',()=>{
  assert.equal(CASE_WORKFLOW_STAGES.includes('Memo Issued'),false);
  assert.equal(canTransitionCase('Under Investigation','NTE Preparation'),true);
  assert.equal(canTransitionCase('Under Investigation','Decision Approved'),false);
  assert.deepEqual(caseStageOptions('NTE Preparation').slice(0,3),['NTE Preparation','Under Investigation','NTE Issued']);
});

test('case transition validation enforces investigation and closure prerequisites',()=>{
  const investigation=caseTransitionValidation('Under Investigation',{hasAllegation:false,hasAssignee:false});
  assert.equal(investigation.valid,false);
  assert.deepEqual(investigation.missing,['at least one allegation','an assigned HR owner']);
  const closed=caseTransitionValidation('Closed',{hasOutcome:true,hasClosureDate:true,hasOpenImplementationTasks:false});
  assert.equal(closed.valid,true);
});

test('only Incident and CVR are report sources',()=>{
  assert.equal(isCaseReportSource('incidents'),true);
  assert.equal(isCaseReportSource('cvr'),true);
  assert.equal(isCaseReportSource('disciplinary'),false);
  assert.equal(isCaseReportSource('memos'),false);
});

test('potential occurrence counts only finalized qualifying history by stable IDs',()=>{
  const records=[
    {employee_record_id:'emp-1',tda_rule_id:'rule-1',finding:'Substantiated',status:'Finalized'},
    {employee_record_id:'emp-1',tda_rule_id:'rule-1',finding:'Unsubstantiated',status:'Finalized'},
    {employee_record_id:'emp-1',tda_rule_id:'rule-1',finding:'Substantiated',status:'Draft'},
    {employee_record_id:'emp-1',tda_rule_id:'rule-1',finding:'Partially Substantiated',finalized:true,reversed_at:'2026-01-01'},
    {employee_record_id:'emp-2',tda_rule_id:'rule-1',finding:'Substantiated',status:'Finalized'},
  ];
  const options={employeeRecordId:'emp-1',tdaRuleId:'rule-1'};
  assert.equal(qualifyingDisciplinaryHistory(records,options).length,1);
  assert.equal(nextPotentialOccurrence(records,options),2);
});

test('case foundation migration is additive, tenant-scoped, and preserves legacy stages',()=>{
  assert.match(migration,/create table if not exists public\.hr_case_allegations/);
  assert.match(migration,/legacy_workflow_status=status/);
  assert.match(migration,/'Open','Memo Issued','Resolved'/);
  assert.match(migration,/create policy tenant_isolation on public\.hr_case_allegations/);
  assert.match(migration,/current_user_has_permission\('employee_relations\.view'\)/);
  assert.doesNotMatch(migration,/delete from public\.hr_(?:cases|records|case_links)/i);
});
