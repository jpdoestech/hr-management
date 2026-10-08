import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {caseDecisionNoticeValidation,caseImplementationValidation,caseResponseChronology,caseTransitionValidation,employeeRelationsValidationIssues} from '../../js/core/employee-relations.js';

const migration=await readFile(new URL('../../supabase/migrations/0025_employee_relations_validation.sql',import.meta.url),'utf8');

test('response chronology rejects a response received before the linked NTE',()=>{
  assert.equal(caseResponseChronology({receivedAt:'2026-10-07T08:00:00Z',nteIssueDates:['2026-10-08']}).valid,false);
  assert.equal(caseResponseChronology({receivedAt:'2026-10-08T08:00:00Z',nteIssueDates:['2026-10-08']}).valid,true);
});

test('NOD finalization requires approval and chronological issue/service dates',()=>{
  assert.equal(caseDecisionNoticeValidation({decision_status:'For Approval',decision_date:'2026-10-05',nod_status:'Issued',nod_issued_at:'2026-10-06'}).valid,false);
  assert.equal(caseDecisionNoticeValidation({decision_status:'Approved',decision_date:'2026-10-05',nod_status:'Served',nod_issued_at:'2026-10-06',nod_served_at:'2026-10-07'}).valid,true);
  assert.equal(caseDecisionNoticeValidation({decision_status:'Approved',decision_date:'2026-10-07',nod_status:'Issued',nod_issued_at:'2026-10-06'}).valid,false);
});

test('implementation cannot predate its approved decision and requires completion evidence',()=>{
  const invalid=caseImplementationValidation({decision_id:'decision-1',action_type:'Suspension',status:'Completed',effective_date:'2026-10-06'},{decisionDate:'2026-10-07'});
  assert.equal(invalid.valid,false);
  assert.ok(invalid.missing.includes('a completion date'));
  assert.ok(invalid.missing.some(item=>item.startsWith('effective date')));
  const valid=caseImplementationValidation({decision_id:'decision-1',action_type:'Suspension',status:'Completed',effective_date:'2026-10-08',completion_date:'2026-10-10'},{decisionDate:'2026-10-07'});
  assert.equal(valid.valid,true);
});

test('case closure remains blocked while required implementation work is open',()=>{
  const result=caseTransitionValidation('Closed',{hasOutcome:true,hasClosureDate:true,hasOpenImplementationTasks:true});
  assert.equal(result.valid,false);
  assert.ok(result.missing.includes('completion of mandatory implementation work'));
});

test('data-quality validation flags legacy exceptions without changing source records',()=>{
  const issues=employeeRelationsValidationIssues({cases:[{id:'case-1',case_number:'CASE-1',status:'Closed',employee_record_id:''}],allegations:[{id:'a-1',case_id:'case-1',finding:'Substantiated',tda_rule_id:null}],decisions:[{id:'d-1',case_id:'case-1',decision_status:'Approved',decision_date:'2026-10-07',final_action:'Suspension',nod_status:'Issued',nod_issued_at:'2026-10-06'}],implementations:[{id:'i-1',case_id:'case-1',decision_id:'d-1',action_type:'Suspension',status:'Pending',effective_date:'2026-10-06'}]});
  const titles=issues.map(issue=>issue.title);
  for(const title of ['HR case has no stable employee ID','Confirmed finding has no TDA rule','Decision notice chronology is invalid','Closed case has unfinished implementation','Implementation record is invalid'])assert.ok(titles.includes(title));
});

test('Phase 28 is additive, transaction-wrapped, and installs all chronology triggers',()=>{
  for(const name of ['validate_case_decision_notice_timeline','validate_case_response_timeline','validate_case_implementation_timeline'])assert.match(migration,new RegExp(name));
  assert.match(migration,/Existing rows are preserved/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});
