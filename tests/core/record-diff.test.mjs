import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordChanges, valuesEqual } from '../../js/core/record-diff.js';

test('returns only inserted and updated records', () => {
  const previous = { employees: [{ id: '1', name: 'Ana' }, { id: '2', name: 'Ben' }] };
  const current = { employees: [{ id: '1', name: 'Ana' }, { id: '2', name: 'Benjamin' }, { id: '3', name: 'Cara' }] };
  const result = buildRecordChanges(previous, current, ['employees']);

  assert.deepEqual(result.upserts.map(change => change.recordId), ['2', '3']);
  assert.deepEqual(result.deletes, []);
});

test('returns deleted records without rewriting unchanged modules', () => {
  const previous = { employees: [{ id: '1' }], leaves: [{ id: 'leave-1', status: 'Pending' }] };
  const current = { employees: [], leaves: [{ id: 'leave-1', status: 'Pending' }] };
  const result = buildRecordChanges(previous, current, ['employees', 'leaves']);

  assert.deepEqual(result.upserts, []);
  assert.deepEqual(result.deletes, [{ module: 'employees', recordId: '1' }]);
});

test('compares settings values structurally', () => {
  assert.equal(valuesEqual({ provider: 'supabase' }, { provider: 'supabase' }), true);
  assert.equal(valuesEqual({ provider: 'supabase' }, { provider: 'google-drive' }), false);
});
