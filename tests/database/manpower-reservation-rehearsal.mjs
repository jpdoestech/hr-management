// Synthetic PostgreSQL rehearsal; no live database or credentials.
const modulePath=process.env.HRIS_PGLITE_MODULE||'@electric-sql/pglite';
const {PGlite}=await import(modulePath);
const {fuzzystrmatch}=await import(process.env.HRIS_PGLITE_MODULE?new URL('./contrib/fuzzystrmatch.js',modulePath).href:'@electric-sql/pglite/contrib/fuzzystrmatch');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite({extensions:{fuzzystrmatch}});
const tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',actor='00000000-0000-0000-0000-000000000011',client='00000000-0000-0000-0000-000000000021';
await db.exec(`create role authenticated;create role anon;create schema auth;
create table auth.users(id uuid primary key);create table hr_tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,full_name text,role text,is_super_admin boolean);
create table access_permissions(permission_key text primary key,module_key text,action_key text,label text);
create table hr_audit_logs(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,user_name text,action text);
create table hr_settings(tenant_id uuid,id text,data jsonb,primary key(tenant_id,id));
create table hr_records(tenant_id uuid,module text,record_id text,data jsonb,primary key(module,record_id));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create function current_user_has_permission(text) returns boolean language sql stable as $$select $1<>coalesce(current_setting('test.denied',true),'')$$;
create function current_user_scope_allows(text,jsonb) returns boolean language sql stable as $$select coalesce(current_setting('test.scope',true),'global')='global' or $2->>'department'=current_setting('test.scope',true)$$;
grant usage on schema auth,public to authenticated,anon;
grant select on hr_records to authenticated;
insert into auth.users values('${actor}');insert into hr_tenants values('${tenant}'),('${other}');
insert into profiles values('${actor}','${tenant}','Fixture HR','Administrator',false);
insert into hr_settings values('${tenant}','singleton','{"branchLocations":["Davao"],"departments":[{"name":"Production","active":true}],"positions":[{"name":"Operator","department":"Production","active":true}]}');`);
for(const file of ['0033_manpower_client_catalog.sql','0034_manpower_draft_transactions.sql'])await db.exec(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
for(const file of ['0035_manpower_prf_registry.sql','0036_manpower_submission.sql','0037_manpower_quantity_increases.sql','0038_manpower_identity_reviews.sql','0039_manpower_identity_review_revisions.sql','0040_manpower_reservations.sql'])await db.exec(readFileSync(new URL('../../supabase/proposals/'+file,import.meta.url),'utf8'));
await db.exec(`set test.actor='${actor}';set test.tenant='${tenant}';set role authenticated`);
await db.query('select * from save_manpower_client($1,$2,true,0)',[client,'Fixture Client']);
async function request(id,quantity){
  await db.query('select save_manpower_draft($1,0,$2,$3)',[id,{prf_number:id,client_id:client,branch_reporting:'Davao',requested_by:'Fixture HR',date_requested:'2026-10-09',target_date:'2026-10-10'},
    [{id:id+'-line',department:'Production',position:'Operator',current_authorized:quantity}]]);
  await db.query('select submit_manpower_request($1,1)',[id]);
}
await request('request',1000);await request('small',1);
assert.equal((await db.query('select manpower_identity_name_key($1) key',[{name:'MUÑOZ, José'}])).rows[0].key,'jose munoz');
await db.exec(`reset role;insert into hr_records select '${tenant}','onboardingCandidates','candidate'||number,
  jsonb_build_object('id','candidate'||number,'name','Synthetic applicant '||number,'department','Production','stage','Applicant') from generate_series(1,77) number;
update hr_records set data=data||'{"stage":"Rejected"}' where record_id='candidate75';set role authenticated`);
const items=Array.from({length:75},(_,index)=>({candidate_id:'candidate'+(index+1),line_id:'request-line',hiring_category:'New Hire'}));
const reserve=async(token,rows)=>(await db.query('select reserve_manpower_applicants($1,$2) result',[token,rows])).rows[0].result;
const denied=async(fn,code)=>assert.rejects(fn,error=>error.code===code);
await denied(()=>reserve('invalid',items),'23514');
assert.equal((await db.query('select * from hr_manpower_reservations')).rows.length,0);
await db.exec("reset role;update hr_records set data=data||'{\"stage\":\"Applicant\"}' where record_id='candidate75';set role authenticated");
await denied(()=>reserve('duplicate',[items[0],items[0]]),'23514');
await denied(()=>reserve('capacity',[{...items[0],line_id:'small-line'},{...items[1],line_id:'small-line'}]),'23514');
assert.equal((await db.query('select * from hr_manpower_reservations')).rows.length,0);
for(const key of ['onboarding.update','onboarding.view','manpower.view']){
  await db.query('select set_config($1,$2,false)',['test.denied',key]);await denied(()=>reserve('denied',items),'42501');
}
await db.exec("set test.denied='';set test.scope='Other'");await denied(()=>reserve('scope',items),'42501');
await db.exec(`set test.scope='global';set test.tenant='${other}'`);await denied(()=>reserve('tenant',items),'42501');
await db.exec(`set test.tenant='${tenant}'`);
const result=await reserve('bulk75',items);assert.equal(result.reservation_ids.length,75);assert.equal(result.replayed,false);
const replay=await reserve('bulk75',[...items].reverse());assert.equal(replay.replayed,true);assert.deepEqual(replay.reservation_ids,result.reservation_ids);
await denied(()=>reserve('bulk75',[items[0]]),'23514');await denied(()=>reserve('different',[items[0]]),'23514');
const capacity=(await db.query("select manpower_line_capacity('request-line') result")).rows[0].result;
assert.equal(capacity.reserved,75);assert.equal(capacity.available,925);assert.equal(capacity.fulfilled,0);assert.equal(capacity.scheduled,0);
await denied(()=>db.exec('delete from hr_manpower_reservations'),'42501');
await db.exec("reset role;alter table hr_audit_logs add constraint fail_reserve check(action not like 'Applicants reserved: batch audit-failure,%') not valid;set role authenticated");
await denied(()=>reserve('audit-failure',[{...items[0],candidate_id:'candidate76'}]),'23514');
assert.equal((await db.query('select * from hr_manpower_reservations')).rows.length,75);
await db.exec('reset role');assert.equal((await db.query("select count(*)::int count from hr_audit_logs where action like 'Applicants reserved:%'")).rows[0].count,1);
await denied(()=>db.exec("delete from hr_records where record_id='candidate2'"),'23514');
await denied(()=>db.exec("update hr_records set data=data||'{\"stage\":\"Withdrawn\"}' where record_id='candidate2'"),'23514');
await denied(()=>db.exec("update hr_records set data=data||'{\"employeeRecordId\":\"unsafe\"}' where record_id='candidate2'"),'23514');
assert.equal((await db.query("select count(*)::int count from hr_manpower_reservation_batches")).rows[0].count,1);
await denied(()=>db.exec("update hr_manpower_reservations set state='Released'"),'23514');
await db.exec('set role authenticated');
const release=async(id,reason='Applicant withdrew')=>(await db.query('select release_manpower_reservation($1,$2) result',[id,reason])).rows[0].result;
await denied(()=>release(result.reservation_ids[0],''),'23514');
await db.exec("set test.denied='onboarding.update'");await denied(()=>release(result.reservation_ids[0]),'42501');await db.exec("set test.denied=''");
assert.equal((await release(result.reservation_ids[0])).replayed,false);
assert.equal((await release(result.reservation_ids[0])).replayed,true);
assert.equal((await db.query("select manpower_line_capacity('request-line') result")).rows[0].result.available,926);
assert.equal((await db.query('select * from hr_manpower_reservations')).rows.length,75);
await db.exec("reset role;alter table hr_audit_logs add constraint fail_release check(action not like 'Applicant reservation released%Reason: simulate failure') not valid;set role authenticated");
await denied(()=>release(result.reservation_ids[1],'simulate failure'),'23514');
assert.equal((await db.query('select state from hr_manpower_reservations where id=$1',[result.reservation_ids[1]])).rows[0].state,'Reserved');
await db.exec('reset role');assert.equal((await db.query('select * from hr_manpower_reservation_intents')).rows.length,0);
await db.exec("reset role;insert into hr_records values ('"+tenant+"','employees','duplicate','{\"id\":\"duplicate\",\"name\":\"Synthetic applicant 76\",\"department\":\"Production\"}');set role authenticated");
await denied(()=>reserve('identity',[{...items[0],candidate_id:'candidate76'}]),'23514');
const pair=(await db.query("select preview_manpower_identity_review('candidate76','duplicate') result")).rows[0].result;
await db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6,$7)',[pair.candidate_id,pair.employee_id,'SamePerson','Verified fixture identity',pair.candidate_fingerprint,pair.employee_fingerprint,0]);
const linked=await reserve('identity-reviewed',[{...items[0],candidate_id:'candidate76',hiring_category:'Rehire'}]);assert.equal(linked.reservation_ids.length,1);
assert.equal((await db.query("select worker_key from hr_manpower_reservations where candidate_id='candidate76'")).rows[0].worker_key,'employee:duplicate');
await db.exec('reset role');
for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_reservation_integrity.sql',import.meta.url),'utf8')))assert.equal(check.rows.length,0);
await denied(()=>db.exec("update hr_manpower_reservation_batches set payload='[]'"),'23514');
await db.exec('set role anon');await denied(()=>reserve('anon',items),'42501');
if(process.argv.includes('--amendments')){
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../../supabase/proposals/0041_manpower_quantity_amendments.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');
  const amend=async(quantity,revision,reason='Reviewed staffing requirement',operation='amend_manpower_quantity')=>
    (await db.query(`select ${operation}($1,$2,$3,$4,$5) result`,['request','request-line',revision,quantity,reason])).rows[0].result;
  const counters=async()=>(await db.query("select manpower_line_capacity('request-line') result")).rows[0].result;
  const history=async()=>(await db.query("select * from hr_manpower_quantity_amendments where line_id='request-line' order by request_revision")).rows;
  assert.equal((await counters()).reserved,75);
  for(const [quantity,reason] of [[null,'Reason'],[0,'Reason'],[-1,'Reason'],[1000,'Reason'],[75,null],[75,''],[75,' '.repeat(10)],[75,'x'.repeat(1001)]])
    await denied(()=>amend(quantity,2,reason),'23514');
  await denied(()=>db.query('select amend_manpower_quantity($1,$2,2,75,$3)',['request','small-line','Wrong request line']),'42501');
  await denied(()=>amend(74,2),'23514');
  await denied(()=>amend(75,1),'40001');
  for(const key of ['manpower.update','manpower.view']){
    await db.query('select set_config($1,$2,false)',['test.denied',key]);await denied(()=>amend(75,2),'42501');
  }
  await db.exec("set test.denied='';set test.scope='Other'");await denied(()=>amend(75,2),'42501');
  await db.exec(`set test.scope='global';set test.tenant='${other}'`);await denied(()=>amend(75,2),'42501');
  await db.exec(`set test.tenant='${tenant}'`);
  await denied(()=>db.query('select amend_manpower_quantity_internal($1,$2,2,75,$3,false)',['request','request-line','Bypass']),'42501');
  const reduced=await amend(75,2);
  assert.equal(reduced.request.revision,3);assert.equal(reduced.line.original_requested,1000);
  assert.equal(reduced.line.current_authorized,75);assert.equal((await counters()).available,0);
  assert.equal((await history()).length,1);assert.equal((await history())[0].previous_authorized,1000);
  await denied(()=>amend(76,2),'40001');
  await release(result.reservation_ids[1]);
  await denied(()=>amend(74,3,'Wrong API','increase_manpower_quantity'),'23514');
  assert.equal((await amend(74,3)).request.revision,4);
  assert.equal((await amend(80,4,'Approved increase','increase_manpower_quantity')).request.revision,5);

  // Owner-seeded accounting facts, NOT a deployment/scheduling/cancellation workflow test.
  await db.exec('reset role');
  await db.exec(`insert into hr_records values('${tenant}','employees','accounting-fixture',
    '{"id":"accounting-fixture","name":"Accounting fixture","department":"Production"}');
    insert into hr_audit_logs(tenant_id,user_id,user_name,action)
      values('${tenant}','${actor}','Fixture HR','Synthetic historical fulfillment accounting');`);
  const fixtureAudit=(await db.query("select id from hr_audit_logs where action='Synthetic historical fulfillment accounting'")).rows[0].id;
  async function seedTransition(id,changes){
    await db.exec('begin');
    await db.query(`insert into hr_manpower_reservation_intents
      select txid_current(),tenant_id,id,to_jsonb(reservation),to_jsonb(reservation)||$2::jsonb
      from hr_manpower_reservations reservation where id=$1`,[id,changes]);
    await db.query(`update hr_manpower_reservations set state=$2,employee_id=$3,worker_key=$4,
      actual_date=$5,ended_date=$6,confirmation_audit_id=$7,scheduled_date=$8 where id=$1`,
    [id,changes.state,changes.employee_id||null,changes.worker_key,changes.actual_date||null,
      changes.ended_date||null,changes.confirmation_audit_id||null,changes.scheduled_date||null]);
    await db.exec('delete from hr_manpower_reservation_intents where transaction_id=txid_current();commit;');
  }
  await seedTransition(result.reservation_ids[2],{state:'Ended',employee_id:'accounting-fixture',
    worker_key:'employee:accounting-fixture',actual_date:'2026-10-09',ended_date:'2026-10-10',confirmation_audit_id:fixtureAudit});
  const scheduled=(await db.query('select candidate_id from hr_manpower_reservations where id=$1',[result.reservation_ids[3]])).rows[0].candidate_id;
  await seedTransition(result.reservation_ids[3],{state:'Scheduled',employee_id:null,worker_key:'candidate:'+scheduled,
    scheduled_date:'2026-10-11',actual_date:null,ended_date:null,confirmation_audit_id:null});
  await db.exec(`begin;insert into hr_manpower_amendment_intents
    select txid_current(),line.tenant_id,request.id,line.id,to_jsonb(request),to_jsonb(request),
      to_jsonb(line),to_jsonb(line)||'{"cancelled_unfilled":5}'::jsonb
    from hr_manpower_lines line join hr_manpower_requests request on request.tenant_id=line.tenant_id and request.id=line.request_id
    where line.id='request-line';
    update hr_manpower_lines set cancelled_unfilled=5 where id='request-line';
    delete from hr_manpower_amendment_intents where transaction_id=txid_current();commit;set role authenticated;`);
  assert.equal((await counters()).reserved,73);assert.equal((await counters()).fulfilled,1);
  assert.equal((await counters()).active_deployed,0);assert.equal((await counters()).scheduled,1);
  await denied(()=>amend(78,5),'23514');
  const boundary=await amend(79,5);
  assert.equal(boundary.line.cancelled_unfilled,5);assert.equal(boundary.line.original_requested,1000);
  assert.equal((await counters()).available,0);
  await release(result.reservation_ids[3]);
  assert.equal((await amend(78,6)).request.revision,7);
  assert.equal((await counters()).fulfilled,1);assert.equal((await counters()).scheduled,0);
  await db.exec("reset role;alter table hr_audit_logs add constraint fail_amend check(action not like '%Reason: amendment audit failure') not valid;set role authenticated;");
  await denied(()=>amend(90,7,'amendment audit failure'),'23514');
  assert.equal((await counters()).current_authorized,78);assert.equal((await history()).length,5);
  assert.equal((await db.query("select revision from hr_manpower_requests where id='request'")).rows[0].revision,7);
  assert.equal((await amend(90,7,'Approved renewed demand')).request.revision,8);
  await db.exec('reset role');assert.equal((await db.query('select * from hr_manpower_amendment_intents')).rows.length,0);
  await denied(()=>db.exec("update hr_manpower_quantity_amendments set reason='Rewrite'"),'23514');
  await denied(()=>db.exec("update hr_manpower_lines set original_requested=90 where id='request-line'"),'23514');
  await denied(()=>db.exec("update hr_manpower_lines set current_authorized=91 where id='request-line'"),'23514');
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_quantity_increases_integrity.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  await db.exec('set role anon');await denied(()=>amend(91,8),'42501');
  console.log('Quantity amendment rehearsal passed: reserved/scheduled/ended-credit/cancelled-demand boundaries, release before decrease, immutable original, strict increase-only compatibility, revision/permission/scope/tenant/anonymous denials, private-helper denial, append-only history and atomic audit rollback.');
}
await db.close();console.log('Reservation PostgreSQL rehearsal passed: 75-worker atomic batch, ineligible/capacity/duplicate rollback, bounded real assignments for 1000 demand, role/scope/tenant denial, order-independent idempotent replay, worker uniqueness, authoritative capacity and audit-failure rollback. Production and independent concurrency remain unverified.');
