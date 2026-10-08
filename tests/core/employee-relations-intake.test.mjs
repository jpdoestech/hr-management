import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isCaseReportSource} from '../../js/core/employee-relations.js';

const migration=await readFile(new URL('../../supabase/phase30-employee-relations-intake.sql',import.meta.url),'utf8');
const migrationCopy=await readFile(new URL('../../database/migrations/phase30-employee-relations-intake.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');

test('general intake is an allegation source but never a confirmed outcome',()=>{
  assert.equal(isCaseReportSource('intake'),true);
  assert.match(app,/Reports & Intake/);
  assert.match(app,/creates an allegation, not a confirmed violation/i);
});

test('Phase 30 is additive, mirrored, tenant scoped, and permission protected',()=>{
  assert.equal(migration,migrationCopy);
  assert.match(migration,/create table if not exists public\.hr_case_intake/);
  assert.match(migration,/validate_case_intake_link/);
  assert.match(migration,/source_module in \('incidents','cvr','intake'\)/);
  assert.match(migration,/current_user_has_permission\('employee_relations\.view'\)/);
  assert.match(migration,/current_user_scope_allows/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});

test('intake UI preserves search, filtering, pagination, employee selection, and managed upload',()=>{
  for(const contract of ['renderCaseIntake','openCaseIntakeForm','saveCaseIntake','openCaseIntakeDisposition','linkCaseIntakeToExisting','createCaseFromIntake'])assert.match(app,new RegExp(contract));
  assert.match(app,/employeePickerHTML\(\{id:'intake_employee'/);
  assert.match(app,/data-page-scope="case-intake:list"/);
  assert.match(app,/key:'caseIntakeAttachment'/);
});

test('intake reports participate in analytics without becoming confirmed findings',()=>{
  assert.match(app,/reports:\[\.\.\.incidentRows,\.\.\.cvrRows,\.\.\.intakeRows\]/);
  assert.match(app,/Incident, CVR, and intake reports; not confirmed findings/);
  assert.match(app,/\['Reports & Intake',intakeRows\.length\]/);
});
