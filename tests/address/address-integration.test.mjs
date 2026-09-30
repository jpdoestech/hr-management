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

test('address forms are optional and same-as-home remains a live disabled mirror',()=>{
  assert.doesNotMatch(app,/readAddressComponent\('(emp|ss|hire)_(home|present)',\{required:true\}\)/);
  const component=readFileSync(new URL('../../js/address/address-component.js',import.meta.url),'utf8');
  assert.match(component,/copyFrom===sourcePrefix/);
  assert.match(component,/input\.disabled=mirrored/);
  assert.match(component,/loadBarangaySearchIndex/);
  assert.match(component,/Selecting a result fills its parent locations automatically/);
});
