import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {GOVERNMENT_IDS,governmentIdKey,employeeGovernmentIdIssues,governmentIdConflictIssue} from '../../js/core/government-ids.js';

test('each government ID rejects formatting variants, preserving leading zeroes',()=>{
  for(const {key,label} of GOVERNMENT_IDS){
    const other={id:'synthetic-other',[key]:'00-0001-2345'};
    const issues=employeeGovernmentIdIssues({[key]:' 00 0001 2345 '},[other]);
    assert.equal(issues.length,1);assert.equal(issues[0].id,'f_'+key);
    assert.ok(issues[0].message.includes(label));assert.ok(!issues[0].message.includes(other[key]));
    assert.equal(governmentIdKey(key,'0000012345').startsWith('00000'),true);
  }
});

test('blank IDs, own record edits and different ID types do not conflict',()=>{
  for(const value of ['',null,undefined,' - '])assert.deepEqual(employeeGovernmentIdIssues({sssNumber:value},[{sssNumber:value}]),[]);
  assert.deepEqual(employeeGovernmentIdIssues({sssNumber:'0000012345'},[{id:7,sssNumber:'00-0001234-5'}],'7'),[]);
  assert.deepEqual(employeeGovernmentIdIssues({pagIbigNumber:'000000012345'},[{id:'synthetic',philHealthNumber:'000000012345'}]),[]);
  assert.deepEqual(employeeGovernmentIdIssues({sssNumber:'0000012346'},[{sssNumber:'0000012345'}]),[]);
});

test('TIN branch suffixes cannot bypass the nine-digit identity',()=>{
  for(const value of ['000-001-234','000-001-234-000','000001234999']){
    assert.equal(employeeGovernmentIdIssues({tin:value},[{tin:'000001234001'}]).length,1);
  }
});

test('database government ID violations return field errors without record details',()=>{
  for(const field of GOVERNMENT_IDS){
    const issue=governmentIdConflictIssue({code:'23505',message:`duplicate key value violates unique constraint "${field.index}"`,details:'confidential value'});
    assert.equal(issue.id,'f_'+field.key);assert.ok(!issue.message.includes('confidential'));
  }
  assert.equal(governmentIdConflictIssue({code:'23505',message:'another unique constraint'}),null);
  assert.equal(governmentIdConflictIssue({code:'42501',constraint:GOVERNMENT_IDS[0].index}),null);
});


const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('function '+name+'(');return source.slice(start,source.indexOf('\n}\n',start)+3);};
test('database conflict feedback uses the field association and retains safe messages',async()=>{
  const messages=[],errors=[];
  const c={governmentIdConflictIssue,DB:{employees:[]},LOADED_RECORD_MODULES:new Set(['employees']),SAVE_QUEUE:Promise.resolve(),
    saveDBInternal:async()=>{throw {code:'23505',message:'duplicate key value violates unique constraint "hr_records_employee_sss_unique_idx"',details:'private ID'};},
    document:{getElementById:()=>({})},showModalFieldErrors:issues=>errors.push(...issues),toast:message=>messages.push(message)};
  vm.createContext(c);vm.runInContext(extract('saveDB'),c);
  assert.equal(await c.saveDB(),false);assert.equal(errors[0].id,'f_sssNumber');
  assert.match(messages[0],/SSS Number already belongs/);assert.ok(!messages[0].includes('private ID'));
});

test('onboarding conversion blocks an existing employee ID before mutating either record',async()=>{
  const candidate={id:'synthetic-candidate',sssNumber:'00-0001234-5'},messages=[];
  const c={employeeGovernmentIdIssues,EMPLOYMENT_TYPES:['Probationary'],SESSION:{id:'synthetic-actor',fullName:'Synthetic HR'},
    DB:{onboardingCandidates:[candidate],employees:[{id:'synthetic-existing',sssNumber:'0000012345'}]},
    document:{getElementById:id=>({value:({oh_employment_type:'Probationary',oh_branch:'Synthetic Branch',oh_daily_rate:''})[id]})},
    onboardingHireBlockers:()=>[],readEmployeeAllowances:()=>({}),readAddressComponent:async()=>({valid:true,address:{}}),
    formatPhilippineAddress:()=>'',uid:()=> 'synthetic-new',nextEmployeeNumber:()=> 'EMP-000002',formatEmployeeName:()=> 'Synthetic Employee',
    toast:message=>messages.push(message),saveDB:()=>assert.fail('Duplicate conversion must not save')};
  vm.createContext(c);vm.runInContext('async '+extract('convertOnboardingCandidate'),c);
  await c.convertOnboardingCandidate(candidate.id);
  assert.equal(c.DB.employees.length,1);assert.equal(candidate.employeeRecordId,undefined);assert.match(messages[0],/SSS Number already belongs/);
});
