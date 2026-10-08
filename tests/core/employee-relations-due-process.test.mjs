import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  caseDecisionValidation,
  caseDueProcessReadiness,
} from '../../js/core/employee-relations.js';

test('formal response readiness ignores withdrawn responses and accepts documented no-response',()=>{
  assert.equal(caseDueProcessReadiness({responses:[{status:'Withdrawn'}]}).hasResponse,false);
  assert.equal(caseDueProcessReadiness({responses:[{status:'No Response',response_type:'No Response'}]}).hasResponse,true);
  assert.equal(caseDueProcessReadiness({responses:[{status:'Received',received_at:'2026-10-07T08:00:00Z'}]}).hasResponse,true);
});

test('a requested hearing must be held or explicitly marked not required',()=>{
  const pending=caseDueProcessReadiness({responses:[{status:'Received',hearing_requested:true}]});
  assert.equal(pending.hasResponse,true);
  assert.equal(pending.responseOpportunityHandled,false);
  const handled=caseDueProcessReadiness({responses:[{status:'Received',hearing_requested:true}],hearings:[{status:'Not Required'}]});
  assert.equal(handled.responseOpportunityHandled,true);
});

test('decision and NOD readiness require explicit final states',()=>{
  const draft=caseDueProcessReadiness({
    decisions:[{decision_status:'Draft'}],
    nodRecords:[{dateOfNod:'2026-10-07',finalizationStatus:'Draft'}],
  });
  assert.equal(draft.hasApprovedDecision,false);
  assert.equal(draft.hasDecisionNotice,false);

  const final=caseDueProcessReadiness({
    decisions:[{decision_status:'Approved'}],
    nodRecords:[{dateOfNod:'2026-10-07',finalizationStatus:'Finalized'}],
  });
  assert.equal(final.hasApprovedDecision,true);
  assert.equal(final.hasDecisionNotice,true);
});

test('findings readiness requires every allegation to be finalized',()=>{
  const readiness=caseDueProcessReadiness({allegations:[
    {finding:'Substantiated'},
    {finding:'Pending'},
  ]});
  assert.equal(readiness.hasPreparedFindings,true);
  assert.equal(readiness.hasFinalFindings,false);
});

test('decision validation separates the TDA recommendation from final action',()=>{
  const invalid=caseDecisionValidation({
    overall_outcome:'Substantiated',
    reasoning:'Supported by the reviewed evidence.',
    deviation_from_tda:true,
    final_action:'Written warning',
    decision_date:'2026-10-07',
  },{requireApproval:true});
  assert.equal(invalid.valid,false);
  assert.ok(invalid.missing.includes('TDA deviation reason'));

  const valid=caseDecisionValidation({
    overall_outcome:'Substantiated',
    reasoning:'Supported by the reviewed evidence.',
    tda_recommended_action:'Suspension',
    final_action:'Written warning',
    deviation_from_tda:true,
    deviation_reason:'Approved mitigating circumstances.',
    decision_date:'2026-10-07',
  },{requireApproval:true});
  assert.equal(valid.valid,true);
});

test('Phase 24 migration is additive, tenant-scoped, and approval guarded',async()=>{
  const migration=await readFile(new URL('../../supabase/migrations/0021_employee_relations_due_process.sql',import.meta.url),'utf8');
  for(const table of ['hr_case_responses','hr_case_hearings','hr_case_decisions']){
    assert.match(migration,new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration,/foreach table_name in array array\['hr_case_responses','hr_case_hearings','hr_case_decisions'\]/);
  assert.match(migration,/alter table public\.%I enable row level security/);
  assert.match(migration,/current_user_has_permission\('employee_relations\.approve'\)/);
  assert.match(migration,/Approved decision content is immutable/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});
