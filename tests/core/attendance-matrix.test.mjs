import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffDates,matrixInput,assumedTransaction,compatibleTimeInputs,dutyMetrics,createMatrixDraft,rectangleCells,dayClassification} from '../../js/core/attendance-matrix.js';
const duties=[{start:480,end:720,breakMinutes:0},{start:780,end:1020,breakMinutes:0}];
const cell=(date='2024-01-02',extra={})=>({employeeId:'synthetic',date,hash:'',context:{ready:true,hash:'v1',holiday:'ordinary',restDay:false,segments:duties},...extra});
test('cutoffs cross months and years and reject impossible or oversized ranges',()=>{
  assert.equal(cutoffDates('2023-12-25','2024-01-10').length,17);assert.equal(cutoffDates('2024-02-28','2024-03-01').length,3);
  assert.throws(()=>cutoffDates('2024-02-30','2024-03-01'));assert.throws(()=>cutoffDates('2024-01-01','2024-02-01'));
});
test('painting stages one rectangle as one undo frame and redo restores it',()=>{
  const dates=['2024-01-02','2024-01-03'],rows=[{days:Object.fromEntries(dates.map(d=>[d,cell(d)]))}];
  const draft=createMatrixDraft();draft.apply(rectangleCells(rows,dates,{row:0,col:0},{row:0,col:1}).map(c=>matrixInput(c,'Present')));
  assert.equal(draft.count,2);draft.undo();assert.equal(draft.count,0);draft.redo();assert.equal(draft.count,2);draft.clear();assert.equal(draft.count,0);draft.undo();assert.equal(draft.count,2);
});
test('defaults remain assumptions and do not replace exceptions or infer holiday work',()=>{
  assert.equal(assumedTransaction(cell(),'present'),'Present');assert.equal(assumedTransaction(cell(),'absent'),'Absent');
  assert.equal(assumedTransaction(cell(undefined,{record:{status:'Absent'}}),'present'),null);
  assert.equal(assumedTransaction(cell(undefined,{context:{ready:true,holiday:'regular_holiday',restDay:false}}),'present'),null);
  assert.equal(assumedTransaction(cell(undefined,{context:{ready:false}}),'present'),null);
});
test('leave and AWOL preserve canonical attendance statuses without employee-status mutation',()=>{
  const paid=matrixInput(cell(),'Paid Leave'),unpaid=matrixInput(cell(),'Unpaid Leave'),awol=matrixInput(cell(),'AWOL/AWOP');
  assert.equal(paid.status,'Approved Leave');assert.equal(paid.leaveTreatment,'Paid');assert.equal(unpaid.leaveTreatment,'Unpaid');assert.equal(awol.status,'Absent');assert.equal(awol.segments.length,0);
});
test('split duties derive late and undertime from actual segments and unpaid breaks',()=>{
  const actual=[{start:495,end:710,breakMinutes:0},{start:790,end:1000,breakMinutes:10}];
  const m=dutyMetrics(duties,actual);assert.deepEqual(m,{scheduledMinutes:480,workedMinutes:415,lateMinutes:25,undertimeMinutes:40});
  assert.throws(()=>dutyMetrics(duties,[{start:500,end:490,breakMinutes:0}]));
  assert.throws(()=>dutyMetrics([{start:0,end:1440,breakMinutes:0},{start:1440,end:1500,breakMinutes:0}],duties),/24 hours/);
});
test('bulk time editing rejects incompatible schedules and locked/unreviewed cells',()=>{
  const other=cell('2024-01-03',{context:{ready:true,holiday:'ordinary',restDay:false,segments:[{start:540,end:1080,breakMinutes:60}]}});
  assert.throws(()=>compatibleTimeInputs([cell(),other],duties),/identical/);
  assert.throws(()=>matrixInput(cell(undefined,{posted:true}),'Present'),/Posted/);
  assert.throws(()=>matrixInput(cell(undefined,{context:{ready:false}}),'Present'),/Review/);
});
test('holiday/rest duty classification is single and calendar-validated, not Sunday-derived',()=>{
  assert.equal(dayClassification('special_working',false),'ordinary');assert.equal(dayClassification('regular_holiday',true),'regular_holiday_rest_day');
  const h=cell(undefined,{context:{ready:true,hash:'h',holiday:'regular_holiday',restDay:true,segments:duties}});
  assert.throws(()=>matrixInput(h,'Present'));assert.throws(()=>matrixInput(h,'Regular Holiday Duty'));
  assert.equal(matrixInput(h,'Regular Holiday + Rest-day Duty').status,'Present');
  assert.equal(matrixInput(h,'Holiday (Unworked)').status,'Rest Day / Holiday');
  assert.throws(()=>matrixInput(cell(),'Day-off'));assert.throws(()=>matrixInput(cell(),'Holiday (Unworked)'));
});
