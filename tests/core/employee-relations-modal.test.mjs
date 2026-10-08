import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const styles=await readFile(new URL('../../css/professional.css',import.meta.url),'utf8');
const migration=await readFile(new URL('../../supabase/migrations/0019_hr_case_attachments.sql',import.meta.url),'utf8');

test('profile-originated HR cases retain the selected employee',()=>{
  assert.match(source,/openCaseIntakeForm\('',emp\.id\)/);
  assert.match(source,/id="intake_employee_locked"/);
  assert.match(source,/id="case_employee_locked"/);
  assert.match(source,/employeePickerSelected\('case_employee'\)\|\|DB\.employees\.find/);
  assert.match(source,/const title=existing\?'Edit HR Case':'New HR Case'/);
  assert.match(source,/Employee Information[\s\S]*employeeDisplayName\(lockedEmployee\)/);
});

test('Employee Relations uses intake-first navigation and stage-guided actions',()=>{
  assert.match(source,/1\. Intake &amp; Triggers/);
  assert.match(source,/2\. Active Case Files/);
  assert.match(source,/3\. History &amp; Ledger/);
  assert.match(source,/function employeeRelationsProcessHTML\(/);
  assert.match(source,/function caseGuidedActionsHTML\(/);
  assert.match(source,/Start with a report or intake record/);
  assert.match(source,/Validate &amp; Advance/);
  assert.match(styles,/\.er-process-map\{/);
  assert.match(styles,/\.case-guided-actions\{/);
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

test('long shared record forms use responsive classified tabs',()=>{
  assert.match(source,/function modalFormTabsHTML\(groupId,tabs/);
  assert.match(source,/function switchModalFormTab\(groupId,tabId\)/);
  assert.match(source,/label:'Governing Policy'/);
  assert.match(source,/label:'Files & Notes'/);
  assert.match(source,/modalFormTabsHTML\('record_form_tabs'/);
  assert.match(styles,/\.modal-form-tablist/);
  assert.match(styles,/\.modal-form-panel\[hidden\]/);
  assert.match(styles,/\.modal-form-tabs\{[^}]*height:min\(620px,calc\(100dvh - 162px\)\)/);
  assert.match(styles,/\.modal-form-panels\{[^}]*scrollbar-gutter:stable/);
  assert.match(styles,/@media\(max-width:720px\)[\s\S]*\.modal-form-tabs\{height:calc\(100dvh - 134px\)/);
});

test('case details use a stable-height, stage-focused command center',()=>{
  assert.match(source,/modalFormTabsHTML\('case_workspace_tabs'/);
  assert.match(source,/label:'Overview'/);
  assert.match(source,/label:'Allegations & Findings'/);
  assert.match(source,/label:'Investigation'/);
  assert.match(source,/label:'Notice & Response'/);
  assert.match(source,/label:'Decision & Action'/);
  assert.match(source,/label:'Records & Activity'/);
  assert.match(source,/caseWorkflowSteps\(caseRec,readiness,monitoring\.implementations/);
  assert.match(styles,/\.relations-modal\.case-modal>\.modal-body\.case-command-center/);
  assert.match(styles,/\.case-command-center>\.modal-form-tabs\{[^}]*flex:1/);
});

test('incident entry separates facts, policy, and evidence without editable assignment data',()=>{
  const form=source.slice(source.indexOf('function openIncidentForm'),source.indexOf('async function saveIncident'));
  assert.match(form,/label:'Classification & Facts'/);
  assert.match(form,/label:'Governing Policy'/);
  assert.match(form,/label:'Evidence & Notes'/);
  assert.match(form,/id="in_department"[\s\S]{0,180}readonly/);
  assert.match(source,/function incidentClassificationOptions\(extra=\[\]\)/);
  assert.match(source,/Classifications describe what happened/);
  assert.match(source,/#in_type_options input\[type=checkbox\]:checked/);
  assert.match(styles,/\.incident-classification-options/);
});
