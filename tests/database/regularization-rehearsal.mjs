// Existing PGlite runtime only: synthetic, in-memory SQL; no server or production connection.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.HRIS_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite(),tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',actor='00000000-0000-0000-0000-000000000011';
try{
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function current_tenant_id() returns uuid language sql as $$select '${tenant}'::uuid$$;
    create function current_user_has_permission(text) returns boolean language sql as $$select current_setting('test.allowed',true)='yes'$$;
    create function current_user_scope_allows(text,jsonb) returns boolean language sql as $$select $1<>'restricted'$$;
    create table hr_records(tenant_id uuid,module text,record_id text,data jsonb,updated_by uuid,primary key(module,record_id));
    create table hr_audit_logs(tenant_id uuid,user_id uuid,user_name text,action text);
    alter table hr_records enable row level security;
    create policy records on hr_records to authenticated using(tenant_id=current_tenant_id() and current_user_scope_allows(record_id,data)) with check(tenant_id=current_tenant_id() and current_user_scope_allows(record_id,data));
    grant usage on schema public,auth to authenticated;grant select,update on hr_records to authenticated;
    set test.actor='${actor}';set test.allowed='yes';
    insert into hr_records select '${tenant}','employees',id,jsonb_build_object('id',id,'employmentType',kind,'status',state,'statusReason',case state when 'Inactive' then 'Floating Status' when 'Separated' then 'Resigned' else 'Active / Normal' end,'statusDate','2020-01-01','dateHired',hired,'employmentHistory',jsonb_build_array(jsonb_build_object('type','Synthetic hiring')),'recordHistory',jsonb_build_array(jsonb_build_object('action','Synthetic original'))),null
      from (values('active','Probationary','Active','2020-01-01'),('inactive','Probationary','Inactive','2020-01-01'),('separated','Probationary','Separated','2020-01-01'),('project','Project-Based','Active','2020-01-01'),('future','Probationary','Active','2099-01-01'),('invalid','Probationary','Active','bad date'),('restricted','Probationary','Active','2020-01-01')) v(id,kind,state,hired);
    insert into hr_records values('${other}','employees','other',jsonb_build_object('employmentType','Probationary','status','Active','statusReason','Active / Normal','dateHired','2020-01-01'),null);`);
  const employment=readFileSync(new URL('../../supabase/migrations/0032_employee_employment_model.sql',import.meta.url),'utf8');
  await db.exec(employment.slice(employment.indexOf('create or replace function public.validate_employee_employment_model()'),employment.indexOf('create index if not exists hr_records_employee_employment_type_idx')));
  const stale=(await db.query("select data from hr_records where record_id='active'")).rows[0].data;
  await db.exec(readFileSync(new URL('../../supabase/migrations/0061_automatic_employee_regularization.sql',import.meta.url),'utf8'));
  assert.equal((await db.query("select data->>'employmentType' value from hr_records where record_id='active'")).rows[0].value,'Probationary');
  for(const [hire,due] of [['2024-08-31','2025-02-28'],['2023-08-31','2024-02-29'],['2024-02-29','2024-08-29'],['2026-04-13','2026-10-13']]){
    assert.equal((await db.query('select employee_regularization_due($1)::text value',[{dateHired:hire}])).rows[0].value,due);
  }
  assert.equal((await db.query('select employee_regularization_due($1) value',[{dateHired:'2024-02-30'}])).rows[0].value,null);
  await db.exec('set role authenticated');
  const run=async()=>(await db.query('select regularize_probationary_employees() data')).rows[0].data;
  const changed=await run();assert.equal(changed.length,2);
  for(const row of changed){assert.equal(row.data.employmentType,'Regular / Permanent');assert.equal(row.data.statusDate,'2020-01-01');assert.equal(row.data.employmentHistory.length,2);assert.equal(row.data.recordHistory.length,2);assert.equal(row.data.regularizationDate,'2020-07-01');}
  assert.equal((await run()).length,0);
  await db.query("update hr_records set data=$1 where record_id='active'",[stale]);
  const restored=(await db.query("select data from hr_records where record_id='active'")).rows[0].data;
  assert.equal(restored.employmentType,'Regular / Permanent');assert.equal(restored.employmentHistory.length,2);assert.equal(restored.recordHistory.length,2);
  await db.query("update hr_records set data=$1 where record_id='active'",[{...stale,employmentType:'Regular / Permanent'}]);
  const retained=(await db.query("select data from hr_records where record_id='active'")).rows[0].data;
  assert.equal(retained.automaticRegularization.key,restored.automaticRegularization.key);assert.equal(retained.employmentHistory.length,2);
  await db.exec("set test.allowed='no'");await assert.rejects(run,/Access denied/);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int count from hr_audit_logs')).rows[0].count,2);
  for(const id of ['separated','project','future','invalid','restricted','other']){
    const row=(await db.query('select data from hr_records where record_id=$1',[id])).rows[0].data;assert.equal(row.employmentType,id==='project'?'Project-Based':'Probationary');
  }
  await db.query('insert into hr_records values($1,$2,$3,$4,null)',[tenant,'employees','imported',{employmentType:'Probationary',status:'Active',statusReason:'Active / Normal',dateHired:'2020-01-01'}]);
  const imported=(await db.query("select data from hr_records where record_id='imported'")).rows[0].data;
  assert.equal(imported.employmentType,'Regular / Permanent');assert.equal(imported.employmentHistory.length,1);assert.equal(imported.recordHistory.length,1);
  await db.query('insert into hr_records values($1,$2,$3,$4,null)',[tenant,'employees','forged',{employmentType:'Project-Based',status:'Active',statusReason:'Active / Normal',dateHired:'2020-01-01',automaticRegularization:{key:'forged'}}]);
  assert.equal((await db.query("select data from hr_records where record_id='forged'")).rows[0].data.automaticRegularization,undefined);
  await db.exec('set role anon');await assert.rejects(()=>db.query('select regularize_probationary_employees()'),/permission denied/);
  await db.exec('reset role');await assert.rejects(()=>db.query('select run_scheduled_employee_regularization()'),/Scheduler only/);
  await db.exec("set test.actor='';select run_scheduled_employee_regularization()");
  assert.equal((await db.query("select data->>'employmentType' value from hr_records where record_id='other'")).rows[0].value,'Regular / Permanent');
  assert.equal((await db.query("select data->>'employmentType' value from hr_records where record_id='separated'")).rows[0].value,'Probationary');
  console.log('PASS: calendar boundaries, scoped catch-up, preserved history/status, replay, stale writes, denied users, owner-only scheduler and excluded contracts.');
}finally{await db.close();}
