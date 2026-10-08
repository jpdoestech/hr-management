import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  actionRequiresImplementation,
  caseImplementationReadiness,
  caseLifecycleWorkItem,
  employeeRelationsMetrics,
} from '../../js/core/employee-relations.js';

const migration=await readFile(new URL('../../supabase/phase27-employee-relations-monitoring.sql',import.meta.url),'utf8');
const migrationCopy=await readFile(new URL('../../database/migrations/phase27-employee-relations-monitoring.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');

test('implementation readiness requires completed operational work for an approved action',()=>{
  assert.equal(actionRequiresImplementation('Written Warning'),true);
  assert.equal(actionRequiresImplementation('No disciplinary action'),false);
  const pending=caseImplementationReadiness({decisions:[{decision_status:'Approved',final_action:'Suspension'}],implementations:[]});
  assert.equal(pending.requiresImplementation,true);
  assert.equal(pending.hasImplementation,false);
  assert.equal(pending.hasOpenImplementationTasks,true);
  const complete=caseImplementationReadiness({decisions:[{decision_status:'Approved',final_action:'Suspension'}],implementations:[{status:'Completed'}]});
  assert.equal(complete.hasImplementation,true);
  assert.equal(complete.hasOpenImplementationTasks,false);
});

test('case lifecycle tasks use the controlled stage and implementation deadline',()=>{
  const work=caseLifecycleWorkItem({id:'case-1',case_number:'ER-001',status:'For Implementation',due_date:'2026-10-20'},[
    {case_id:'case-1',status:'Pending',due_date:'2026-10-12'},
  ]);
  assert.equal(work.workflowType,'Implementation');
  assert.equal(work.actionType,'case_implementation');
  assert.equal(work.dueDate,'2026-10-12');
});

test('analytics never count reports as confirmed violations',()=>{
  const metrics=employeeRelationsMetrics({
    today:'2026-10-07',
    reports:[{id:'incident-1'},{id:'cvr-1'}],
    cases:[{status:'Under Triage',opened_at:'2026-08-01',due_date:'2026-10-01'}],
    history:[
      {finding:'Substantiated',verification_status:'Verified',status:'Active',confirmed_occurrence:2},
      {finding:'Substantiated',verification_status:'Legacy Unverified',status:'Active',confirmed_occurrence:4},
    ],
  });
  assert.equal(metrics.reportedAllegations,2);
  assert.equal(metrics.confirmedViolations,1);
  assert.equal(metrics.repeatConfirmedOffenses,1);
  assert.equal(metrics.awaitingTriage,1);
});

test('Phase 27 migration is additive, scoped, protected, and mirrored exactly',()=>{
  assert.equal(migration,migrationCopy);
  assert.match(migration,/create table if not exists public\.hr_case_interim_measures/);
  assert.match(migration,/create table if not exists public\.hr_case_implementations/);
  assert.match(migration,/Temporary safeguards during an Employee Relations case/);
  assert.match(migration,/protect_completed_case_implementation/);
  assert.match(migration,/sync_case_implementation_history/);
  assert.match(migration,/current_user_scope_allows/);
  assert.match(migration,/current_user_has_permission\('employee_relations\.view'\)/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});

test('case workspace and analytics consume normalized monitoring records',()=>{
  assert.match(app,/function caseMonitoringWorkspaceHTML/);
  assert.match(app,/supabase\.from\('hr_case_implementations'\)/);
  assert.match(app,/employeeRelationsMetrics\(\{cases:caseScope/);
  assert.match(app,/Reported matters/);
  assert.match(app,/Confirmed violations/);
});
