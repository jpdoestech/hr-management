import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const contextStart=source.indexOf('function opsEmployeeContextHTML(employee){');
const contextEnd=source.indexOf('\nfunction opsSelectEmployee()',contextStart);
const contextSource=source.slice(contextStart,contextEnd);
const renderStart=source.indexOf('function renderOperationsWorkspace(){');
const renderEnd=source.indexOf('\nconst NAV = [',renderStart);
const renderSource=source.slice(renderStart,renderEnd);
const selectStart=source.indexOf('function opsSelectEmployee(){');
const selectEnd=source.indexOf('\nfunction opsOpenSelectedTransaction()',selectStart);
const selectSource=source.slice(selectStart,selectEnd);

test('HR Operations uses focused tabs instead of rendering the employee directory again',()=>{
  assert.match(renderSource,/ops-lite-tabs/);
  assert.match(renderSource,/employeePickerHTML/);
  assert.match(contextSource,/ops-transaction-select/);
  assert.doesNotMatch(renderSource,/supabase\./);
  assert.doesNotMatch(renderSource,/ops-directory-table/);
  assert.doesNotMatch(renderSource,/Employee Work History/);
  assert.doesNotMatch(renderSource,/<table/);
});

test('selecting an Operations employee updates only the context region',()=>{
  assert.match(selectSource,/getElementById\('ops-employee-context'\)/);
  assert.match(selectSource,/target\.innerHTML=opsEmployeeContextHTML\(employee\)/);
  assert.doesNotMatch(selectSource,/renderOperationsWorkspace\(/);
});

test('HR Operations exposes a dedicated work-queue view',()=>{
  for(const label of ['Workflow & Approvals','Pending Leave','Open NTE','Overdue Evaluations','Outstanding ATD','Lifecycle Tasks']){
    assert.match(renderSource,new RegExp(label.replace(/[&]/g,'\\&')));
  }
});
