import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../../supabase/migrations/0026_employee_relations_evidence.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');

test('Phase 29 evidence migration is additive, transaction-wrapped, scoped, and permission protected',()=>{
  assert.match(migration,/create table if not exists public\.hr_case_evidence/);
  assert.match(migration,/protect_case_evidence_identity/);
  assert.match(migration,/current_user_has_permission\('employee_relations\.view'\)/);
  assert.match(migration,/current_user_scope_allows/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_/i);
});

test('case workspace provides a managed evidence register without deleting evidence',()=>{
  for(const contract of ['ensureCaseEvidenceReady','caseEvidenceWorkspaceHTML','openCaseEvidenceForm','saveCaseEvidence','Investigation Evidence'])assert.match(app,new RegExp(contract));
  assert.match(app,/authorization_details/);
  assert.doesNotMatch(app,/async function deleteCaseEvidence/);
});

test('evidence attachments use the configured managed upload path',()=>{
  assert.match(app,/key:'caseEvidenceAttachment'/);
  assert.match(app,/storagePrefix:'cases'/);
  assert.match(app,/rememberCommittedRecordFiles\(\{caseEvidenceAttachmentData:attachmentRef\}\)/);
});
