import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAddressRows } from '../../js/address/address-index.js';
import { index } from './fixtures.mjs';

test('parent selections filter provinces and cities',()=>{
  assert.deepEqual(index.provincesForRegion('1100000000').map(row=>row.name),['Davao del Sur']);
  assert.deepEqual(index.citiesForProvince('1102400000').map(row=>row.name),['Davao City']);
  assert.deepEqual(index.citiesForProvince('','1300000000').map(row=>row.name),['City of Makati']);
});

test('search supports normalized partial typing',()=>{
  assert.equal(searchAddressRows(index.regions,'davao')[0].code,'1100000000');
  assert.equal(searchAddressRows(index.cities,'mak')[0].name,'City of Makati');
});

test('province and city searches can start without parent selections',()=>{
  assert.equal(index.searchProvinces('','davao')[0].name,'Davao del Sur');
  assert.equal(index.searchCities('','','makati')[0].name,'City of Makati');
  assert.deepEqual(index.citiesForRegion('1100000000').map(row=>row.name),['Davao City']);
});
