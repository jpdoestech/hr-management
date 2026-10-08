import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sql=await readFile(new URL('../../supabase/migrations/0017_access_control.sql',import.meta.url),'utf8');
const app=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');

test('Phase 20 defines tenant roles, overrides, scopes, and assignments',()=>{
  for(const table of ['access_roles','access_role_permissions','access_user_roles','access_user_overrides','access_user_scopes','access_resource_assignments'])assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql,/tenant_id uuid not null references public\.hr_tenants/);
});

test('effective access gives direct deny precedence and superadmin bypass',()=>{
  const deny=sql.indexOf("effect='deny'");
  const grant=sql.indexOf("effect='grant'");
  assert.ok(deny>0&&grant>deny);
  assert.match(sql,/when target\.is_super_admin then true when deny\.permission_key is not null then false/);
});

test('HR records enforce permissions and scopes in RLS',()=>{
  assert.match(sql,/current_user_has_permission\(public\.hr_record_permission_key\(module,'view'\)\)/);
  assert.match(sql,/current_user_scope_allows\(record_id,data\)/);
  assert.match(sql,/scope\.scope_type='branch'/);
  assert.match(sql,/scope\.scope_type='department'/);
});

test('password recovery and account security remain email-owned',()=>{
  assert.match(html,/id="recovery-form"/);
  assert.match(html,/id="new-password-form"/);
  assert.match(app,/resetPasswordForEmail/);
  assert.match(app,/supabase\.auth\.updateUser\(\{email\}/);
  assert.match(app,/Administrators never see or set your password/);
});
