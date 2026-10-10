import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/proposals/0058_manpower_header_amendments.sql',import.meta.url),'utf8');
test('header proposal preserves controlled writes and existing cross-model registry',()=>{
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/for update/);assert.match(sql,/previous\.revision<>p_expected_revision/);
  assert.match(sql,/insert into public\.hr_manpower_amendment_intents/);assert.match(sql,/can_read_manpower_draft/);
  assert.match(sql,/manpower\.update/);assert.match(sql,/manpower_prf_number_guard/);
  assert.doesNotMatch(sql,/create or replace function public\.guard_manpower_submitted_record|update public\.hr_manpower_lines|delete from public\.hr_records|disable row level security/i);
});
test('header history is scoped append-only audit evidence and anonymous mutation is revoked',()=>{
  assert.match(sql,/enable row level security/);assert.match(sql,/tenant_id=public\.current_tenant_id\(\) and public\.can_read_manpower_draft\(request_id\)/);
  assert.match(sql,/before update or delete/);assert.match(sql,/before_header jsonb/);assert.match(sql,/after_header jsonb/);
  assert.match(sql,/references public\.hr_audit_logs/);assert.match(sql,/revoke all on function public\.amend_manpower_header\(text,bigint,jsonb,text\) from public,anon/);
});
