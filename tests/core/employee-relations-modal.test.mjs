import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const styles=await readFile(new URL('../../css/professional.css',import.meta.url),'utf8');
const migration=await readFile(new URL('../../supabase/phase22-hr-case-attachments.sql',import.meta.url),'utf8');

test('profile-originated HR cases retain the selected employee',()=>{
  assert.match(source,/openCaseForm\('',emp\.id\)/);
  assert.match(source,/id="case_employee_locked"/);
  assert.match(source,/employeePickerSelected\('case_employee'\)\|\|DB\.employees\.find/);
  assert.match(source,/const title=existing\?'Edit HR Case':'New HR Case'/);
  assert.match(source,/Employee Information[\s\S]*employeeDisplayName\(lockedEmployee\)/);
});

test('HR cases support managed primary file uploads and cleanup',()=>{
  assert.match(source,/key:'caseAttachment'[\s\S]*storagePrefix:'cases'/);
  assert.match(source,/attachment_name:attachmentName\|\|null/);
  assert.match(source,/attachment_ref:attachmentRef\|\|null/);
  assert.match(source,/if\(caseRec\?\.attachment_ref\)await deleteStorageObjects/);
  assert.match(migration,/add column if not exists attachment_name text/);
  assert.match(migration,/add column if not exists attachment_ref text/);
});

test('Employee Relations entry dialogs share a responsive modal shell',()=>{
  assert.match(source,/data-employee-relations-modal/);
  assert.match(source,/classList\.toggle\('relations-modal'/);
  assert.match(source,/classList\.toggle\('entry-modal'/);
  assert.match(styles,/\.modal\.relations-modal\{/);
  assert.match(styles,/\.relations-modal\.entry-modal \.formgrid/);
  assert.match(styles,/@media\(max-width:720px\)[\s\S]*\.modal\.relations-modal/);
});
