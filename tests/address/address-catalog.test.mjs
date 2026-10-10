import test from 'node:test';
import assert from 'node:assert/strict';
import {readPhilippineAddressCatalog,addressCatalogSeedSQL} from '../../scripts/lib/philippine-address-catalog.mjs';

test('backend projection validates the complete authoritative hierarchy without source edits',()=>{
  const catalog=readPhilippineAddressCatalog(),byCode=new Map(catalog.rows.map(row=>[row.code,row]));
  assert.deepEqual(catalog.counts,{region:18,province:82,city:1642,barangay:42011});
  for(const row of catalog.rows){
    if(row.kind==='region')assert.equal(row.parent_code,null);
    else assert.ok(byCode.has(row.parent_code));
  }
  assert.equal(catalog.sha256,readPhilippineAddressCatalog().sha256);
  assert.equal(byCode.get('1130700002').name,'Agdao');
  const sql=addressCatalogSeedSQL(catalog);
  assert.ok(sql.includes("set local standard_conforming_strings=on;"));
  assert.ok(sql.includes(catalog.sha256));
  assert.ok(!/truncate|drop table|on conflict/i.test(sql));
});

test('derived SQL escapes apostrophes and retains reference names and codes',()=>{
  const sql=addressCatalogSeedSQL({rows:[{code:'0000000001',kind:'region',parent_code:null,name:"Reference O'Brien",zip:''}],sha256:'a'.repeat(64),counts:{region:1}});
  assert.ok(sql.includes("O''Brien"));assert.ok(sql.includes('0000000001'));
});
