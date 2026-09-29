import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');

test('shared address component is used by employee home and present address forms',()=>{
  for(const prefix of ['emp_home','emp_present']){
    assert.match(app,new RegExp(`addressComponentHTML\\(\\{prefix:'${prefix}'`));
  }
  assert.match(app,/readAddressComponent\('emp_home'/);
});

test('employee import preserves free-text addresses as legacy street details',()=>{
  assert.match(app,/employee\.homeAddress=normalizeAddress\(null,employee\.address\|\|''\)/);
  assert.match(app,/official Region through Barangay when the employee is next edited/);
});

test('employee self-service and onboarding conversion cannot bypass validation',()=>{
  for(const prefix of ['ss_home','ss_present','hire_home','hire_present']){
    assert.match(app,new RegExp(`readAddressComponent\\('${prefix}'`));
  }
});
