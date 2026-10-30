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
  console.log('Government ID SQL rehearsal passed: migration rollback, four unique indexes, blanks, normalization parity, self updates, tenant/type isolation, update conflicts and atomic batch rejection.');
}finally{await db.close();}
