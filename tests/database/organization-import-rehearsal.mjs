// Synthetic in-memory validation; no database server or production connection.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.HRIS_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
const tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',actor='00000000-0000-0000-0000-000000000011',client='00000000-0000-0000-0000-000000000021';
try{
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
    create function current_tenant_id() returns uuid language sql as $$select '${tenant}'::uuid$$;
    create function current_user_has_permission(text) returns boolean language sql as $$select current_setting('test.allowed',true)='yes'$$;
    create table hr_settings(tenant_id uuid,id text,data jsonb,updated_at timestamptz,updated_by uuid,primary key(tenant_id,id));
    create table profiles(id uuid,full_name text);insert into profiles values('${actor}','Synthetic manager');
    create table hr_audit_logs(tenant_id uuid,user_id uuid,user_name text,action text);
    create table hr_manpower_clients(id uuid,tenant_id uuid,name text,active boolean);
    insert into hr_manpower_clients values('${client}','${tenant}','Synthetic client',true),('00000000-0000-0000-0000-000000000022','${other}','Other client',true);
    grant usage on schema public,auth to authenticated;set test.allowed='yes';`);
  const access=readFileSync(new URL('../../supabase/migrations/0017_access_control.sql',import.meta.url),'utf8');
  await db.exec(access.slice(access.indexOf('create or replace function public.save_organization_structure(p_departments'),access.indexOf('comment on table public.access_roles')));
  await db.exec(readFileSync(new URL('../../supabase/migrations/0060_organization_import.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');
  const run=async(rows,id=null)=>(await db.query('select import_organization_structure($1,$2) result',[rows,id])).rows[0].result;
  const rows=[{department:'Production',position:'Operator'},{department:'production',position:'operator'},{department:'HR',position:''}];
  const result=await run(rows,client);assert.equal(result.departmentsAdded,2);assert.equal(result.positionsAdded,1);assert.equal(result.departmentsSkipped,1);assert.equal(result.positionsSkipped,1);
  assert.deepEqual(result.settings.departments[0].clientIds,[client]);
  const repeat=await run(rows,client);assert.equal(repeat.departmentsAdded,0);assert.equal(repeat.positionsAdded,0);assert.equal(repeat.assignmentsAdded,0);
  await assert.rejects(()=>run([{department:'X',position:'Y'.repeat(81)}]),/Invalid department/);
  const after=await run(rows);assert.equal(after.departmentsAdded,0);assert.equal(after.settings.departments.length,2);
  await assert.rejects(()=>run(rows,'00000000-0000-0000-0000-000000000022'),/active client/);
  const clients=(await db.query('select organization_import_clients() data')).rows[0].data;assert.equal(clients.length,1);
  await db.exec("set test.allowed='no'");await assert.rejects(()=>run(rows),/Access denied/);await assert.rejects(()=>db.query('select organization_import_clients()'),/Access denied/);
  await db.exec("reset role;set test.allowed='yes'");
  const count=(await db.query('select count(*)::int count from hr_audit_logs')).rows[0].count;assert.equal(count,3);
  console.log('PASS: actual SQL import, duplicate replay, client assignments, tenant isolation, denied access, rollback and audit.');
}finally{await db.close();}
