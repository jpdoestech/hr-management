import test from 'node:test';
import assert from 'node:assert/strict';
import {employeeDirectoryProjection} from '../../js/core/employee-directory.js';

test('employee directory requests only visible columns and their dependencies',()=>{
  assert.deepEqual(employeeDirectoryProjection([
    {key:'employeeNo'},
    {key:'name'},
    {key:'department'},
  ]),['id','employeeNo','name','lastName','firstName','middleName','department']);
});

test('hidden employee details are excluded until selected',()=>{
  const fields=employeeDirectoryProjection(['employeeNo','name','position']);
  ['address','homeAddress','presentAddress','mobileNumber','personalEmail','dailyRate','allowances','tin','sssNumber'].forEach(field=>assert.equal(fields.includes(field),false,`${field} should remain unloaded`));
});

test('computed and grouped columns request only the fields they need',()=>{
  assert.deepEqual(employeeDirectoryProjection(['classification']),['id','dateHired','classOverride']);
  assert.deepEqual(employeeDirectoryProjection(['address']),['id','homeAddress','address']);
  assert.deepEqual(employeeDirectoryProjection(['presentAddress']),['id','presentAddress','presentAddressText']);
  assert.deepEqual(employeeDirectoryProjection(['allowance:meal']),['id','allowances']);
});
