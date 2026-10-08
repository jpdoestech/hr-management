import test from 'node:test';
import assert from 'node:assert/strict';
import {paginationHTML} from '../../js/core/pagination.js';

test('pagination can expose a bounded set of page sizes',()=>{
  const html=paginationHTML({page:1,pages:4,size:10,total:186},'records:employees',{go:'serverTablePageGo',size:'serverTablePageSize',sizes:[10,25,50]});
  assert.match(html,/>10<\/option>/);
  assert.match(html,/>25<\/option>/);
  assert.match(html,/>50<\/option>/);
  assert.doesNotMatch(html,/>100<\/option>/);
  assert.doesNotMatch(html,/>All<\/option>/);
});
