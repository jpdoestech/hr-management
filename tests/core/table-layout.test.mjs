import test from 'node:test';
import assert from 'node:assert/strict';
import { columnKey, moveColumn, normalizeFrozenColumns, reconcileColumnOrder } from '../../js/core/table-layout.js';

test('column keys are stable and readable',()=>{
  assert.equal(columnKey('Date Hired',3),'date-hired-3');
});

test('saved order is reconciled with newly available columns',()=>{
  assert.deepEqual(reconcileColumnOrder(['employeeNo','name','department'],['name','missing','employeeNo']),['name','employeeNo','department']);
});

test('columns can be moved before a target',()=>{
  assert.deepEqual(moveColumn(['employeeNo','name','dateHired'],'dateHired','name'),['employeeNo','dateHired','name']);
});

test('frozen columns discard unavailable and duplicate values',()=>{
  assert.deepEqual(normalizeFrozenColumns(['name','department'],['name','missing','name']),['name']);
});
