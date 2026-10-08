import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  actionRequiresImplementation,
  caseImplementationReadiness,
  caseLifecycleWorkItem,
  caseProgressModel,
  employeeRelationsMetrics,
  employeeRelationsWorkItems,
} from '../../js/core/employee-relations.js';

test('case progress exposes blockers and completes only at a terminal stage',()=>{
  const active=caseProgressModel({id:'case-1',case_number:'ER-001',status:'Awaiting Employee Response'},{hasSource:true,hasAllegations:true,hasEvidence:true,hasNte:true,hasResponse:false,hearingRequired:false,hearingHandled:true,hasFinalFindings:false,hasApprovedDecision:false,hasDecisionNotice:false},[]);
  assert.equal(active.current.key,'notice');
  assert.ok(active.blockers.some(message=>/employee response/i.test(message)));
  assert.ok(active.percent<100);
  const closed=caseProgressModel({id:'case-1',case_number:'ER-001',status:'Closed'},{},[]);
  assert.equal(closed.percent,100);
  assert.ok(closed.stages.every(stage=>stage.state==='complete'));
});

const migration=await readFile(new URL('../../supabase/migrations/0024_employee_relations_monitoring.sql',import.meta.url),'utf8');
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

test('stage-aware work queue covers intake, due process, implementation, and closure',()=>{
  const cases=[
    {id:'triage',case_number:'ER-001',employee_name:'ALPHA, ANA',status:'Under Investigation',opened_at:'2026-08-01',due_date:'2026-10-07',assigned_to:'user-1'},
    {id:'nte',case_number:'ER-002',employee_name:'BRAVO, BEN',status:'NTE Issued',opened_at:'2026-10-01'},
    {id:'response',case_number:'ER-003',employee_name:'CRUZ, CARA',status:'Awaiting Employee Response',opened_at:'2026-10-01',due_date:'2026-10-09'},
    {id:'decision',case_number:'ER-004',employee_name:'DIAZ, DAN',status:'For Decision',opened_at:'2026-10-01'},
    {id:'nod',case_number:'ER-005',employee_name:'EVANGELISTA, EVE',status:'NOD Issued',opened_at:'2026-10-01'},
    {id:'implementation',case_number:'ER-006',employee_name:'FLORES, FAY',status:'For Implementation',opened_at:'2026-10-01'},
    {id:'closure',case_number:'ER-007',employee_name:'GOMEZ, GIA',status:'Implemented',opened_at:'2026-10-01'},
    {id:'closed',case_number:'ER-008',employee_name:'HERRERA, HAL',status:'Closed',opened_at:'2026-09-01'},
  ];
  const work=employeeRelationsWorkItems({
    today:'2026-10-08',
    cases,
    intake:[{id:'intake-1',intake_number:'INT-001',employee_name:'ISLA, IAN',report_type:'Supervisor Referral',subject:'Attendance report',status:'Submitted'}],
    hearings:[{id:'hearing-1',case_id:'response',hearing_type:'Administrative Conference',status:'Scheduled',scheduled_at:'2026-10-09T09:00:00+08:00'}],
    decisions:[
      {id:'decision-1',case_id:'decision',version:2,decision_status:'For Approval',nod_status:'Not Prepared'},
      {id:'decision-2',case_id:'nod',version:1,decision_status:'Approved',nod_status:'Issued'},
    ],
    implementations:[{id:'implementation-1',case_id:'implementation',status:'Pending',action_type:'Suspension',due_date:'2026-10-10'}],
  });
  assert.ok(work.some(item=>item.id==='intake:intake-1:triage'&&item.recordKind==='intake'));
  assert.ok(work.some(item=>item.id==='case:triage:case_investigation'&&item.level==='danger'));
  assert.ok(work.some(item=>item.id==='case:nte:case_nte_service'));
  assert.ok(work.some(item=>item.id==='case:response:case_response'&&item.level==='warning'));
  assert.ok(work.some(item=>item.id==='case:response:hearing:hearing-1'));
  assert.ok(work.some(item=>item.id==='case:decision:case_decision'&&item.title.startsWith('Decision approval pending')));
  assert.ok(work.some(item=>item.id==='case:nod:case_nod_service'&&item.title.startsWith('Record NOD service')));
  assert.ok(work.some(item=>item.id==='case:implementation:case_implementation'&&item.dueDate==='2026-10-10'));
  assert.ok(work.some(item=>item.id==='case:closure:case_closure'));
  assert.equal(work.some(item=>item.caseId==='closed'),false);
});

test('stage-aware work queue deduplicates a case stage and its normalized record',()=>{
  const work=employeeRelationsWorkItems({
    today:'2026-10-08',
    cases:[{id:'case-1',case_number:'ER-101',employee_name:'SANTOS, SAM',status:'For Implementation',opened_at:'2026-10-01',assigned_to:'user-1'}],
    implementations:[{id:'implementation-1',case_id:'case-1',status:'In Progress',action_type:'Written Warning',due_date:'2026-10-12'}],
  });
  const implementationItems=work.filter(item=>item.actionType==='case_implementation');
  assert.equal(implementationItems.length,1);
  assert.match(implementationItems[0].detail,/Written Warning/);
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

test('Phase 27 migration is additive, scoped, protected, and transaction-wrapped',()=>{
  assert.match(migration,/create table if not exists public\.hr_case_interim_measures/);
  assert.match(migration,/create table if not exists public\.hr_case_implementations/);
  assert.match(migration,/Temporary safeguards during an Employee Relations case/);
  assert.match(migration,/protect_completed_case_implementation/);
  assert.match(migration,/sync_case_implementation_history/);
  assert.match(migration,/authorization_details text/);
  assert.doesNotMatch(migration,/^\s*authorization\s+text/im);
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
  assert.match(app,/loadEmployeeRelationsWorkQueue/);
  assert.match(app,/employeeRelationsQueue\.items/);
  assert.match(app,/openActionCenterItem/);
});
