import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOrganizationImport} from '../../js/core/organization-import.js';
test('organization import accepts department-only and linked positions, preserving duplicate rows for server summary',()=>{
  assert.deepEqual(parseOrganizationImport([['Department','Position'],[' Production  ','Operator'],['production','operator'],['HR',''],['','']]),[{department:'Production',position:'Operator'},{department:'production',position:'operator'},{department:'HR',position:''}]);
  assert.deepEqual(parseOrganizationImport([['department'],['HR']]),[{department:'HR',position:''}]);
});
test('organization import rejects missing departments, long names, empty and oversized files',()=>{
  for(const matrix of [[],[['Position'],['Operator']],[['Department','Position'],['','Operator']],[['Department'],['x'.repeat(61)]],[['Department']]])assert.throws(()=>parseOrganizationImport(matrix));
  assert.throws(()=>parseOrganizationImport(Array.from({length:2002},()=>['Department'])));
});
