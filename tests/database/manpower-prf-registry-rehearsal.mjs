// Isolated PostgreSQL/PGlite rehearsal; never connects to a live database.
const {PGlite}=await import(process.env.HRIS_PGLITE_MODULE||'@electric-sql/pglite');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const admin='00000000-0000-0000-0000-000000000011';
await db.exec(`create role authenticated;create role anon;create schema auth;
create table auth.users(id uuid primary key);create table hr_tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,full_name text,role text,is_super_admin boolean);
create table hr_audit_logs(id bigserial primary key,tenant_id uuid,user_id uuid,user_name text,action text);
create table hr_settings(tenant_id uuid,id text,data jsonb,primary key(tenant_id,id));
create table hr_records(tenant_id uuid,module text,record_id text,data jsonb,primary key(module,record_id));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function current_user_has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.permission',true),'true')<>'false'$$;
create function current_user_scope_allows(text,jsonb) returns boolean language sql stable as $$select true$$;
grant usage on schema auth,public to authenticated,anon;
grant select,insert,update,delete on hr_records to authenticated;
alter table hr_records enable row level security;
create policy source_scope on hr_records to authenticated using(tenant_id=current_tenant_id() and current_user_has_permission('manpower.update')) with check(tenant_id=current_tenant_id() and current_user_has_permission('manpower.create'));
insert into auth.users values('${admin}');insert into hr_tenants values('${tenant}'),('${other}');
insert into profiles values('${admin}','${tenant}','Admin','Administrator',false);
insert into hr_settings values('${tenant}','singleton','{}');
insert into hr_records values
('${tenant}','manpowerRequests','legacy1','{"prfNumber":" Shared  01 ","attachment":"untouched.pdf"}'),
('${tenant}','manpowerRequests','legacy2','{"prfNumber":"shared 01"}'),
('${tenant}','employees','employee1','{"prfNumber":"Shared 01"}'),
('${tenant}','prf','historical-prf','{"prfNumber":"Shared 01"}');`);
for(const file of ['0033_manpower_client_catalog.sql','0034_manpower_draft_transactions.sql'])await db.exec(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.exec(`insert into hr_manpower_requests(tenant_id,id,prf_number) values('${tenant}','cross-draft','Cross 01');
insert into hr_manpower_lines(tenant_id,id,request_id,ordinal) values('${tenant}','cross-line','cross-draft',0);
insert into hr_records values('${tenant}','manpowerRequests','cross-legacy','{"prfNumber":"CROSS 01"}');`);
const before=await db.query('select * from hr_records order by module,record_id');
const beforeDraft=await db.query('select * from hr_manpower_requests');
await db.exec(readFileSync(new URL('../../supabase/proposals/0035_manpower_prf_registry.sql',import.meta.url),'utf8'));
assert.deepEqual((await db.query('select * from hr_records order by module,record_id')).rows,before.rows);
assert.deepEqual((await db.query('select * from hr_manpower_requests')).rows,beforeDraft.rows);
async function denied(fn,code){await assert.rejects(fn,error=>error.code===code);}
async function insertLegacy(id,number,targetTenant=tenant){return db.query("insert into hr_records values($1,'manpowerRequests',$2,jsonb_build_object('prfNumber',$3::text))",[targetTenant,id,number]);}
async function renameLegacy(id,number){return db.query("update hr_records set data=jsonb_set(data,'{prfNumber}',to_jsonb($1::text)) where module='manpowerRequests' and record_id=$2",[number,id]);}
async function owners(number){return (await db.query('select owners from hr_manpower_prf_registry where tenant_id=$1 and normalized_prf=normalize_manpower_prf($2)',[tenant,number])).rows[0]?.owners;}
assert.deepEqual(await owners('shared 01'),{'legacy:legacy1':true,'legacy:legacy2':true});
assert.deepEqual(await owners('cross 01'),{'legacy:cross-legacy':true,'quantity:cross-draft':true});
await denied(()=>insertLegacy('blocked',' SHARED\t01 '),'23505');
await db.exec("update hr_records set data=data||'{\"notes\":\"Allowed\"}' where record_id='legacy1'");
await renameLegacy('legacy1','Independent 01');assert.deepEqual(await owners('shared 01'),{'legacy:legacy2':true});
assert.equal((await db.query("select data->>'attachment' attachment from hr_records where record_id='legacy1'")).rows[0].attachment,'untouched.pdf');
await denied(()=>renameLegacy('legacy1','Shared 01'),'23505');
await denied(()=>db.exec("update hr_manpower_requests set prf_number='Shared 01' where id='cross-draft'"),'23505');
await insertLegacy('same-number-other-tenant','Shared 01',other);
await insertLegacy('blank1','');await insertLegacy('blank2',' \t ');
await db.exec(`insert into hr_records values('${tenant}','manpowerRequests','legacy1','{"prfNumber":"Ghost 01"}') on conflict(module,record_id) do nothing`);
assert.equal(await owners('Ghost 01'),undefined);
await db.exec(`insert into hr_records values('${tenant}','manpowerRequests','legacy1','{"prfNumber":"Independent 02","attachment":"untouched.pdf"}') on conflict(module,record_id) do update set data=excluded.data`);
assert.equal(await owners('Independent 01'),undefined);assert.deepEqual(await owners('Independent 02'),{'legacy:legacy1':true});
await denied(()=>db.exec(`insert into hr_records values('${tenant}','manpowerRequests','batch1','{"prfNumber":"Batch 01"}'),('${tenant}','manpowerRequests','batch2','{"prfNumber":"Shared 01"}')`),'23505');
assert.equal(await owners('Batch 01'),undefined);assert.equal((await db.query("select * from hr_records where record_id='batch1'")).rows.length,0);
await denied(()=>db.exec("update hr_records set record_id='changed' where record_id='legacy1'"),'23514');
await denied(()=>db.exec("update hr_manpower_requests set id='changed' where id='cross-draft'"),'23503');
await db.exec(`insert into hr_manpower_requests(tenant_id,id,prf_number) values('${tenant}','identity-only','Identity 01')`);
await denied(()=>db.exec("update hr_manpower_requests set id='changed' where id='identity-only'"),'23514');
await db.exec("delete from hr_records where record_id='cross-legacy';delete from hr_manpower_lines where request_id='cross-draft';delete from hr_manpower_requests where id='cross-draft'");
assert.equal(await owners('Cross 01'),undefined);await insertLegacy('reused','Cross 01');
await db.exec(`set test.actor='${admin}';set test.tenant='${tenant}';set role authenticated;`);
await denied(()=>insertLegacy('auth-blocked','Cross 01'),'23505');
await denied(()=>insertLegacy('tenant-blocked','Free Other',other),'42501');
await denied(()=>db.exec('select * from hr_manpower_prf_registry'),'42501');
await denied(()=>db.exec("insert into hr_manpower_prf_registry values(current_tenant_id(),'forged','{\"legacy:forged\":true}')"),'42501');
await db.query('select save_manpower_draft($1,0,$2,$3)',['rpc-draft',{prf_number:'RPC 01'},[{id:'rpc-line',current_authorized:1000}]]);
await denied(()=>insertLegacy('rpc-collision',' rpc 01 '),'23505');
await denied(()=>db.query('select save_manpower_draft($1,0,$2,$3)',['other-draft',{prf_number:'Cross 01'},[]]),'23505');
await renameLegacy('legacy1','Independent 03');
await db.exec('reset role');
await insertLegacy('audit-rollback','Audit Before');
await db.exec("alter table hr_audit_logs add constraint simulate_failure check(action not like '%audit-rollback%') not valid");
await denied(()=>renameLegacy('audit-rollback','Audit After'),'23514');
assert.deepEqual(await owners('Audit Before'),{'legacy:audit-rollback':true});assert.equal(await owners('Audit After'),undefined);
assert.equal((await db.query("select data->>'prfNumber' number from hr_records where record_id='audit-rollback'")).rows[0].number,'Audit Before');
assert.equal((await db.query("select user_id from hr_audit_logs where action like '%Independent 03%' or action like '%independent 03%'")).rows[0].user_id,admin);
await db.exec('set role anon');await denied(()=>db.exec('select * from hr_manpower_prf_registry'),'42501');
await db.exec('reset role');
assert.equal((await db.query("select has_function_privilege('authenticated','public.guard_manpower_prf_number()','EXECUTE') allowed")).rows[0].allowed,false);
await db.exec(readFileSync(new URL('../../supabase/verification/manpower_prf_registry_baseline.sql',import.meta.url),'utf8'));
await db.close();
console.log('PRF registry PostgreSQL rehearsal passed: preserved sources/conflicts, bidirectional duplicates, tenant isolation, blanks, ownership release, upsert/do-nothing behavior, atomic batch/audit rollback, stable IDs, RPC integration and private registry privileges. Concurrent independent connections and production RLS remain unverified.');
