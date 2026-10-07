import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDisciplinaryRemarks,
  filterTdaRecords,
  parseTdaMatrix,
  selectApplicableTdaRecord,
  tdaDuplicateKey,
} from '../../js/core/tda-import.js';

const headers = ['NO.','OFFENSES TYPE','DISCIPLINARY REMARKS','OFFENSES REMARKS','1st','2nd','3rd','4th','5th'];

test('parses the Industrial TDA shape and all five consequences', () => {
  const result = parseTdaMatrix([
    headers,
    [1,'PERFORMANCE','','Habitual tardiness','Warning','Reprimand','3 days suspension','7 days suspension','Dismissal'],
  ], {tdaType:'Industrial',allClients:true,allDepartments:false,departments:['PRODUCTION']});
  assert.deepEqual(result.fileErrors, []);
  assert.equal(result.rows[0].values.consequence5, 'Dismissal');
  assert.equal(result.rows[0].values.tdaType, 'Industrial');
  assert.deepEqual(result.rows[0].values.departments, ['PRODUCTION']);
});

test('derives disciplinary classification instead of trusting workbook formulas', () => {
  assert.equal(deriveDisciplinaryRemarks('Behaviour/ Conduct','Dismissal'),'GRIEVANCE/BEHAVIOUR/ CONDUCT');
  assert.equal(deriveDisciplinaryRemarks('Performance','Warning'),'PERFORMANCE');
});

test('reports missing workbook columns and duplicate offenses', () => {
  const missing = parseTdaMatrix([['NO.','OFFENSES TYPE']], {tdaType:'Industrial'});
  assert.ok(missing.fileErrors.some(error => error.includes('OFFENSES REMARKS')));
  const duplicate = parseTdaMatrix([
    headers,
    [1,'PERFORMANCE','','Same offense','Warning','','','',''],
    [2,'PERFORMANCE','','Same offense','Warning','','','',''],
  ], {tdaType:'Industrial'});
  assert.ok(duplicate.rows[1].errors.some(error => error.includes('Duplicate offense')));
});

test('duplicate identity includes catalog applicability scope', () => {
  const base={tdaType:'Industrial',offense:'Negligence',allClients:true,allBranches:true,allDepartments:false};
  assert.notEqual(
    tdaDuplicateKey({...base,departments:['PRODUCTION']}),
    tdaDuplicateKey({...base,departments:['WAREHOUSE']}),
  );
});

test('selects the most specific applicable TDA record', () => {
  const records=[
    {offense:'Negligence',tdaType:'Industrial',allClients:true,allBranches:true,allDepartments:true,active:true},
    {offense:'Negligence',tdaType:'Industrial',allClients:true,allBranches:true,allDepartments:false,departments:['PRODUCTION'],active:true},
  ];
  assert.equal(selectApplicableTdaRecord(records,'Negligence',{tdaType:'Industrial',department:'PRODUCTION'}),records[1]);
  assert.equal(selectApplicableTdaRecord(records,'Negligence',{tdaType:'Industrial',department:'SALES'}),records[0]);
});

test('searches TDA records by code, offense, category, type, scope, and consequence', () => {
  const records=[
    {id:'a',offenseNumber:'17',offense:'Failure to wear PPE',category:'SAFETY',tdaType:'Industrial',departments:['PRODUCTION'],consequence1:'Written warning',active:true},
    {id:'b',offenseNumber:'22',offense:'Unauthorized absence',category:'ATTENDANCE',tdaType:'Office',departments:['ADMIN'],consequence1:'Reprimand',active:true},
    {id:'c',offenseNumber:'30',offense:'Inactive rule',category:'SAFETY',active:false},
  ];
  assert.deepEqual(filterTdaRecords(records,'17').map(record=>record.id),['a']);
  assert.deepEqual(filterTdaRecords(records,'ppe').map(record=>record.id),['a']);
  assert.deepEqual(filterTdaRecords(records,'attendance').map(record=>record.id),['b']);
  assert.deepEqual(filterTdaRecords(records,'production').map(record=>record.id),['a']);
  assert.deepEqual(filterTdaRecords(records,'written warning').map(record=>record.id),['a']);
  assert.deepEqual(filterTdaRecords(records,'safety').map(record=>record.id),['a']);
});
