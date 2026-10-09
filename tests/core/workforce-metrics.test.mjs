import test from 'node:test';
import assert from 'node:assert/strict';
import {ageOn,workforceAgeMix,attendanceMetrics,validateAttendance,fillRateSummary} from '../../js/core/workforce-metrics.js';

test('age bands respect birthdays and exact requested boundaries',()=>{
  assert.equal(ageOn('2000-10-10','2026-10-09'),25);
  assert.equal(ageOn('2000-10-09','2026-10-09'),26);
  const mix=workforceAgeMix([18,25,26,30,31,40,41,50,51,60,61,75].map(age=>({birthDate:`${2026-age}-10-09`,gender:'Male'})),'2026-10-09');
  assert.deepEqual(mix.slice(0,6).map(row=>row.total),[2,2,2,2,2,2]);
});
test('missing and invalid birth dates remain separate and totals include unknown genders',()=>{
  const rows=workforceAgeMix([{birthDate:'',gender:'Female'},{birthDate:'2026-02-30',gender:'Male'},{birthDate:'2000-01-01',gender:'Other'}],'2026-10-09');
  assert.equal(rows.at(-1).total,2);
  assert.equal(rows.reduce((sum,row)=>sum+row.total,0),3);
  assert.equal(rows[1].other,1);
  assert.equal(ageOn('2027-01-01','2026-10-09'),null);
});
const present={id:'a',employeeId:'e1',workDate:'2026-10-09',status:'Present',scheduledMinutes:480,lateMinutes:30,undertimeMinutes:60,factor:'Transport / Location'};
test('attendance KPIs use scheduled days and present-day denominators',()=>{
  const metrics=attendanceMetrics([present,{...present,id:'b',status:'Absent',lateMinutes:0,undertimeMinutes:0,absenceClassification:'Unauthorized'},{...present,id:'c',status:'Approved Leave',lateMinutes:0,undertimeMinutes:0},{...present,id:'d',status:'Rest Day / Holiday',lateMinutes:0,undertimeMinutes:0}]);
  assert.equal(metrics.scheduled,3);assert.equal(metrics.attendanceRate,33.3);assert.equal(metrics.absenceRate,33.3);
  assert.equal(metrics.lateRate,100);assert.equal(metrics.undertimeRate,100);assert.equal(metrics.lostMinutes,570);assert.equal(metrics.unauthorized,1);
  assert.equal(metrics.lostTimeRate,39.6);
  assert.equal(attendanceMetrics([]).attendanceRate,null);
});
test('attendance rejects duplicate employee/date, invalid dates and impossible minute totals',()=>{
  assert.equal(validateAttendance(present), '');
  assert.match(validateAttendance(present,[present]),/already exists/);
  assert.equal(validateAttendance(present,[present],'a'),'');
  assert.match(validateAttendance({...present,workDate:'2026-02-30'}),/valid work date/);
  assert.match(validateAttendance({...present,lateMinutes:500}),/cannot exceed/);
  assert.match(validateAttendance({...present,scheduledMinutes:1500}),/one day/);
  assert.match(validateAttendance({...present,lateMinutes:-1}),/non-negative/);
});
test('absence classification is mandatory and non-present days cannot contain lost minutes',()=>{
  assert.match(validateAttendance({...present,status:'Absent'}),/only to Present/);
  assert.match(validateAttendance({...present,status:'Absent',lateMinutes:0,undertimeMinutes:0}),/Classify/);
  assert.equal(validateAttendance({...present,status:'Absent',lateMinutes:0,undertimeMinutes:0,absenceClassification:'Pending Validation'}),'');
});
test('fill rate excludes cancelled slots and unrelated requirements',()=>{
  const metric=fillRateSummary([{id:'r1',requestedHeadcount:4}],[{requirementId:'r1',status:'Deployed'},{requirementId:'r1',status:'Cancelled'},{requirementId:'other',status:'Deployed'}]);
  assert.equal(metric.rate,33.3);assert.equal(metric.required,3);assert.equal(metric.unfilled,2);
  assert.equal(fillRateSummary([],[]).rate,null);
});
