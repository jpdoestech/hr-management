import test from 'node:test';
import assert from 'node:assert/strict';
import { roleCanExport } from '../../js/core/export-access.js';

test('administrators and HR staff can export by role', () => {
  assert.equal(roleCanExport('Administrator'), true);
  assert.equal(roleCanExport('HR Staff'), true);
});

test('viewer export is denied unless explicitly enabled', () => {
  assert.equal(roleCanExport('Viewer'), false);
  assert.equal(roleCanExport('Viewer', true), true);
});

test('other read-oriented accounts require explicit export access', () => {
  assert.equal(roleCanExport('Manager'), false);
  assert.equal(roleCanExport('Employee'), false);
  assert.equal(roleCanExport('Manager', true), true);
});
