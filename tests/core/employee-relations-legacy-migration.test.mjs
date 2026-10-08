import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../../supabase/migrations/0023_employee_relations_legacy_migration.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const reset=await readFile(new URL('../../supabase/maintenance/reset_hr_data_preserve_users.sql',import.meta.url),'utf8');

test('Phase 26 migration is additive, idempotent, and preserves legacy sources',()=>{
  assert.match(migration,/create table if not exists public\.hr_case_correspondence/);
  assert.match(migration,/add column if not exists source_snapshot jsonb/);
  assert.match(migration,/on conflict \(tenant_id,source_module,source_record_id\)/);
  assert.match(migration,/where module in \('disciplinary','memos'\)/);
  assert.match(migration,/Source rows, links, JSON, timestamps, and files remain unchanged/);
  assert.doesNotMatch(migration,/\btruncate\b/i);
  assert.doesNotMatch(migration,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.hr_records\b/i);
  assert.doesNotMatch(migration,/\bupdate\s+public\.hr_records\b/i);
});

test('automatic employee matching accepts a stable ID or one exact normalized name only',()=>{
  const matcher=migration.slice(migration.indexOf('legacy_er_employee_record_id'),migration.indexOf('legacy_er_linked_case_id'));
  assert.match(matcher,/employee\.record_id=supplied_id/);
  assert.match(matcher,/regexp_replace\(lower\(trim\(coalesce\(employee\.data->>'name',''\)\)\),'\\s\+',' ','g'\)=normalized_name/);
  assert.match(matcher,/case when match_count=1 then matched_id else null end/);
  assert.doesNotMatch(matcher,/similar|levenshtein|fuzzy|soundex/i);
});

test('legacy findings require controlled permission-aware review before occurrence counting',()=>{
  assert.match(migration,/p_review_action not in \('link','verify','reject'\)/);
  assert.match(migration,/case when p_review_action='link' then 'employee_relations\.manage' else 'employee_relations\.approve' end/);
  assert.match(migration,/perform set_config\('app\.legacy_history_review','allowed',true\)/);
  assert.match(migration,/verification_status=case when p_review_action='verify' then 'Verified'/);
  assert.match(migration,/coalesce\(max\(item\.confirmed_occurrence\),0\)\+1/);
  assert.match(migration,/item\.verification_status='Verified'/);
  assert.match(migration,/protect_legacy_disciplinary_history/);
  assert.match(migration,/Use the controlled legacy disciplinary review action/);
});

test('legacy correspondence remains a read-only projection with preserved attachments and links',()=>{
  assert.match(migration,/attachment_name text/);
  assert.match(migration,/attachment_ref text/);
  assert.match(migration,/source_snapshot jsonb not null/);
  assert.match(migration,/case_id uuid references public\.hr_cases\(id\) on delete set null/);
  assert.match(migration,/protect_legacy_correspondence_projection/);
  assert.doesNotMatch(migration,/create policy hr_case_correspondence_update/);
});

test('Phase E UI separates verified outcomes, legacy review, and correspondence',()=>{
  for(const feature of ['loadCaseCorrespondence','renderCorrespondence','openLegacyDisciplinaryReview','saveLegacyDisciplinaryReview','review_legacy_disciplinary_history','exportLegacyDisciplinaryHistoryCSV']){
    assert.match(app,new RegExp(feature));
  }
  const disciplinary=app.slice(app.indexOf('async function renderDisciplinary'),app.indexOf('CVR / VIOLATION REPORTS'));
  assert.match(disciplinary,/verification_status==='Verified'/);
  assert.match(disciplinary,/Historical label:[\s\S]{0,80}not counted/);
  assert.match(disciplinary,/Legacy Review/);
  assert.match(disciplinary,/source_snapshot/);
  const summary=app.slice(app.indexOf('async function renderOffenseSummary'),app.indexOf('WORKFLOW & APPROVAL CENTER'));
  assert.match(summary,/source_type==='legacy'&&record\.verification_status==='Legacy Unverified'/);
});

test('user-preserving reset clears normalized Employee Relations data in dependency order',()=>{
  const ordered=['hr_disciplinary_history','hr_case_correspondence','hr_case_responses','hr_case_hearings','hr_case_decisions','hr_case_allegations','hr_cases','hr_records'];
  ordered.reduce((previous,table)=>{
    const index=reset.indexOf(`'${table}'`);
    assert.ok(index>previous,`${table} must appear after its dependent tables`);
    return index;
  },-1);
  assert.doesNotMatch(reset,/delete from public\.profiles/i);
  assert.doesNotMatch(reset,/delete from auth\.users/i);
});
