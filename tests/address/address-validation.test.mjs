import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAddressChildren, formatPhilippineAddress, normalizeAddress } from '../../js/address/address-models.js';
import { validatePhilippineAddress } from '../../js/address/address-validation.js';
import { barangays, index, validAddress } from './fixtures.mjs';

test('accepts a valid dataset-backed address and formats it',()=>{
  const result=validatePhilippineAddress(validAddress,{index,barangays,required:true});
  assert.equal(result.valid,true);
  assert.match(formatPhilippineAddress(result.address),/Davao City/);
});

test('rejects an unknown manually typed administrative location',()=>{
  const result=validatePhilippineAddress({...validAddress,barangayCode:'',barangayName:'Imaginary Barangay'},{index,barangays,required:true});
  assert.equal(result.valid,false);
  assert.match(result.errors.barangay,/valid barangay/i);
});

test('changing a parent clears incompatible children',()=>{
  const changed=clearAddressChildren(validAddress,'province');
  assert.equal(changed.regionCode,validAddress.regionCode);
  assert.equal(changed.provinceCode,validAddress.provinceCode);
  assert.equal(changed.cityCode,'');
  assert.equal(changed.barangayCode,'');
  assert.equal(changed.zipCode,'');
});

test('loads an existing structured or legacy address safely',()=>{
  assert.deepEqual(normalizeAddress(validAddress).cityCode,validAddress.cityCode);
  const legacy=normalizeAddress(null,'Old saved address');
  assert.equal(legacy.addressLine,'Old saved address');
  assert.equal(legacy.legacy,true);
});
