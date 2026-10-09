import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEmployment,employmentValidation,EMPLOYMENT_TYPES,STATUS_REASONS,isSeparated,REVIEW_TYPE} from '../../js/core/employment.js';
test('employment type is independent from hire date and operational status',()=>{
  assert.equal(normalizeEmployment({status:'Active',dateHired:'2010-01-01',classOverride:'Auto'}).employmentType,REVIEW_TYPE);
  for(const employmentType of EMPLOYMENT_TYPES)assert.equal(normalizeEmployment({status:'Active',employmentType}).employmentType,employmentType);
});
test('legacy AWOL remains pending review, not a legal separation',()=>{
  const row=normalizeEmployment({status:'AWOL',dateHired:'2020-01-01'});
  assert.equal(row.status,'Inactive');assert.equal(row.statusReason,'AWOL (Pending Review)');assert.equal(row.legacyEmploymentStatus,'AWOL');assert.equal(isSeparated(row),false);
});
test('legacy hires and transfers remain active, resignations separated',()=>{
  assert.equal(normalizeEmployment({status:'Newly Hired'}).status,'Active');
  assert.equal(normalizeEmployment({status:'Transferred to Another Department'}).status,'Active');
  assert.equal(normalizeEmployment({status:'Resigned'}).statusReason,'Resigned');
  assert.equal(normalizeEmployment({status:'Returned to Agency'}).status,'Inactive');
});
test('blank effective date stays blank and dependent reason validation is strict',()=>{
  const row=normalizeEmployment({status:'Active',dateHired:'2020-01-01',employmentType:'Casual'});
  assert.equal(row.statusDate,'');assert.equal(employmentValidation(row),'');
  assert.match(employmentValidation({...row,status:'Separated'}),/Status Reason/);
  assert.match(employmentValidation({...row,status:'Inactive',statusReason:STATUS_REASONS.Inactive[0]}),/Effective Date/);
});
test('normalization is idempotent and retains legacy snapshots',()=>{
  const row=normalizeEmployment({status:'AWOL',classOverride:'Regular',employmentHistory:[{to:'AWOL'}]});
  assert.deepEqual(normalizeEmployment(row),row);assert.equal(row.employmentHistory[0].to,'AWOL');assert.equal(row.employmentType,'Regular / Permanent');
});
