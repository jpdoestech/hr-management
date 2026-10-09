import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/proposals/0036_manpower_submission.sql',import.meta.url),'utf8');
test('submission proposal reuses locked draft validation and existing permissions',()=>{
  assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(active_tenant::text\|\|':draft:'\|\|p_id,0\)\)/);
  assert.match(sql,/previous.revision<>p_expected_revision/);
  assert.match(sql,/current_user_has_permission\('manpower.update'\)/);
  assert.match(sql,/public.save_manpower_draft\(p_id,p_expected_revision,header,lines\)/);
  assert.match(sql,/Verified cross-model PRF registry is required/);
});
test('submitted quantity baseline and typed history reference the existing audit timeline',()=>{
  assert.match(sql,/set original_requested=current_authorized/);
  assert.match(sql,/audit_id uuid not null references public.hr_audit_logs\(id\)/);
  assert.match(sql,/Original submitted headcount is immutable/);
  assert.match(sql,/Quantity history is append-only/);
  assert.match(sql,/Submitted requisition lines cannot be replaced or deleted/);
  assert.match(sql,/enable row level security/);
  assert.doesNotMatch(sql,/insert into public\.(?:hr_records|hr_manpower_slots|hr_manpower_reservations)/);
});
