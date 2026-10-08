import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {employeeNumberSequence,isValidEmployeeNumber,nextEmployeeNumber,normalizeEmployeeNumber} from '../../js/core/employee-number.js';

const migration=fs.readFileSync(new URL('../../supabase/migrations/0030_employee_number_six_digits.sql',import.meta.url),'utf8');

test('normalizes legacy and spreadsheet employee numbers to six digits',()=>{
  assert.equal(normalizeEmployeeNumber('EMP-1'),'EMP-000001');
  assert.equal(normalizeEmployeeNumber('emp_0042'),'EMP-000042');
  assert.equal(normalizeEmployeeNumber('315'),'EMP-000315');
});

test('validates only canonical six-digit employee numbers',()=>{
  assert.equal(isValidEmployeeNumber('EMP-000001'),true);
  assert.equal(isValidEmployeeNumber('EMP-000000'),false);
  assert.equal(isValidEmployeeNumber('EMP-0001'),false);
  assert.equal(isValidEmployeeNumber('000001'),false);
  assert.equal(employeeNumberSequence('EMP-999999'),999999);
});

test('generates the next number from legacy and canonical records',()=>{
  assert.equal(nextEmployeeNumber([{employeeNo:'EMP-9'},{employeeNo:'EMP-000042'},{employeeNo:'invalid'}]),'EMP-000043');
  assert.equal(nextEmployeeNumber([]),'EMP-000001');
});

test('fails explicitly when the six-digit sequence is exhausted',()=>{
  assert.throws(()=>nextEmployeeNumber([{employeeNo:'EMP-999999'}]),/sequence is exhausted/);
});

test('database migration normalizes and enforces unique six-digit employee numbers',()=>{
  assert.match(migration,/^\s*--[^]*\bbegin;/i);
  assert.match(migration,/jsonb_set\(data,'\{employeeNo\}'/);
  assert.match(migration,/create unique index if not exists hr_records_employee_number_unique_idx/i);
  assert.match(migration,/\^EMP-\[0-9\]\{6\}\$/);
  assert.match(migration,/commit;\s*$/i);
});
