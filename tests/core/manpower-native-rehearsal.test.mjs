import test from 'node:test';
import assert from 'node:assert/strict';
import {openRehearsalDatabase} from '../database/rehearsal-database.mjs';

test('native rehearsal rejects unsafe targets before importing a driver or connecting',async()=>{
  const oldURL=process.env.HRIS_REHEARSAL_DATABASE_URL,oldAllowed=process.env.HRIS_NATIVE_REHEARSAL_ALLOWED;
  try{
    process.env.HRIS_NATIVE_REHEARSAL_ALLOWED='synthetic-only';
    for(const url of [
      'postgresql://hris_rehearsal@external.invalid:65439/hris_rehearsal_test',
      'postgresql://hris_rehearsal@127.0.0.1:5432/hris_rehearsal_test',
      'postgresql://hris_rehearsal@127.0.0.1:65439/production',
      'postgresql://postgres@127.0.0.1:65439/hris_rehearsal_test',
      'postgresql://hris_rehearsal:secret@127.0.0.1:65439/hris_rehearsal_test',
      'postgresql://hris_rehearsal@127.0.0.1:65439/hris_rehearsal_test?sslmode=require'
    ]){
      process.env.HRIS_REHEARSAL_DATABASE_URL=url;
      await assert.rejects(openRehearsalDatabase(),/explicitly permitted, isolated loopback test cluster/);
    }
    process.env.HRIS_REHEARSAL_DATABASE_URL='postgresql://hris_rehearsal@127.0.0.1:65439/hris_rehearsal_test';
    delete process.env.HRIS_NATIVE_REHEARSAL_ALLOWED;
    await assert.rejects(openRehearsalDatabase(),/explicitly permitted, isolated loopback test cluster/);
  }finally{
    if(oldURL===undefined)delete process.env.HRIS_REHEARSAL_DATABASE_URL;else process.env.HRIS_REHEARSAL_DATABASE_URL=oldURL;
    if(oldAllowed===undefined)delete process.env.HRIS_NATIVE_REHEARSAL_ALLOWED;else process.env.HRIS_NATIVE_REHEARSAL_ALLOWED=oldAllowed;
  }
});
