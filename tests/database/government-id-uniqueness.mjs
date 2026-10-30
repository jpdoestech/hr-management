// Isolated PostgreSQL rehearsal: accepts only a PGlite module, never a database URL.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {GOVERNMENT_IDS,governmentIdKey} from '../../js/core/government-ids.js';
if(!process.argv[2])throw Error('Usage: node tests/database/government-id-uniqueness.mjs /absolute/path/to/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const migration=await readFile(new URL('../../supabase/migrations/0065_employee_government_id_uniqueness.sql',import.meta.url),'utf8');
const db=await PGlite.create(),tenant='00000000-0000-0000-0000-000000000001',otherTenant='00000000-0000-0000-0000-000000000002';
const insert=(id,data,scope=tenant,module='employees')=>db.query('insert into public.hr_records(tenant_id,module,record_id,data) values($1,$2,$3,$4)',[scope,module,id,JSON.stringify(data)]);
const update=(id,data)=>db.query('update public.hr_records set data=$1 where tenant_id=$2 and module=\'employees\' and record_id=$3',[JSON.stringify(data),tenant,id]);
try{
  await db.exec('create table public.hr_records(tenant_id uuid not null,module text not null,record_id text not null,data jsonb not null,primary key(module,record_id));');
  for(const {key} of GOVERNMENT_IDS){
    await insert('legacy-a',{[key]:'0000012345'});await insert('legacy-b',{[key]:'00-0001-2345'});
    const before=(await db.query('select record_id,data from public.hr_records order by record_id')).rows;
    await assert.rejects(db.exec(migration),error=>error.code==='23505'&&!error.message.includes('0000012345'));
    await db.exec('rollback');
    assert.deepEqual((await db.query('select record_id,data from public.hr_records order by record_id')).rows,before);
    assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname like 'hr_records_employee_%_unique_idx'")).rows[0].n,0);
    await db.exec('truncate public.hr_records');
  }
  await db.exec(migration);
  assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname like 'hr_records_employee_%_unique_idx'")).rows[0].n,4);
  await insert('blank-a',{});await insert('blank-b',{sssNumber:'',tin:null});
  for(const field of GOVERNMENT_IDS){
    const digits=field.key==='tin'?'000001234':'000000012345';
    const first={id:field.key,[field.key]:digits};
    await insert(field.key,first);await update(field.key,first);
    const duplicate=field.key==='tin'?digits+'999':digits.replace(/(.{3})/g,'$1-');
    await assert.rejects(insert(field.key+'-duplicate',{[field.key]:duplicate}),error=>error.code==='23505'&&error.constraint===field.index);
    await insert(field.key+'-other-tenant',{[field.key]:digits},otherTenant);
    await insert(field.key+'-candidate',{[field.key]:digits},tenant,'onboarding');
    await insert(field.key+'-update',{});
    await assert.rejects(update(field.key+'-update',{[field.key]:duplicate}),error=>error.code==='23505');
    for(const value of [null,'',' - ','00-0001-2345','000001234999']){
      const result=await db.query('select public.employee_government_id_key($1,$2) value',[field.key,value]);
      assert.equal(result.rows[0].value,governmentIdKey(field.key,value));
    }
  }
  await insert('cross-type',{sssNumber:'0000000012',philHealthNumber:'0000000012',pagIbigNumber:'0000000012',tin:'000000012'});
  await assert.rejects(db.query('insert into public.hr_records values($1,\'employees\',\'batch-a\',$2),($1,\'employees\',\'batch-b\',$2)',[tenant,JSON.stringify({sssNumber:'9999999999'})]),error=>error.code==='23505');
  assert.equal((await db.query("select count(*)::int n from public.hr_records where record_id in ('batch-a','batch-b')")).rows[0].n,0);
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.current_tenant_id() returns uuid language sql stable as $$select current_setting('test.tenant',true)::uuid$$;
    create function public.current_user_has_permission(p text) returns boolean language sql stable as $$select coalesce(current_setting('test.permissions',true)::jsonb ? p,false)$$;
    create function public.current_user_scope_allows(p text,d jsonb) returns boolean language sql stable as $$select d->>'department'=current_setting('test.department',true)$$;
    grant usage on schema auth to authenticated;grant select on public.hr_records to authenticated;
    alter table public.hr_records enable row level security;
    create policy fixture_visibility on public.hr_records for select to authenticated using(tenant_id=public.current_tenant_id() and data->>'blocked' is distinct from 'true');`);
  const lookupMigration=await readFile(new URL('../../supabase/migrations/0066_government_id_owner_lookup.sql',import.meta.url),'utf8');
  await db.exec(lookupMigration);
  await insert('visible-owner',{sssNumber:'1234567890',philHealthNumber:'123456789012',pagIbigNumber:'123456789013',tin:'123456789000',clientName:'Company Y',department:'Sales',position:'Merchandiser',lastName:'Dela Cruz',firstName:'Juan'});
  await insert('other-tenant-owner',{sssNumber:'1234567890',department:'Sales',name:'Other tenant'},otherTenant);
  await insert('outside-scope',{sssNumber:'1234567891',department:'Other',name:'Outside scope'});
  await insert('rls-hidden',{sssNumber:'1234567892',department:'Sales',name:'RLS hidden',blocked:true});
  const lookup=(value='12-3456789-0',record_id='synthetic-edited',field='sssNumber')=>db.query('select * from public.employee_government_id_owners($1,$2)',[field,JSON.stringify([{record_id,value}])]);
  await db.query("select set_config('test.uid',$1,false),set_config('test.tenant',$2,false),set_config('test.department','Sales',false),set_config('test.permissions',$3,false)",[tenant,tenant,JSON.stringify(['employees.view','employees.update'])]);
  await db.exec('set role authenticated');
  assert.deepEqual((await lookup()).rows,[{clientName:'Company Y',department:'Sales',position:'Merchandiser',name:'Dela Cruz, Juan'}]);
  for(const [field,value] of [['philHealthNumber','12-345678901-2'],['pagIbigNumber','1234-5678-9013'],['tin','123-456-789-999']])assert.equal((await lookup(value,'synthetic-edited',field)).rows[0].name,'Dela Cruz, Juan');
  for(const value of ['1234567891','1234567892',''])assert.equal((await lookup(value)).rows.length,0);
  assert.equal((await lookup('1234567890','visible-owner')).rows.length,0);
  await assert.rejects(lookup('1234567890','','unknown'),error=>error.code==='22023');
  await assert.rejects(db.query('select * from public.employee_government_id_owners($1,$2)',['sssNumber',JSON.stringify(Array(251).fill({}))]),error=>error.code==='22023');
  for(const permissions of [[],['employees.view'],['employees.update']]){
    await db.query("select set_config('test.permissions',$1,false)",[JSON.stringify(permissions)]);
    await assert.rejects(lookup(),error=>error.code==='42501');
  }
  await db.query("select set_config('test.permissions',$1,false)",[JSON.stringify(['employees.view','employees.create'])]);assert.equal((await lookup()).rows.length,1);
  await db.query("select set_config('test.uid','',false),set_config('test.permissions',$1,false)",[JSON.stringify(['employees.view','employees.update'])]);
  await assert.rejects(lookup(),error=>error.code==='42501');
  await db.exec('reset role;set role anon');await assert.rejects(lookup(),error=>error.code==='42501');await db.exec('reset role');
  assert.equal((await db.query("select prosecdef from pg_proc where oid='public.employee_government_id_owners(text,jsonb)'::regprocedure")).rows[0].prosecdef,false);
  console.log('Owner lookup SQL checks passed: minimal display fields, own-record exclusion, permission/auth gates, tenant/scope/RLS isolation and batch bound.');
  console.log('Government ID SQL rehearsal passed: migration rollback, four unique indexes, blanks, normalization parity, self updates, tenant/type isolation, update conflicts and atomic batch rejection.');
}finally{await db.close();}
