// Synthetic PostgreSQL rehearsal; no live database or credentials.
const modulePath=process.env.HRIS_PGLITE_MODULE||'@electric-sql/pglite';
const {PGlite}=await import(modulePath);
const {fuzzystrmatch}=await import(process.env.HRIS_PGLITE_MODULE?new URL('./contrib/fuzzystrmatch.js',modulePath).href:'@electric-sql/pglite/contrib/fuzzystrmatch');
const {btree_gist}=await import(process.env.HRIS_PGLITE_MODULE?new URL('./contrib/btree_gist.js',modulePath).href:'@electric-sql/pglite/contrib/btree_gist');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readPhilippineAddressCatalog,addressCatalogSeedSQL} from '../../scripts/lib/philippine-address-catalog.mjs';
const db=new PGlite({extensions:{fuzzystrmatch,btree_gist}});
const tenant='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',actor='00000000-0000-0000-0000-000000000011',client='00000000-0000-0000-0000-000000000021';
await db.exec(`create role authenticated;create role anon;create schema auth;
create table auth.users(id uuid primary key);create table hr_tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,full_name text,role text,is_super_admin boolean);
create table access_permissions(permission_key text primary key,module_key text,action_key text,label text);
create table hr_audit_logs(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,user_name text,action text);
create table hr_settings(tenant_id uuid,id text,data jsonb,primary key(tenant_id,id));
create table hr_records(tenant_id uuid,module text,record_id text,data jsonb,updated_at timestamptz default now(),updated_by uuid,primary key(module,record_id));
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
const interlock=process.argv.includes('--interlock');
if(interlock)for(const file of ['0043_manpower_identity_refresh.sql','0044_manpower_scheduling.sql','0045_manpower_deployment_intervals.sql','0046_manpower_deployment_confirmation.sql','0047_manpower_source_interlock.sql'])
  await db.exec(readFileSync(new URL('../../supabase/proposals/'+file,import.meta.url),'utf8'));
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
if(process.argv.includes('--amendments')||process.argv.includes('--lifecycle')){
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
if(process.argv.includes('--lifecycle')){
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../../supabase/proposals/0042_manpower_lifecycle.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');
  const lifecycle=async(id,revision,operation,reason='Authorized lifecycle change',line=null,quantity=null)=>
    (await db.query('select change_manpower_lifecycle($1,$2,$3,$4,$5,$6) result',[id,revision,operation,reason,line,quantity])).rows[0].result;
  const counter=async(line)=>(await db.query('select manpower_line_capacity($1) result',[line])).rows[0].result;
  const header=async(id)=>(await db.query('select * from hr_manpower_requests where id=$1',[id])).rows[0];
  for(const operation of ['Close','Cancel'])await denied(()=>lifecycle('request',8,operation),'23514');
  await denied(()=>lifecycle('request',8,'CancelLine','Reason','request-line',1),'23514');
  await denied(()=>lifecycle('request',8,'Reopen'),'23514');
  for(const [operation,reason,line,quantity] of [['Invalid','Reason',null,null],['Close','',null,null],
    ['Close','x'.repeat(1001),null,null],['Close','Reason','request-line',1],['CancelLine','Reason',null,1],
    ['CancelLine','Reason','request-line',0]])await denied(()=>lifecycle('request',8,operation,reason,line,quantity),'23514');
  await denied(()=>lifecycle('request',8,'CancelLine','Reason','small-line',1),'42501');
  await denied(()=>lifecycle('request',7,'Close'),'40001');
  for(const key of ['manpower.update','manpower.view']){
    await db.query('select set_config($1,$2,false)',['test.denied',key]);await denied(()=>lifecycle('request',8,'Close'),'42501');
  }
  await db.exec("set test.denied='';set test.scope='Other'");await denied(()=>lifecycle('request',8,'Close'),'42501');
  await db.exec(`set test.scope='global';set test.tenant='${other}'`);await denied(()=>lifecycle('request',8,'Close'),'42501');
  await db.exec(`set test.tenant='${tenant}'`);
  for(const row of (await db.query("select id from hr_manpower_reservations where state in ('Reserved','Scheduled')")).rows)
    await db.query('select release_manpower_reservation($1,$2)',[row.id,'Resolved before closure']);
  const closed=await lifecycle('request',8,'Close');assert.equal(closed.request.state,'Closed');assert.equal(closed.request.revision,9);
  assert.equal((await counter('request-line')).cancelled_unfilled,89);assert.equal((await counter('request-line')).fulfilled,1);
  assert.equal((await counter('request-line')).available,0);assert.equal((await counter('request-line')).original_requested,1000);
  assert.equal((await counter('request-line')).current_authorized,90);
  await denied(()=>lifecycle('request',9,'Close'),'23514');
  await denied(()=>db.query("select amend_manpower_quantity('request','request-line',9,91,'Closed request')"),'23514');
  await denied(()=>reserve('closed-request',[{candidate_id:'candidate77',line_id:'request-line',hiring_category:'New Hire'}]),'23514');
  const reopened=await lifecycle('request',9,'Reopen');assert.equal(reopened.request.revision,10);assert.equal(reopened.request.state,'Open');
  assert.deepEqual(reopened.line_changes,[]);assert.equal((await counter('request-line')).cancelled_unfilled,89);
  assert.equal((await counter('request-line')).available,0);
  await denied(()=>reserve('no-restored-demand',[{candidate_id:'candidate77',line_id:'request-line',hiring_category:'New Hire'}]),'23514');
  await db.query("select amend_manpower_quantity('request','request-line',10,92,'Explicit new authorization')");
  assert.equal((await counter('request-line')).available,2);
  await denied(()=>lifecycle('request',11,'CancelLine','Too much','request-line',3),'23514');
  const partial=await lifecycle('request',11,'CancelLine','Partial outstanding closure','request-line',1);
  assert.equal(partial.request.state,'Open');assert.equal(partial.line_changes[0].previous_cancelled,89);
  assert.equal(partial.line_changes[0].current_cancelled,90);assert.equal((await counter('request-line')).available,1);
  const cancelled=await lifecycle('request',12,'Cancel');assert.equal(cancelled.request.state,'Cancelled');
  assert.equal((await counter('request-line')).cancelled_unfilled,91);assert.equal((await counter('request-line')).fulfilled,1);
  await lifecycle('request',13,'Reopen');assert.equal((await counter('request-line')).available,0);

  await db.query('select save_manpower_draft($1,0,$2,$3)',['multi',
    {prf_number:'multi',client_id:client,branch_reporting:'Davao',requested_by:'Fixture HR',date_requested:'2026-10-09',target_date:'2026-10-10'},
    ['a','b'].map((suffix,index)=>({id:'multi-'+suffix,department:'Production',position:'Operator',current_authorized:index?6:4}))]);
  await denied(()=>lifecycle('multi',1,'Close'),'23514');
  await db.query("select submit_manpower_request('multi',1)");
  await db.exec("reset role;update hr_records set data=data||'{\"name\":\"LIFECYCLE FIXTURE OLIVERA\"}' where record_id='candidate77';set role authenticated;");
  const held=await reserve('multi-held',[{candidate_id:'candidate77',line_id:'multi-b',hiring_category:'New Hire'}]);
  await denied(()=>lifecycle('multi',2,'Close'),'23514');
  assert.equal((await counter('multi-a')).cancelled_unfilled,0);assert.equal((await header('multi')).revision,2);
  await db.query('select release_manpower_reservation($1,$2)',[held.reservation_ids[0],'Resolved second-line commitment']);
  await db.exec("reset role;alter table hr_audit_logs add constraint fail_lifecycle check(action not like '%Reason: lifecycle audit failure') not valid;set role authenticated;");
  await denied(()=>lifecycle('multi',2,'Close','lifecycle audit failure'),'23514');
  assert.equal((await counter('multi-a')).cancelled_unfilled,0);assert.equal((await counter('multi-b')).cancelled_unfilled,0);
  assert.equal((await header('multi')).state,'Open');assert.equal((await header('multi')).revision,2);
  assert.equal((await db.query("select * from hr_manpower_lifecycle_history where request_id='multi'")).rows.length,0);
  const multiClosed=await lifecycle('multi',2,'Close');assert.equal(multiClosed.line_changes.length,2);
  assert.equal((await counter('multi-a')).cancelled_unfilled,4);assert.equal((await counter('multi-b')).cancelled_unfilled,6);
  await lifecycle('multi',3,'Reopen');assert.equal((await counter('multi-a')).available,0);
  await denied(()=>db.exec("delete from hr_manpower_lifecycle_history"),'42501');
  await db.exec("set test.denied='manpower.view'");assert.equal((await db.query('select * from hr_manpower_lifecycle_history')).rows.length,0);
  await db.exec("set test.denied='';reset role");
  assert.equal((await db.query('select * from hr_manpower_amendment_intents')).rows.length,0);
  await denied(()=>db.exec("update hr_manpower_lifecycle_history set reason='Rewrite'"),'23514');
  await denied(()=>db.exec("update hr_manpower_requests set state='Closed' where id='multi'"),'23514');
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_quantity_increases_integrity.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_lifecycle_integrity.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  await db.exec('set role anon');await denied(()=>lifecycle('multi',4,'Close'),'42501');
  console.log('Lifecycle rehearsal passed: line and request cancellation, multi-line closure, mandatory reservation resolution, preserved original/authorized/fulfilled quantities, reopen without capacity restoration, stale/invalid/access denials, append-only RLS history, direct-writer guards and multi-line audit rollback.');
}
if(process.argv.includes('--identity-refresh')){
  await db.exec('reset role');
  if(!interlock)await db.exec(readFileSync(new URL('../../supabase/proposals/0043_manpower_identity_refresh.sql',import.meta.url),'utf8'));
  await db.exec(`insert into hr_records values('${tenant}','onboardingCandidates','refresh-unassigned',
    '{"id":"refresh-unassigned","name":"Unassigned review fixture","department":"Production","stage":"Applicant"}');`);
  await db.exec("update hr_records set data=data||'{\"remarks\":\"Updated applicant metadata\"}' where record_id='candidate76';set role authenticated;");
  const preview=async(candidate='candidate76',employee='duplicate')=>
    (await db.query('select preview_manpower_identity_review($1,$2) result',[candidate,employee])).rows[0].result;
  const review=async(pair,decision='SamePerson',reason='Rechecked unchanged resolved identity')=>
    (await db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6,$7) result',
      [pair.candidate_id,pair.employee_id,decision,reason,pair.candidate_fingerprint,pair.employee_fingerprint,pair.review_revision])).rows[0].result;
  const before=(await db.query("select manpower_line_capacity('request-line') result")).rows[0].result;
  const stale=await preview();assert.equal(stale.source_changed,true);assert.equal(stale.review_revision,1);
  await denied(()=>review(stale,'SeparatePersons'),'23514');
  await db.exec("set test.denied='onboarding.review_identity'");await denied(()=>review(stale),'42501');
  await db.exec("set test.denied='';set test.scope='Other'");await denied(()=>review(stale),'42501');
  await db.exec("set test.scope='global'");
  const refreshed=await review(stale);assert.equal(refreshed.revision,2);
  assert.equal((await preview()).source_changed,false);
  assert.deepEqual((await db.query("select manpower_line_capacity('request-line') result")).rows[0].result,before);
  assert.equal((await db.query("select worker_key from hr_manpower_reservations where candidate_id='candidate76'")).rows[0].worker_key,'employee:duplicate');
  await denied(()=>review(stale),'40001');
  const unresolved=(await db.query("select candidate_id from hr_manpower_reservations where employee_id is null limit 1")).rows[0].candidate_id;
  await denied(async()=>review(await preview(unresolved),'SamePerson'),'23514');
  await denied(async()=>review(await preview(unresolved),'SeparatePersons'),'23514');
  // Unassigned pairs can still be corrected despite the reservation table's existence.
  const separate=await review(await preview('refresh-unassigned'),'SeparatePersons');assert.equal(separate.revision,1);
  assert.equal((await review(await preview('refresh-unassigned'),'SeparatePersons')).revision,2);
  await db.exec("reset role;update hr_records set data=data||'{\"remarks\":\"Updated employee metadata\"}' where record_id='duplicate';alter table hr_audit_logs add constraint fail_refresh check(action not like '%Reason: refresh audit failure') not valid;set role authenticated;");
  const changed=await preview();assert.equal(changed.source_changed,true);
  await denied(()=>review(changed,'SamePerson','refresh audit failure'),'23514');
  assert.equal((await preview()).review_revision,2);
  assert.equal((await db.query("select revision from hr_manpower_identity_links where candidate_id='candidate76'")).rows[0].revision,2);
  const latest=await review(changed);assert.equal(latest.revision,3);assert.equal(latest.supersedes_audit_id,refreshed.audit_id);
  assert.equal((await preview()).source_changed,false);
  await db.exec(`reset role;insert into hr_records values('${tenant}','manpowerSlots','legacy-refresh','{"candidateId":"refresh-unassigned"}');set role authenticated;`);
  await denied(async()=>review(await preview('refresh-unassigned'),'SeparatePersons'),'23514');
  await db.exec('reset role;create table hr_manpower_deployments(id text);set role authenticated');
  await denied(async()=>review(await preview()),'23514');
  await db.exec('reset role;drop table hr_manpower_deployments;set role authenticated');
  await db.exec(`set test.tenant='${other}'`);await denied(()=>preview(),'42501');await db.exec(`set test.tenant='${tenant}'`);
  await db.exec('set role anon');await denied(()=>review(changed),'42501');
  console.log('Identity refresh rehearsal passed: unchanged resolved refresh under reservations, stale-source/revision handling, unresolved assignment re-key protection, unassigned review corrections, immutable worker/capacity, audit rollback, permissions/scopes/tenants/anonymous denial and legacy/unknown-ledger gates.');
}
if(process.argv.includes('--scheduling')){
  await db.exec('reset role');
  if(!interlock)await db.exec(readFileSync(new URL('../../supabase/proposals/0044_manpower_scheduling.sql',import.meta.url),'utf8'));
  await db.exec(`insert into hr_records values
    ('${tenant}','onboardingCandidates','schedule-unresolved','{"id":"schedule-unresolved","name":"OLIVERA UNIQUE SCHEDULE FIXTURE","department":"Production","stage":"Applicant"}'),
    ('${tenant}','onboardingCandidates','schedule-resolved','{"id":"schedule-resolved","name":"DAWSON LINKED SCHEDULE FIXTURE","department":"Production","stage":"Applicant"}'),
    ('${tenant}','employees','schedule-worker','{"id":"schedule-worker","name":"DAWSON LINKED SCHEDULE FIXTURE","department":"Production"}');set role authenticated;`);
  await request('scheduling',2);
  const pair=(await db.query("select preview_manpower_identity_review('schedule-resolved','schedule-worker') result")).rows[0].result;
  await db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6,$7)',[pair.candidate_id,pair.employee_id,'SamePerson','Verified scheduling fixture identity',pair.candidate_fingerprint,pair.employee_fingerprint,0]);
  await reserve('schedule-fixture',[{candidate_id:'schedule-unresolved',line_id:'scheduling-line',hiring_category:'New Hire'},
    {candidate_id:'schedule-resolved',line_id:'scheduling-line',hiring_category:'Rehire'}]);
  const row=async(candidate)=>(await db.query('select * from hr_manpower_reservations where candidate_id=$1',[candidate])).rows[0];
  const unlinked=(await row('schedule-unresolved')).id,resolved=(await row('schedule-resolved')).id;
  const dates=(await db.query(`select to_char((now() at time zone 'Asia/Manila')::date+1,'YYYY-MM-DD') "first",to_char((now() at time zone 'Asia/Manila')::date+2,'YYYY-MM-DD') "second",to_char((now() at time zone 'Asia/Manila')::date-1,'YYYY-MM-DD') past`)).rows[0];
  const schedule=async(id,revision,date,reason='Approved deployment plan')=>
    (await db.query('select schedule_manpower_reservation($1,$2,$3,$4) result',[id,revision,date,reason])).rows[0].result;
  const counters=async()=>(await db.query("select manpower_line_capacity('scheduling-line') result")).rows[0].result;
  await denied(()=>schedule(unlinked,0,dates.past),'23514');
  await denied(()=>schedule(unlinked,0,'infinity'),'23514');
  for(const reason of ['',null,'x'.repeat(1001)])await denied(()=>schedule(unlinked,0,dates.first,reason),'23514');
  await denied(()=>schedule(unlinked,-1,dates.first),'23514');await denied(()=>schedule(unlinked,0,null),'23514');
  for(const key of ['onboarding.update','onboarding.view','manpower.view']){
    await db.query('select set_config($1,$2,false)',['test.denied',key]);await denied(()=>schedule(unlinked,0,dates.first),'42501');
  }
  await db.exec("set test.denied='employees.view'");await denied(()=>schedule(resolved,0,dates.first),'42501');
  await db.exec("set test.denied='';set test.scope='Other'");await denied(()=>schedule(unlinked,0,dates.first),'42501');
  await db.exec(`set test.scope='global';set test.tenant='${other}'`);await denied(()=>schedule(unlinked,0,dates.first),'42501');
  await db.exec(`set test.tenant='${tenant}'`);
  assert.equal((await schedule(unlinked,0,dates.first)).schedule_revision,1);
  assert.equal((await counters()).reserved,2);assert.equal((await counters()).scheduled,1);
  assert.equal((await counters()).fulfilled,0);assert.equal((await counters()).available,0);
  assert.equal((await row('schedule-unresolved')).actual_date,null);
  await denied(()=>schedule(unlinked,0,dates.second),'40001');
  await denied(()=>schedule(unlinked,1,dates.first),'23514');
  assert.equal((await schedule(unlinked,1,dates.second)).schedule_revision,2);
  assert.equal((await schedule(unlinked,2,dates.first)).schedule_revision,3);
  await denied(()=>schedule(unlinked,1,dates.second),'40001');
  const cleared=await schedule(unlinked,3,null);assert.equal(cleared.state,'Reserved');assert.equal(cleared.scheduled_date,null);
  assert.equal((await counters()).reserved,2);assert.equal((await counters()).scheduled,0);assert.equal((await counters()).fulfilled,0);
  await schedule(unlinked,4,dates.first);await db.query('select release_manpower_reservation($1,$2)',[unlinked,'Released planned applicant']);
  await denied(()=>schedule(unlinked,5,dates.second),'23514');assert.equal((await counters()).available,1);
  assert.equal((await row('schedule-unresolved')).schedule_revision,5);
  assert.equal((await schedule(resolved,0,dates.first)).schedule_revision,1);
  await db.exec("reset role;alter table hr_audit_logs add constraint fail_schedule check(action not like '%Reason: schedule audit failure') not valid;set role authenticated;");
  await denied(()=>schedule(resolved,1,dates.second,'schedule audit failure'),'23514');
  assert.equal((await row('schedule-resolved')).schedule_revision,1);
  assert.equal((await db.query('select * from hr_manpower_schedule_history where reservation_id=$1',[resolved])).rows.length,1);
  assert.equal((await counters()).reserved,1);assert.equal((await counters()).scheduled,1);assert.equal((await counters()).fulfilled,0);
  await db.exec("set test.denied='onboarding.view'");assert.equal((await db.query('select * from hr_manpower_schedule_history')).rows.length,0);
  await db.exec("set test.denied='';reset role");
  await denied(()=>db.exec("update hr_manpower_schedule_history set reason='Rewrite'"),'23514');
  await denied(()=>db.exec("update hr_manpower_reservations set schedule_revision=99 where candidate_id='schedule-resolved'"),'23514');
  assert.equal((await db.query('select * from hr_manpower_reservation_intents')).rows.length,0);
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_schedule_integrity.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  await db.exec('set role anon');await denied(()=>schedule(resolved,1,dates.second),'42501');
  console.log('Scheduling rehearsal passed: plan/reschedule/clear, ABA-safe revisions, scheduled remains reserved not fulfilled, actual dates untouched, explicit release retains schedule history, mandatory reasons/current-future dates, role/scope/tenant/RLS denial and audit rollback.');
}
if(process.argv.includes('--intervals')){
  await db.exec('reset role');
  if(!interlock)await db.exec(readFileSync(new URL('../../supabase/proposals/0045_manpower_deployment_intervals.sql',import.meta.url),'utf8'));
  await db.exec(`insert into hr_records select '${tenant}','onboardingCandidates','interval-candidate-'||number,
    jsonb_build_object('id','interval-candidate-'||number,'name','ZEPPHYR INTERVAL FIXTURE '||number,'department','Production','stage','Applicant')
    from generate_series(1,3) number;set role authenticated`);
  await request('interval-fixture',3);
  const batch=await reserve('interval-batch',Array.from({length:3},(_,i)=>({candidate_id:'interval-candidate-'+(i+1),line_id:'interval-fixture-line',hiring_category:'New Hire'})));
  const dates=(await db.query(`select to_char((now() at time zone 'Asia/Manila')::date-4,'YYYY-MM-DD') start,
    to_char((now() at time zone 'Asia/Manila')::date-2,'YYYY-MM-DD') boundary,
    to_char((now() at time zone 'Asia/Manila')::date-1,'YYYY-MM-DD') finish,
    to_char((now() at time zone 'Asia/Manila')::date+1,'YYYY-MM-DD') future`)).rows[0];
  await db.exec('reset role');
  const audit=(await db.query("insert into hr_audit_logs(tenant_id,user_name,action) values($1,'Fixture owner','Synthetic interval facts, not actual confirmation API') returning id",[tenant])).rows[0].id;
  // Owner-only exact transition intents seed accounting facts; public confirmation is still gated.
  async function fact(id,changes){
    await db.exec('begin');
    try{
      await db.query(`insert into hr_manpower_reservation_intents select txid_current(),tenant_id,id,to_jsonb(r),to_jsonb(r)||$2::jsonb
        from hr_manpower_reservations r where id=$1`,[id,changes]);
      await db.query(`update hr_manpower_reservations set state=$2,employee_id=$3,worker_key='employee:'||$3,
        actual_date=$4,ended_date=$5,confirmation_audit_id=$6 where id=$1`,[id,changes.state,changes.employee_id,changes.actual_date,changes.ended_date,changes.confirmation_audit_id]);
      await db.exec('delete from hr_manpower_reservation_intents where transaction_id=txid_current();commit');
    }catch(error){await db.exec('rollback');throw error;}
  }
  const ended={state:'Ended',employee_id:'interval-worker',worker_key:'employee:interval-worker',actual_date:dates.start,ended_date:dates.boundary,confirmation_audit_id:audit};
  await fact(batch.reservation_ids[0],ended);
  await denied(()=>fact(batch.reservation_ids[1],{...ended,ended_date:dates.finish}),'23P01');
  for(const changes of [{actual_date:'infinity'},{actual_date:dates.future},{ended_date:dates.start},{ended_date:dates.future}])
    await denied(()=>fact(batch.reservation_ids[1],{...ended,...changes}),'23514');
  await fact(batch.reservation_ids[1],{...ended,actual_date:dates.boundary,ended_date:dates.finish});
  await denied(()=>fact(batch.reservation_ids[2],{...ended,state:'Deployed',actual_date:dates.boundary,ended_date:null}),'23P01');
  await denied(()=>fact(batch.reservation_ids[2],{...ended,state:'Deployed',actual_date:dates.finish}),'23514');
  await fact(batch.reservation_ids[2],{...ended,state:'Deployed',actual_date:dates.finish,ended_date:null});
  assert.equal((await db.query("select manpower_line_capacity('interval-fixture-line') result")).rows[0].result.fulfilled,3);
  assert.equal((await db.query("select manpower_line_capacity('interval-fixture-line') result")).rows[0].result.active_deployed,1);
  await fact(batch.reservation_ids[0],{...ended,state:'Reversed'});
  await fact(batch.reservation_ids[1],{...ended,ended_date:dates.finish});
  assert.equal((await db.query("select manpower_line_capacity('interval-fixture-line') result")).rows[0].result.fulfilled,2);
  assert.equal((await db.query('select count(*)::int count from hr_manpower_reservations where id=$1',[batch.reservation_ids[0]])).rows[0].count,1);
  assert.equal((await db.query('select * from hr_manpower_reservation_intents')).rows.length,0);
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_deployment_intervals.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  console.log('Deployment interval rehearsal passed: historical overlap rejected, adjacent half-open intervals accepted, invalid/future/empty dates rejected, active interval and historical fulfillment retained. Owner fixtures are not evidence of actual confirmation API or independent concurrency.');
}
if(process.argv.includes('--confirmation')||interlock){
  await db.exec('reset role');
  for(const [flag,file] of [['--scheduling','0044_manpower_scheduling.sql'],['--intervals','0045_manpower_deployment_intervals.sql']])
    if(!process.argv.includes(flag)&&!interlock)await db.exec(readFileSync(new URL('../../supabase/proposals/'+file,import.meta.url),'utf8'));
  if(!interlock)await db.exec(readFileSync(new URL('../../supabase/proposals/0046_manpower_deployment_confirmation.sql',import.meta.url),'utf8'));
  const names=['ALVAREZ CLARISSE TAMAYO','DELGADO ROBERTO PASCUAL'];
  for(let index=0;index<2;index++){
    const id='confirm-'+index,source={id,name:names[index],department:'Production',stage:'Applicant'};
    const employee={id:'confirm-worker-'+index,name:names[index],department:'Production',status:'Active',statusReason:'Active / Normal'};
    await db.query('insert into hr_records values($1,$2,$3,$4),($1,$5,$6,$7)',[tenant,'onboardingCandidates',id,source,'employees',employee.id,employee]);
  }
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'onboardingCandidates','confirm-unresolved',{id:'confirm-unresolved',name:'WOJTEK ZYGMUNT KRAKOW',department:'Production',stage:'Applicant'}]);
  await db.exec('set role authenticated');await request('confirmation',3);
  async function reviewIdentity(index){
    const pair=(await db.query('select preview_manpower_identity_review($1,$2) result',['confirm-'+index,'confirm-worker-'+index])).rows[0].result;
    return db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6,$7)',[pair.candidate_id,pair.employee_id,'SamePerson','Verified synthetic deployment identity',pair.candidate_fingerprint,pair.employee_fingerprint,pair.review_revision]);
  }
  await reviewIdentity(0);await reviewIdentity(1);
  await reserve('confirm-reserve',[...names.map((_,index)=>({candidate_id:'confirm-'+index,line_id:'confirmation-line',hiring_category:'Existing Employee / Transfer'})),
    {candidate_id:'confirm-unresolved',line_id:'confirmation-line',hiring_category:'New Hire'}]);
  const row=async(id)=>(await db.query("select * from hr_manpower_reservations where candidate_id=$1 and state in ('Reserved','Scheduled','Deployed')",[id])).rows[0];
  const dates=(await db.query(`select to_char((now() at time zone 'Asia/Manila')::date,'YYYY-MM-DD') today,
    to_char((now() at time zone 'Asia/Manila')::date-1,'YYYY-MM-DD') past,
    to_char((now() at time zone 'Asia/Manila')::date+1,'YYYY-MM-DD') future`)).rows[0];
  const rows=[];for(const id of ['confirm-0','confirm-1','confirm-unresolved'])rows.push(await row(id));
  const selection=rows.map((r,index)=>({reservation_id:r.id,schedule_revision:0,actual_date:index===0?dates.today:dates.past,reason:'HR confirmed actual reporting'}));
  const confirm=async(token,items)=>(await db.query('select confirm_manpower_deployments($1,$2) result',[token,items])).rows[0].result;
  const counters=async()=>(await db.query("select manpower_line_capacity('confirmation-line') result")).rows[0].result;
  for(const invalid of [[],null,[selection[0],selection[0]],[{...selection[0],reason:''}],[{...selection[0],reason:{text:'not text'}}],
    [{...selection[0],actual_date:dates.future}],[{...selection[0],extra:true}],[{...selection[0],schedule_revision:-1}],[{...selection[0],reservation_id:'invalid'}]])
    await denied(()=>confirm('invalid-confirm',invalid),'23514');
  await denied(()=>confirm('unresolved-batch',selection),'23514');
  assert.equal((await counters()).fulfilled,0);assert.equal((await db.query('select * from hr_manpower_confirmation_history')).rows.length,0);
  for(const permission of ['onboarding.view','onboarding.update','manpower.view','manpower.update','employees.view']){
    await db.query('select set_config($1,$2,false)',['test.denied',permission]);await denied(()=>confirm('denied-confirm',selection.slice(0,2)),'42501');
  }
  await db.exec("set test.denied='';set test.scope='Other'");await denied(()=>confirm('scope-confirm',selection.slice(0,2)),'42501');
  await db.exec(`set test.scope='global';set test.tenant='${other}'`);await denied(()=>confirm('tenant-confirm',selection.slice(0,2)),'42501');
  await db.exec(`set test.tenant='${tenant}'`);
  await db.query('select schedule_manpower_reservation($1,0,$2,$3)',[rows[0].id,dates.future,'Proposed date only']);
  await denied(()=>confirm('stale-confirm',selection.slice(0,2)),'40001');selection[0].schedule_revision=1;
  await db.exec("reset role;update hr_records set data=data||'{\"remarks\":\"New evidence\"}' where record_id='confirm-worker-0';set role authenticated");
  await denied(()=>confirm('stale-identity-confirm',selection.slice(0,2)),'23514');
  if(!process.argv.includes('--identity-refresh')&&!interlock){
    await db.exec('reset role');await db.exec(readFileSync(new URL('../../supabase/proposals/0043_manpower_identity_refresh.sql',import.meta.url),'utf8'));await db.exec('set role authenticated');
  }
  await reviewIdentity(0);
  await db.exec('reset role');
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'employees','confirm-new-duplicate',{id:'confirm-new-duplicate',name:names[0],department:'Production'}]);
  await db.exec('set role authenticated');await denied(()=>confirm('new-duplicate-confirm',selection.slice(0,2)),'23514');
  await db.exec("reset role;delete from hr_records where record_id='confirm-new-duplicate'");
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'oncall','confirm-legacy-oncall',{employeeName:names[0]}]);
  await db.exec('set role authenticated');await denied(()=>confirm('oncall-confirm',selection.slice(0,2)),'23514');
  await db.exec("reset role;delete from hr_records where record_id='confirm-legacy-oncall';alter table hr_audit_logs add constraint fail_confirmation check(action not like 'Actual deployments confirmed: batch audit-failure-confirm,%') not valid;set role authenticated");
  await denied(()=>confirm('audit-failure-confirm',selection.slice(0,2)),'23514');
  assert.equal((await counters()).reserved,3);assert.equal((await counters()).fulfilled,0);
  await db.exec('reset role');assert.equal((await db.query('select * from hr_manpower_confirmation_batches')).rows.length,0);
  await db.exec("alter table hr_manpower_confirmation_history add constraint fail_late_history check(reason<>'late history failure') not valid;set role authenticated");
  const lateFailure=selection.slice(0,2).sort((a,b)=>a.reservation_id.localeCompare(b.reservation_id)).map((item,index)=>({...item,reason:index===1?'late history failure':item.reason}));
  await denied(()=>confirm('late-row-failure',lateFailure),'23514');
  assert.equal((await counters()).fulfilled,0);assert.equal((await counters()).reserved,3);
  await db.exec('reset role');assert.equal((await db.query('select * from hr_manpower_confirmation_batches')).rows.length,0);
  assert.equal((await db.query("select * from hr_audit_logs where action like 'Actual deployments confirmed:%'")).rows.length,0);
  await db.exec('set role authenticated');await request('confirm-old',1);await db.exec('reset role');
  const oldAudit=(await db.query("insert into hr_audit_logs(tenant_id,user_name,action) values($1,'Fixture owner','Synthetic historical interval before confirmation') returning id",[tenant])).rows[0].id;
  const historical=(await db.query(`insert into hr_manpower_reservations
    select (jsonb_populate_record(null::hr_manpower_reservations,to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),
      'line_id','confirm-old-line','state','Ended','scheduled_date',null,'schedule_revision',0,
      'actual_date',(now() at time zone 'Asia/Manila')::date-3,'ended_date',(now() at time zone 'Asia/Manila')::date,
      'confirmation_audit_id',$2::uuid))).* from hr_manpower_reservations r where r.id=$1 returning id`,[rows[0].id,oldAudit])).rows[0].id;
  await db.exec('set role authenticated');
  await denied(()=>confirm('overlap-confirm',[{...selection[0],actual_date:dates.past}]),'23P01');
  assert.equal((await counters()).fulfilled,0);
  assert.equal((await db.query('select * from hr_manpower_reservations where id=$1',[historical])).rows[0].state,'Ended');
  await db.exec('reset role');
  const employeesBefore=(await db.query("select data from hr_records where module='employees' and record_id like 'confirm-worker-%' order by record_id")).rows;
  await db.exec('set role authenticated');
  const confirmed=await confirm('actual-two',selection.slice(0,2));assert.equal(confirmed.replayed,false);
  assert.deepEqual(confirmed.reservation_ids,selection.slice(0,2).map(r=>r.reservation_id).sort());
  assert.equal((await counters()).fulfilled,2);assert.equal((await counters()).reserved,1);assert.equal((await counters()).available,0);
  assert.equal((await counters()).active_deployed,2);assert.equal((await counters()).scheduled,0);
  assert.equal((await row('confirm-0')).scheduled_date.toISOString().slice(0,10),dates.future);
  assert.equal((await row('confirm-0')).actual_date.toISOString().slice(0,10),dates.today);
  assert.equal((await db.query('select * from hr_manpower_confirmation_history')).rows.length,2);
  assert.equal((await confirm('actual-two',selection.slice(0,2).reverse())).replayed,true);
  await denied(()=>db.exec('insert into hr_manpower_confirmation_history default values'),'42501');
  await denied(()=>db.exec('delete from hr_manpower_confirmation_history'),'42501');
  await denied(()=>db.exec('select * from hr_manpower_confirmation_batches'),'42501');
  await denied(()=>confirm('actual-two',[selection[0]]),'23514');
  await denied(()=>confirm('second-token',selection.slice(0,2)),'23514');
  await db.exec("set test.denied='employees.view'");assert.equal((await db.query('select * from hr_manpower_confirmation_history')).rows.length,0);
  await denied(()=>confirm('actual-two',selection.slice(0,2)),'42501');
  await db.exec("set test.denied='';set test.scope='Other'");assert.equal((await db.query('select * from hr_manpower_confirmation_history')).rows.length,0);
  await db.exec("set test.scope='global';reset role");
  assert.deepEqual((await db.query("select data from hr_records where module='employees' and record_id like 'confirm-worker-%' order by record_id")).rows,employeesBefore);
  await denied(()=>db.exec("update hr_manpower_confirmation_history set reason='Rewrite'"),'23514');
  await denied(()=>db.exec('delete from hr_manpower_confirmation_batches'),'23514');
  assert.equal((await db.query('select * from hr_manpower_reservation_intents')).rows.length,0);
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_confirmation_integrity.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  await db.query('insert into hr_records values($1,$2,$3,$4),($1,$5,$6,$7)',[tenant,'onboardingCandidates','confirm-single',
    {id:'confirm-single',name:'NERI BIANCA SOLANO',department:'Production',stage:'Applicant'},'employees','confirm-single-worker',
    {id:'confirm-single-worker',name:'NERI BIANCA SOLANO',department:'Production',status:'Active'}]);
  await db.exec('set role authenticated');await request('confirm-single',1);
  const singlePair=(await db.query("select preview_manpower_identity_review('confirm-single','confirm-single-worker') result")).rows[0].result;
  await db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6,0)',[singlePair.candidate_id,singlePair.employee_id,'SamePerson','Verified singleton identity',singlePair.candidate_fingerprint,singlePair.employee_fingerprint]);
  await reserve('single-reservation',[{candidate_id:'confirm-single',line_id:'confirm-single-line',hiring_category:'Existing Employee / Transfer'}]);
  const singleSelection={reservation_id:(await row('confirm-single')).id,schedule_revision:0,actual_date:dates.today,reason:'Individual reporting confirmed'};
  assert.equal((await confirm('single-confirmation',[singleSelection])).replayed,false);
  assert.equal((await db.query("select manpower_line_capacity('confirm-single-line') result")).rows[0].result.fulfilled,1);
  assert.equal((await confirm('single-confirmation',[singleSelection])).replayed,true);
  await db.exec('reset role');
  for(let index=0;index<75;index++){
    const id='bulk-confirm-'+index,name='SYNTHETIC '+createHash('sha256').update(String(index)).digest('hex').slice(0,32);
    await db.query('insert into hr_records values($1,$2,$3,$4),($1,$5,$6,$7)',[tenant,'onboardingCandidates',id,
      {id,name,department:'Production',stage:'Applicant'},'employees',id+'-worker',{id:id+'-worker',name,department:'Production',status:'Active'}]);
  }
  await db.exec('set role authenticated');await request('bulk-confirmation',1000);
  for(let index=0;index<75;index++){
    const id='bulk-confirm-'+index,pair=(await db.query('select preview_manpower_identity_review($1,$2) result',[id,id+'-worker'])).rows[0].result;
    await db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6,0)',[id,id+'-worker','SamePerson','Verified bulk fixture identity',pair.candidate_fingerprint,pair.employee_fingerprint]);
  }
  await reserve('bulk-confirm-reserve',Array.from({length:75},(_,index)=>({candidate_id:'bulk-confirm-'+index,line_id:'bulk-confirmation-line',hiring_category:'Existing Employee / Transfer'})));
  const bulkSelections=(await db.query("select id from hr_manpower_reservations where line_id='bulk-confirmation-line' order by id")).rows
    .map(r=>({reservation_id:r.id,schedule_revision:0,actual_date:dates.today,reason:'Actual bulk reporting confirmed'}));
  await denied(()=>confirm('bulk-late-failure',bulkSelections.map((item,index)=>({...item,reason:index===74?'late history failure':item.reason}))),'23514');
  assert.equal((await db.query("select manpower_line_capacity('bulk-confirmation-line') result")).rows[0].result.reserved,75);
  assert.equal((await db.query("select manpower_line_capacity('bulk-confirmation-line') result")).rows[0].result.fulfilled,0);
  assert.equal((await confirm('bulk-actual-75',bulkSelections)).reservation_ids.length,75);
  const bulkCapacity=(await db.query("select manpower_line_capacity('bulk-confirmation-line') result")).rows[0].result;
  assert.equal(bulkCapacity.reserved,0);assert.equal(bulkCapacity.fulfilled,75);assert.equal(bulkCapacity.available,925);
  assert.equal((await db.query("select count(*)::int count from hr_manpower_reservations where line_id='bulk-confirmation-line'")).rows[0].count,75);
  assert.equal((await confirm('bulk-actual-75',bulkSelections.reverse())).replayed,true);
  await db.exec('reset role');
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_confirmation_integrity.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  await db.exec('set role anon');await denied(()=>confirm('anonymous',selection.slice(0,2)),'42501');
  console.log('Actual confirmation rehearsal passed: same-row reserved-to-fulfilled accounting, individual date overrides, past-date reasons, current identity and new-duplicate gates, schedule revision, all-or-nothing unresolved/audit rollback, idempotent replay, RLS/access denial and unchanged employee master. Conversion, transfers, legacy/on-call reconciliation, live and independent concurrency remain gated.');
}
if(interlock){
  await db.exec('set role authenticated');
  await denied(()=>db.query('select manpower_private.reserve_manpower_applicants($1,$2)',['bypass',[]]),'42501');
  await denied(()=>db.query('select manpower_private.lock_source_snapshot($1)',[tenant]),'42501');
  const oldPair=(await db.query("select preview_manpower_identity_review('confirm-0','confirm-worker-0') result")).rows[0].result;
  await denied(()=>db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6)',[oldPair.candidate_id,oldPair.employee_id,'SamePerson','Legacy wrapper cannot overwrite a review',oldPair.candidate_fingerprint,oldPair.employee_fingerprint]),'40001');
  await db.exec('reset role');await db.exec('begin');
  await db.exec("update hr_records set data=data||'{\"remarks\":\"Source gate test\"}' where record_id='duplicate'");
  assert.equal((await db.query("select count(*)::int count from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted")).rows[0].count,1);
  await db.query('insert into hr_records values($1,$2,$3,$4)',[other,'employees','other-tenant-source',{id:'other-tenant-source',name:'OTHER TENANT SYNTHETIC'}]);
  assert.equal((await db.query("select count(*)::int count from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted")).rows[0].count,2);
  await db.exec('rollback');await db.exec('reset role');await db.exec('begin');
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'leaves','unrelated-lock-fixture',{id:'unrelated-lock-fixture'}]);
  assert.equal((await db.query("select count(*)::int count from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted")).rows[0].count,0);
  await db.exec('rollback');await db.exec('reset role');await db.exec('begin isolation level repeatable read');
  await denied(()=>db.exec("update hr_records set data=data||'{\"remarks\":\"Stale snapshot\"}' where record_id='duplicate'"),'25000');
  await db.exec('rollback;begin isolation level repeatable read;set local role authenticated');
  await denied(()=>reserve('stale-snapshot',[]),'25000');await db.exec('rollback');await db.exec('reset role');
  await db.exec('begin isolation level serializable');
  await db.exec("update hr_records set data=data||'{\"remarks\":\"Serializable source write\"}' where record_id='duplicate'");
  await db.exec('rollback');
  await denied(()=>db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'oncall','conflicting-oncall',{employeeId:'confirm-worker-0'}]),'23514');
  await denied(()=>db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'oncall','conflicting-name-oncall',{employeeName:'ALVAREZ CLARISSE TAMAYO'}]),'23514');
  await denied(()=>db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'manpowerSlots','conflicting-slot',{requestId:'unrelated-legacy',candidateId:'confirm-0'}]),'23514');
  await db.exec('begin');
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'oncall','replacement-target-only',{employeeName:'UNRELATED REPLACEMENT PERSON',employeeReplaced:'ALVAREZ CLARISSE TAMAYO'}]);
  await db.exec('rollback');
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_source_interlock.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  console.log('Source interlock rehearsal passed: private body/helper denial, source-only transaction lock, repeatable-read rejection, legacy slot/on-call conflicts and replaced-person distinction. Wrapped reservation, identity, schedule and confirmation behavior passes; independent connections, deadlock/retry UX and live baseline remain unverified.');
}
if(process.argv.includes('--handoff')){
  if(!interlock)throw new Error('Handoff rehearsal requires --interlock');
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../../supabase/proposals/0048_manpower_employee_handoff.sql',import.meta.url),'utf8'));
  const candidate={id:'handoff-candidate',name:'XAVIER AMELIA SUNSTONE',department:'Production',stage:'Ready to Hire',recommendation:'Hire',
    proposedStartDate:'2026-10-10',birthDate:'1998-06-14',gender:'Female',checklist:{privacyNotice:true,interview:true,offer:true,contract:true,standards:true}};
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'onboardingCandidates',candidate.id,candidate]);
  const separate={id:'handoff-separate-worker',employeeNo:'EMP-900002',name:candidate.name,department:'Production',status:'Active'};
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'employees',separate.id,separate]);
  await db.exec('set role authenticated');await request('handoff',1);
  const separatePair=(await db.query('select preview_manpower_identity_review($1,$2) result',[candidate.id,separate.id])).rows[0].result;
  await db.query('select record_manpower_identity_review($1,$2,$3,$4,$5,$6,0)',[candidate.id,separate.id,'SeparatePersons','Reviewed same-name but separate synthetic employee',separatePair.candidate_fingerprint,separatePair.employee_fingerprint]);
  const reserved=await reserve('handoff-reserve',[{candidate_id:candidate.id,line_id:'handoff-line',hiring_category:'New Hire'}]);
  // Imported/directly-created employee exists before this transaction; no master creation is claimed.
  const employee={id:'handoff-worker',employeeNo:'EMP-900001',name:candidate.name,department:'Production',status:'Active',sourceCandidateId:'earlier-applicant'};
  await db.exec('reset role');await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'employees',employee.id,employee]);await db.exec('set role authenticated');
  const preview=async()=>(await db.query('select preview_manpower_identity_review($1,$2) result',[candidate.id,employee.id])).rows[0].result;
  const initial=await preview();
  const handoff=async(token,pair=initial,reason='HR verified this is the same existing employee')=>
    (await db.query('select handoff_manpower_employee($1,$2,$3,$4,$5,$6,$7) result',[token,pair.candidate_id,pair.employee_id,pair.candidate_fingerprint,pair.employee_fingerprint,reason,pair.review_revision])).rows[0].result;
  const counters=async()=>(await db.query("select manpower_line_capacity('handoff-line') result")).rows[0].result;
  for(const permission of ['onboarding.review_identity','onboarding.view','onboarding.update','employees.view','manpower.view']){
    await db.query('select set_config($1,$2,false)',['test.denied',permission]);await denied(()=>handoff('denied-handoff'),'42501');
  }
  await db.exec("set test.denied='';set test.scope='Other'");await denied(()=>handoff('scope-handoff'),'42501');
  await db.exec(`set test.scope='global';set test.tenant='${other}'`);await denied(()=>handoff('tenant-handoff'),'42501');await db.exec(`set test.tenant='${tenant}'`);
  await denied(()=>handoff('missing-reason',initial,''),'23514');
  await denied(()=>handoff('stale-preview',{...initial,candidate_fingerprint:'stale'}),'40001');
  await denied(()=>handoff('stale-review',{...initial,review_revision:1}),'40001');
  await db.exec('reset role');
  await db.query('insert into hr_records values($1,$2,$3,$4)',[tenant,'employees','handoff-unknown-duplicate',{id:'handoff-unknown-duplicate',employeeNo:'EMP-900003',name:candidate.name,department:'Production'}]);
  await db.exec('set role authenticated');await denied(()=>handoff('unknown-duplicate-handoff'),'23514');
  await db.exec("reset role;delete from hr_records where record_id='handoff-unknown-duplicate';update hr_records set data=jsonb_set(data,'{birthDate}','\"2998-06-14\"') where record_id='handoff-candidate';set role authenticated");
  await denied(async()=>handoff('invalid-date-handoff',await preview()),'23514');
  await db.exec("reset role;update hr_records set data=jsonb_set(data,'{birthDate}','\"1998-06-14\"') where record_id='handoff-candidate';set role authenticated");
  await db.exec("reset role;update hr_records set data=jsonb_set(data,'{checklist,contract}','false') where record_id='handoff-candidate';set role authenticated");
  await denied(async()=>handoff('not-ready',await preview()),'23514');
  await db.exec("reset role;update hr_records set data=jsonb_set(data,'{checklist,contract}','true') where record_id='handoff-candidate';alter table hr_audit_logs add constraint fail_handoff check(action not like '%Reason: handoff audit failure') not valid;set role authenticated");
  await denied(async()=>handoff('audit-failure-handoff',await preview(),'handoff audit failure'),'23514');
  assert.equal((await counters()).reserved,1);assert.equal((await counters()).fulfilled,0);
  const identityBefore=await preview();assert.equal(identityBefore.review_revision,0);
  await db.exec('reset role');
  await db.exec("alter table manpower_private.handoff_batches add constraint fail_handoff_late check(token<>'late-handoff-failure') not valid;set role authenticated");
  await denied(()=>handoff('late-handoff-failure',identityBefore),'23514');
  assert.equal((await preview()).review_revision,0);
  assert.equal((await db.query('select data from hr_records where record_id=$1',[candidate.id])).rows[0].data.stage,'Ready to Hire');
  assert.equal((await db.query('select employee_id from hr_manpower_reservations where id=$1',[reserved.reservation_ids[0]])).rows[0].employee_id,null);
  const result=await handoff('successful-handoff',identityBefore);assert.equal(result.replayed,false);assert.equal(result.reservation_id,reserved.reservation_ids[0]);
  assert.equal((await counters()).reserved,1);assert.equal((await counters()).fulfilled,0);assert.equal((await counters()).available,0);
  assert.equal((await db.query('select data from hr_records where record_id=$1',[candidate.id])).rows[0].data.employeeRecordId,employee.id);
  assert.deepEqual((await db.query('select data from hr_records where record_id=$1',[employee.id])).rows[0].data,employee);
  assert.equal((await handoff('successful-handoff',identityBefore)).replayed,true);
  await denied(()=>handoff('successful-handoff',identityBefore,'Different facts'),'23514');
  const current=await preview();assert.equal(current.review_revision,1);assert.equal(current.source_changed,false);
  const refreshedSeparate=(await db.query('select preview_manpower_identity_review($1,$2) result',[candidate.id,separate.id])).rows[0].result;
  assert.equal(refreshedSeparate.review_revision,2);assert.equal(refreshedSeparate.previous_decision,'SeparatePersons');assert.equal(refreshedSeparate.source_changed,false);
  await db.exec('reset role');
  assert.equal((await db.query('select * from manpower_private.source_intents')).rows.length,0);
  assert.equal((await db.query('select * from hr_manpower_reservation_intents')).rows.length,0);
  await denied(()=>db.exec("update hr_records set data=data||'{\"employeeRecordId\":\"bypass\"}' where record_id='handoff-candidate'"),'23514');
  await db.exec('set role authenticated');
  await denied(()=>db.exec('select * from manpower_private.handoff_batches'),'42501');
  await db.query('select confirm_manpower_deployments($1,$2)',['handoff-actual',[{reservation_id:result.reservation_id,schedule_revision:0,actual_date:'2026-10-10',reason:'Actual reporting explicitly confirmed after handoff'}]]);
  assert.equal((await counters()).reserved,0);assert.equal((await counters()).fulfilled,1);
  assert.equal((await handoff('successful-handoff',identityBefore)).replayed,true);
  await denied(async()=>handoff('new-handoff-after-deployment',await preview()),'23514');
  await db.exec('reset role');
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_handoff_integrity.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  await db.exec('set role anon');await denied(()=>handoff('anonymous-handoff'),'42501');
  console.log('Existing-master handoff rehearsal passed: scoped HR identity approval, readiness/stale preview checks, source and assignment exact intents, stable reservation/capacity, unchanged employee master/prior source reference, idempotent retry, audit and final-row rollback, and explicit later actual confirmation. New-master creation and historical/alias correction remain incomplete.');
}
if(process.argv.includes('--addresses')){
  if(!interlock)throw new Error('Address rehearsal requires --interlock');
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../../supabase/proposals/0049_manpower_address_validation.sql',import.meta.url),'utf8'));
  const catalog=readPhilippineAddressCatalog(),byCode=new Map(catalog.rows.map(row=>[row.code,row]));
  const validate=async(value)=>(await db.query('select manpower_private.validate_employee_address($1) address',[JSON.stringify(value)])).rows[0].address;
  const addressFor=code=>{
    const barangay=byCode.get(code),city=byCode.get(barangay.parent_code),parent=byCode.get(city.parent_code);
    const province=parent.kind==='province'?parent:null,region=province?byCode.get(province.parent_code):parent;
    return {regionCode:region.code,regionName:region.name,provinceCode:province?.code||'',provinceName:province?.name||'',
      cityCode:city.code,cityName:city.name,barangayCode:barangay.code,barangayName:barangay.name,addressLine:'Unit 2, Synthetic Address',zipCode:city.zip};
  };
  const address=addressFor('1130700002');
  assert.equal((await validate({})).formattedAddress,'');
  assert.equal((await validate('Complete imported address, later review')).addressLine,'Complete imported address, later review');
  await denied(()=>validate(address),'23514');
  try{await db.exec(addressCatalogSeedSQL(catalog));}catch(error){throw new Error('Address seed failed: '+error.code+' '+error.message);}
  assert.equal((await db.query('select count(*)::int count from manpower_private.address_locations')).rows[0].count,catalog.rows.length);
  assert.equal((await db.query('select sha256 from manpower_private.address_catalog_manifest')).rows[0].sha256,catalog.sha256);
  const normalized=await validate({...address,cityName:address.cityName.toLowerCase(),formattedAddress:'Untrusted display text'});
  assert.equal(normalized.cityName,address.cityName);assert.equal(normalized.barangayName,'Agdao');assert.ok(!normalized.formattedAddress.includes('Untrusted'));
  for(const changes of [{regionName:'Unknown region'},{provinceCode:'1400100000'},{cityCode:'0000000000'},
    {barangayCode:'0000000001'},{barangayName:'Unknown barangay'},{zipCode:'9999'},{regionCode:''},{barangayCode:123},
    {regionName:'Unknown region',legacy:true},{legacy:'true'},{unknownField:'Not an address field'}])await denied(()=>validate({...address,...changes}),'23514');
  const ncrBarangay=catalog.rows.find(row=>row.kind==='barangay'&&byCode.get(row.parent_code).parent_code==='1300000000');
  const ncr=addressFor(ncrBarangay.code);assert.equal((await validate(ncr)).provinceCode,'');
  await denied(()=>validate({...ncr,provinceCode:'1102400000',provinceName:'Davao del Sur'}),'23514');
  await denied(()=>db.exec("update manpower_private.address_locations set name='Rewrite' where code='1130700002'"),'23514');
  for(const check of await db.exec(readFileSync(new URL('../../supabase/verification/manpower_address_catalog.sql',import.meta.url),'utf8')))
    assert.equal(check.rows.length,0);
  await db.exec('set role authenticated');await denied(()=>validate(address),'42501');
  await denied(()=>db.exec('select * from manpower_private.address_locations'),'42501');
  console.log('Authoritative address database rehearsal passed: complete reference seed, optional/free-text addresses, region/province/city/barangay hierarchy and names, NCR without province, known ZIP, forged legacy/display data, private access and immutable catalog. Atomic new employee creation remains incomplete.');
}
await db.close();console.log('Reservation PostgreSQL rehearsal passed: 75-worker atomic batch, ineligible/capacity/duplicate rollback, bounded real assignments for 1000 demand, role/scope/tenant denial, order-independent idempotent replay, worker uniqueness, authoritative capacity and audit-failure rollback. Production and independent concurrency remain unverified.');
