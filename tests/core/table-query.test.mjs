import test from 'node:test';
import assert from 'node:assert/strict';
import {compareTableValues,normalizeTableValue,valueMatchesFilter} from '../../js/core/table-query.js';

test('table values normalize whitespace',()=>{
  assert.equal(normalizeTableValue('  Dela   Cruz  '),'Dela Cruz');
});

test('table sorting handles text, numbers, and dates',()=>{
  assert.ok(compareTableValues('A','Z','asc')<0);
  assert.ok(compareTableValues('100','9','asc')>0);
  assert.ok(compareTableValues('Sep 1, 2026','Jan 1, 2026','desc')<0);
});

test('column filters use case-insensitive contains matching',()=>{
  assert.equal(valueMatchesFilter('Dela Cruz, Juan','cruz'),true);
  assert.equal(valueMatchesFilter('Production','sales'),false);
});
