import test from 'node:test';
import assert from 'node:assert/strict';
import {centsTimesBasisPoints,resolveDatedVersion,holidayEligibility,dailyWagePreview,WAGE_DAY_TYPES} from '../../js/core/attendance-wage-rules.js';
const worked=Object.fromEntries(WAGE_DAY_TYPES.map((type,i)=>[type,[10000,13000,13000,15000,20000,26000,30000,39000][i]])),unworked=Object.fromEntries(WAGE_DAY_TYPES.map((type,i)=>[type,i<4?0:i<6?10000:20000]));
const statutory={id:'synthetic-rule',reviewed:true,effectiveFrom:'2024-01-01',reference:'Synthetic reviewed statutory reference',worked,unworked};
const policy={...statutory,id:'synthetic-policy',clientId:'synthetic-client',statutoryId:statutory.id};
const day={employeeId:'synthetic',clientId:policy.clientId,date:'2024-01-05',holiday:'regular_holiday',restDay:true,calendarReviewed:true,scheduleReviewed:true,calendarVersion:'cal-v1',scheduleVersion:'schedule-v1',attendance:{status:'Present',reviewState:'Approved',workedMinutes:480,version:'att-v1'}};
const evidence=(date,patch={})=>({...day,date,holiday:'ordinary',restDay:false,...patch});
test('centavos use integer arithmetic and half-up rounding exactly once',()=>{
  assert.equal(centsTimesBasisPoints(54000,26000),140400);assert.equal(centsTimesBasisPoints(1,15000),2);assert.throws(()=>centsTimesBasisPoints(1.2,10000));
});
test('one configured compound multiplier is applied once',()=>{
  const value=dailyWagePreview({day,policy,statutory,basicDailyCentavos:54000,coverageConfirmed:true});
  assert.equal(value.centavos,140400);assert.equal(value.basisPoints,26000);assert.equal(value.versions.attendance,'att-v1');
});
test('latest unreviewed policy does not fall back to a reviewed earlier version',()=>{
  const next={...policy,id:'v2',effectiveFrom:'2024-01-03',reviewed:false};assert.equal(resolveDatedVersion([policy,next],day.date).id,'v2');
  assert.equal(dailyWagePreview({day,policy:next,statutory,basicDailyCentavos:54000,coverageConfirmed:true}).status,'Needs Review');
});
test('missing policy, source evidence and below-minimum rates fail closed',()=>{
  assert.equal(dailyWagePreview({day,basicDailyCentavos:54000}).status,'Needs Review');
  const invalid={...policy,worked:{...worked,regular_holiday_rest_day:20000}};assert.equal(dailyWagePreview({day,policy:invalid,statutory,basicDailyCentavos:54000,coverageConfirmed:true}).status,'Needs Review');
  assert.equal(holidayEligibility(day,[]).status,'Needs Review');assert.throws(()=>holidayEligibility(day,[evidence('2024-01-04'),evidence('2024-01-04')]));
});
test('preceding evidence can cross cutoff, rest days and successive holidays',()=>{
  const history=[evidence('2024-01-04',{holiday:'regular_holiday',attendance:{status:'Rest Day / Holiday',reviewState:'Approved'}}),evidence('2024-01-03',{restDay:true,attendance:null}),evidence('2024-01-02',{attendance:{status:'Approved Leave',leaveTreatment:'Paid',reviewState:'Approved'}})];
  assert.equal(holidayEligibility(day,history).status,'Eligible');assert.equal(holidayEligibility(day,history).date,'2024-01-02');
  history[2].attendance.leaveTreatment='Unpaid';assert.equal(holidayEligibility(day,history).status,'Ineligible');
});
test('missing/unreviewed prior evidence and unsupported partial duty or monthly conversion need review',()=>{
  assert.equal(holidayEligibility(day,[evidence('2024-01-04',{attendance:{status:'Approved Leave',reviewState:'Approved'}})]).status,'Needs Review');
  assert.equal(holidayEligibility(day,[evidence('2024-01-04',{calendarReviewed:false})]).status,'Needs Review');
  const partial={...day,attendance:{...day.attendance,workedMinutes:470}};
  assert.equal(dailyWagePreview({day:partial,policy,statutory,basicDailyCentavos:54000,coverageConfirmed:true}).status,'Needs Review');
  assert.equal(dailyWagePreview({day,policy,statutory,basicDailyCentavos:54000,coverageConfirmed:true,payBasis:'monthly'}).status,'Needs Review');
});
test('unworked double holiday receives configured entitlement without a worked rest-day premium',()=>{
  const holiday={...day,holiday:'double_regular_holiday',attendance:{...day.attendance,status:'Rest Day / Holiday',workedMinutes:0}};
  const value=dailyWagePreview({day:holiday,history:[evidence('2024-01-04')],policy,statutory,basicDailyCentavos:54000,coverageConfirmed:true});assert.equal(value.centavos,108000);assert.equal(value.basisPoints,20000);
});
