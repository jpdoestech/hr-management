// Synthetic isolated PostgreSQL only; never contacts a production database.
const {PGlite}=await import(process.env.HRIS_PGLITE_MODULE||'@electric-sql/pglite');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',actor='00000000-0000-0000-0000-000000000011';
await db.exec(`create role authenticated;create role anon;create schema auth;
create table auth.users(id uuid primary key);create table hr_tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,full_name text);
create table hr_audit_logs(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,user_name text,action text);
create table access_permissions(permission_key text primary key,module_key text,action_key text,label text);
create table hr_records(tenant_id uuid,module text,record_id text,data jsonb,primary key(module,record_id));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function current_user_has_permission(text) returns boolean language sql stable as $$select $1<>coalesce(current_setting('test.denied',true),'')$$;
create function current_user_scope_allows(text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('test.scope',true),'global')='global' or $2->>'department'=current_setting('test.scope',true)$$;
grant usage on schema auth,public to authenticated,anon;
insert into auth.users values('${actor}');insert into hr_tenants values('${tenant}'),('${other}');
insert into profiles values('${actor}','${tenant}','Fixture HR');
insert into hr_records values
('${tenant}','onboardingCandidates','candidate','{"id":"candidate","name":"Synthetic Applicant","department":"Production","attachment":"retained.pdf"}'),
('${tenant}','employees','employee','{"id":"employee","name":"Synthetic Worker","department":"Production","sssNumber":"private-test-value"}'),
('${tenant}','employees','employee2','{"id":"employee2","department":"Sales"}'),
('${tenant}','employees','employee3','{"id":"employee3","department":"Production"}'),
('${other}','employees','foreign','{"id":"foreign","department":"Production"}');`);
await db.exec(readFileSync(new URL('../../supabase/proposals/0038_manpower_identity_reviews.sql',import.meta.url),'utf8'));
await db.exec(`set test.actor='${actor}';set test.tenant='${tenant}';set role authenticated`);
const preview=async(employee='employee')=>(await db.query('select preview_manpower_identity_review($1,$2) result',['candidate',employee])).rows[0].result;
const decide=async(pair,decision='SamePerson',reason='Reviewed identity evidence')=>(await db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6) result',
  [pair.candidate_id,pair.employee_id,decision,reason,pair.candidate_fingerprint,pair.employee_fingerprint])).rows[0].result;
