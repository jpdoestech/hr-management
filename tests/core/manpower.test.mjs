import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDaysBetween,manpowerRequestSummary,requirementSlotCounts,slotChronologyIssues,slotMetrics} from '../../js/core/manpower.js';

const request={id:'req-1',dateRequested:'2026-09-01',targetDeploymentDate:'2026-09-30',status:'Open'};
const requirement={id:'need-1',requestId:'req-1',requestedHeadcount:3,requestType:'Expansion'};

test('keeps onboarding, deployment lead time, and fulfillment time distinct',()=>{
  assert.deepEqual(slotMetrics({dateOnboarded:'2026-09-10',dateDeployed:'2026-09-14'},request,requirement),{
    timeToOnboard:9,
    deploymentLeadTime:4,
    totalFulfillmentTime:13,
    deploymentVariance:-16,
    replacementLeadTime:null,
  });
});

test('calculates partial fulfillment from individual slots',()=>{
  const slots=[
    {requirementId:'need-1',employeeId:'e1',dateSelected:'2026-09-05',dateOnboarded:'2026-09-10',dateDeployed:'2026-09-14',status:'Deployed'},
    {requirementId:'need-1',employeeId:'e2',dateSelected:'2026-09-06',dateOnboarded:'2026-09-12',status:'Onboarded / Ready for Deployment'},
    {requirementId:'need-1',status:'Open'},
  ];
  assert.deepEqual(requirementSlotCounts(requirement,slots),{requested:3,selected:2,onboarded:2,deployed:1,cancelled:0,remaining:2,slots});
  const summary=manpowerRequestSummary(request,[requirement],slots,'2026-09-24');
  assert.equal(summary.status,'Partially Fulfilled');
  assert.equal(summary.fulfillmentRate,33.3);
  assert.equal(summary.risk,'Monitor');
});

test('marks open requests overdue without overwriting fulfilled requests',()=>{
  const open=manpowerRequestSummary(request,[requirement],[], '2026-10-01');
  assert.equal(open.status,'Overdue');
  assert.equal(open.risk,'Overdue');
  const deployed=[1,2,3].map(index=>({requestId:'req-1',requirementId:'need-1',employeeId:`e${index}`,dateDeployed:'2026-09-30',status:'Deployed'}));
  const complete=manpowerRequestSummary(request,[requirement],deployed,'2026-10-01');
  assert.equal(complete.status,'Fulfilled');
  assert.equal(complete.risk,'Deployed On Time');
});

test('closes cancelled demand without reporting it as fulfilled',()=>{
  const cancelled=[1,2,3].map(index=>({requirementId:'need-1',slotNumber:index,status:'Cancelled'}));
  const summary=manpowerRequestSummary(request,[requirement],cancelled,'2026-10-01');
  assert.equal(summary.status,'Closed');
  assert.equal(summary.risk,'Closed');
  assert.equal(summary.fulfillmentRate,0);
  assert.equal(summary.remaining,0);
});

test('flags impossible slot chronology and invalid replacement combinations',()=>{
  const issues=slotChronologyIssues({dateOnboarded:'2026-09-12',dateDeployed:'2026-09-10'},request,requirement);
  assert.ok(issues.some(issue=>issue.includes('before the onboarded')));
  assert.ok(issues.some(issue=>issue.includes('linked to an employee')));
  const replacement={...requirement,requestType:'Replacement'};
  assert.ok(slotChronologyIssues({},request,replacement).some(issue=>issue.includes('employee being replaced')));
});

test('calculates replacement lead time from the linked exit date',()=>{
  const metrics=slotMetrics({replacementExitDate:'2026-09-03',dateDeployed:'2026-09-14'},request,{...requirement,requestType:'Replacement'});
  assert.equal(metrics.replacementLeadTime,11);
  assert.equal(calendarDaysBetween('2026-09-14','2026-09-03'),-11);
});
