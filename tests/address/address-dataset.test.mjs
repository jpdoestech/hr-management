import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dataUrl=new URL('../../assets/data/philippine-address/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,dataUrl),'utf8'));

test('authoritative address data has a complete linked hierarchy',()=>{
  const regions=read('regions.json');
  const provinces=read('provinces.json');
  const cities=read('cities.json');
  const city=cities.find(row=>row.code==='1102401000');
  const barangays=read(`barangays/${city.code}.json`);
  assert.ok(regions.some(row=>row.code===city.regionCode));
  assert.ok(provinces.some(row=>row.code===city.provinceCode&&row.regionCode===city.regionCode));
  assert.ok(barangays.length>0);
  assert.ok(barangays.every(row=>row.code&&row.name));
});