const denied=async(fn,code)=>assert.rejects(fn,error=>error.code===code);
for(const key of ['onboarding.view','employees.view','onboarding.review_identity']){
  await db.query('select set_config($1,$2,false)',['test.denied',key]);await denied(()=>preview(),'42501');
}
await db.exec("set test.denied='';set test.scope='Production'");await denied(()=>preview('employee2'),'42501');
await db.exec("set test.scope='global'");await denied(()=>preview('foreign'),'42501');
const pair=await preview();assert.equal(pair.candidate_id,'candidate');assert.equal(pair.employee_id,'employee');
assert.doesNotMatch(JSON.stringify(pair),/private-test-value|retained.pdf|sssNumber/);
await denied(()=>decide(pair,'Unknown'),'23514');await denied(()=>decide(pair,'SamePerson',' '),'23514');
await denied(()=>decide(pair,'SamePerson','x'.repeat(1001)),'23514');
await db.exec(`set test.tenant='${other}'`);await denied(()=>decide(pair),'42501');await db.exec(`set test.tenant='${tenant}'`);
await db.exec("reset role;update hr_records set data=data||'{\"notes\":\"changed\"}' where record_id='candidate';set role authenticated");
await denied(()=>decide(pair),'40001');
const current=await preview();const result=await decide(current);assert.equal(result.decision,'SamePerson');assert.equal(result.reviewed_by,actor);
await denied(()=>decide(current),'23514');
await denied(async()=>decide(await preview('employee3')),'23505');
await decide(await preview('employee2'),'SeparatePersons');
assert.equal((await db.query('select * from hr_manpower_identity_reviews')).rows.length,2);
await db.exec("set test.scope='Production'");assert.equal((await db.query('select * from hr_manpower_identity_reviews')).rows.length,1);
await db.exec("set test.scope='global';set test.denied='onboarding.review_identity'");assert.equal((await db.query('select * from hr_manpower_identity_reviews')).rows.length,0);
await db.exec("set test.denied=''");await denied(()=>db.exec("delete from hr_manpower_identity_reviews"),'42501');
await db.exec('reset role');await denied(()=>db.exec("update hr_manpower_identity_reviews set reason='overwrite'"),'23514');
assert.equal((await db.query("select data from hr_records where record_id='candidate'")).rows[0].data.attachment,'retained.pdf');
assert.equal((await db.query('select count(*)::int count from hr_audit_logs')).rows[0].count,2);
await db.exec(`insert into hr_records values
('${tenant}','onboardingCandidates','converted','{"id":"converted","department":"Production","employeeRecordId":"employee"}'),
('${tenant}','onboardingCandidates','bad-id','{"id":"different","department":"Production"}'),
('${tenant}','onboardingCandidates','source-only','{"id":"source-only","department":"Production"}');
update hr_records set data=data||'{"sourceCandidateId":"source-only"}' where record_id='employee3';set role authenticated`);
const converted=(await db.query("select preview_manpower_identity_review('converted','employee') result")).rows[0].result;
await denied(()=>decide(converted,'SeparatePersons'),'23514');
const conflicting=(await db.query("select preview_manpower_identity_review('converted','employee2') result")).rows[0].result;
await denied(()=>decide(conflicting),'23514');
const badId=(await db.query("select preview_manpower_identity_review('bad-id','employee') result")).rows[0].result;
await denied(()=>decide(badId),'23514');
const sourceOnly=(await db.query("select preview_manpower_identity_review('source-only','employee3') result")).rows[0].result;
await denied(()=>decide(sourceOnly,'SeparatePersons'),'23514');
await db.exec('reset role');
const integritySQL=readFileSync(new URL('../../supabase/verification/manpower_identity_review_integrity.sql',import.meta.url),'utf8');
for(const result of await db.exec(integritySQL))assert.equal(result.rows.length,0);
await db.exec("update hr_records set data=data||'{\"notes\":\"changed after review\"}' where record_id='candidate'");
assert.equal((await db.exec(integritySQL))[0].rows.length,2);
await db.exec(`insert into hr_records values('${tenant}','onboardingCandidates','rollback','{"id":"rollback","department":"Production"}');
alter table hr_audit_logs add constraint fail_identity check(action not like 'Applicant identity reviewed [rollback/%') not valid;
set role authenticated`);
const rollback=(await db.query("select preview_manpower_identity_review('rollback','employee') result")).rows[0].result;
await denied(()=>decide(rollback),'23514');
assert.equal((await db.query("select * from hr_manpower_identity_reviews where candidate_id='rollback'")).rows.length,0);
await db.exec('set role anon');await denied(()=>preview(),'42501');await denied(()=>db.exec('select * from hr_manpower_identity_reviews'),'42501');
if(process.argv.includes('--revisions')){
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../../supabase/proposals/0039_manpower_identity_review_revisions.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');
  const revise=async(pair,decision,revision=pair.review_revision,reason='Rechecked current source evidence')=>(await db.query(
    'select record_manpower_identity_review($1,$2,$3,$4,$5,$6,$7) result',
    [pair.candidate_id,pair.employee_id,decision,reason,pair.candidate_fingerprint,pair.employee_fingerprint,revision])).rows[0].result;
  const stale=await preview();assert.equal(stale.review_revision,1);assert.equal(stale.source_changed,true);
  await db.exec("set test.denied='onboarding.review_identity'");await denied(()=>revise(stale,'SamePerson'),'42501');
  await db.exec("set test.denied='';set test.scope='Sales'");await denied(()=>revise(stale,'SamePerson'),'42501');
  await db.exec("set test.scope='global'");
  await denied(()=>revise(stale,'SamePerson',0),'40001');
  await denied(()=>revise(stale,'SamePerson',1,''),'23514');
  const refreshed=await revise(stale,'SamePerson');assert.equal(refreshed.revision,2);assert.equal(refreshed.supersedes_audit_id,result.audit_id);
  assert.equal((await preview()).source_changed,false);
  await denied(()=>revise(stale,'SeparatePersons'),'40001');
  await denied(async()=>decide(await preview()),'40001');
  await denied(async()=>revise(await preview('employee3'),'SamePerson'),'23514');
  const latest=await preview();await revise(latest,'SeparatePersons');
  assert.equal((await db.query('select * from hr_manpower_identity_links')).rows.length,0);
  await revise(await preview('employee3'),'SamePerson');
  const link=(await db.query('select * from hr_manpower_identity_links')).rows[0];assert.equal(link.employee_id,'employee3');
  const facts=(await db.query("select * from hr_manpower_identity_reviews where employee_id='employee' order by revision")).rows;
  assert.equal(facts.length,3);assert.equal(facts[0].decision,'SamePerson');assert.equal(facts[2].decision,'SeparatePersons');
  assert.equal(facts[2].supersedes_audit_id,facts[1].audit_id);
  await db.exec('reset role');
  const revisionChecks=await db.exec(readFileSync(new URL('../../supabase/verification/manpower_identity_revisions_integrity.sql',import.meta.url),'utf8'));
  assert.equal(revisionChecks[0].rows.length,0);assert.equal(revisionChecks[1].rows.length,0);
  assert.equal(revisionChecks[2].rows.length,1);assert.equal(revisionChecks[2].rows[0].employee_id,'employee2');
  await db.exec('set role authenticated');
  await db.exec('reset role');await denied(()=>db.exec("delete from hr_manpower_identity_reviews"),'23514');
  await db.exec(`insert into hr_records values('${tenant}','manpowerSlots','dependency','{"candidateId":"candidate"}');set role authenticated`);
  await denied(async()=>revise(await preview('employee3'),'SeparatePersons'),'23514');
  assert.equal((await db.query('select * from hr_manpower_identity_links')).rows[0].employee_id,'employee3');
  await denied(()=>db.exec('delete from hr_manpower_identity_links'),'42501');
  await db.exec("reset role;alter table hr_audit_logs add constraint fail_revision check(action not like '%revision 2:%') not valid;set role authenticated");
  const isolated=(await db.query("select preview_manpower_identity_review('source-only','employee') result")).rows[0].result;
  await revise(isolated,'SeparatePersons');
  const isolatedLatest=(await db.query("select preview_manpower_identity_review('source-only','employee') result")).rows[0].result;
  await denied(()=>revise(isolatedLatest,'SeparatePersons'),'23514');
  assert.equal((await db.query("select * from hr_manpower_identity_reviews where candidate_id='source-only'")).rows.length,1);
  await db.exec('set role anon');await denied(()=>revise(isolatedLatest,'SeparatePersons'),'42501');
  console.log('Versioned identity reviews passed: refresh stale sources, optimistic revision checks, immutable supersession history, single current link, explicit release before relink, assignment dependency blocking, atomic audit failure, no source merges.');
}
await db.close();console.log('Identity PostgreSQL rehearsal passed: narrow permission, both-source scope, tenant isolation, minimal preview, stale fingerprint rejection, explicit decisions, conflicting/repeated links blocked, append-only audit facts, audit-failure rollback, unchanged source attachments. Live policies/concurrency and correction/deployment integration remain gated.');
