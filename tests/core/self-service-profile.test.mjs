import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const start=source.indexOf('function renderSelfService()');
const end=source.indexOf('\nfunction openProfileChangeRequest()',start);
const renderSource=source.slice(start,end);

test('employee self-service exposes the complete employee master profile',()=>{
  for(const field of [
    'employeeNo','prfNumber','position','department','branchReporting','dateHired','statusDate',
    'lastName','firstName','middleName','birthDate','gender','civilStatus','mobileNumber','personalEmail',
    'homeAddress','presentAddress','tin','sssNumber','philHealthNumber','pagIbigNumber','dailyRate',
    'emergencyContactName','emergencyContactRelationship','emergencyContactPhone','remarks'
  ]) assert.match(renderSource,new RegExp(`employee\\.${field}\\b`),`${field} must appear in self-service`);
  assert.match(renderSource,/employeeAllowanceEntries\(employee\)/,'configured allowances must appear in self-service');
});

test('employee self-service does not expose disciplinary or case modules',()=>{
  for(const moduleName of ['nte','disciplinary','incidents','cvr','nod','memos','atd','hr_cases']){
    assert.doesNotMatch(renderSource,new RegExp(`DB\\.${moduleName}\\b`),`${moduleName} must remain outside self-service`);
  }
});
