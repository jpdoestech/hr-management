import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const extract=(name,async=false)=>{const start=source.indexOf(`${async?'async ':''}function ${name}(`);return source.slice(start,source.indexOf('\n}\n',start)+3);};
const sections=source.slice(source.indexOf('const EMP_FORM_SECTIONS = ['),source.indexOf('function employeeFormFieldValue('));
function setup({allowed=true,saved=true,valid=true,index=1}={}){
  const employee={id:'synthetic',name:'Synthetic Employee',department:'Legacy Department',position:'Legacy Position',employmentType:'Legacy Contract',status:'Active',homeAddress:{unresolvedText:'Synthetic original address'},dailyRate:0,sssNumber:'Legacy identifier',emergencyContactName:'Before',emergencyContactRelationship:'Parent',emergencyContactPhone:'Synthetic old phone',allowances:{Meal:50},recordHistory:[],employmentHistory:[]};
  const before=structuredClone(employee),messages=[];let saves=0;
  const values={emergencyContactName:'Synthetic New Contact',emergencyContactRelationship:'Sibling',emergencyContactPhone:'Synthetic new phone',dailyRate:'0'};
  const fields=[...Object.keys(values), 'department','status','sssNumber'].map(key=>({key,label:key}));
  const context={EMPLOYEE_SECTION_EDIT:{employeeId:'synthetic',index,busy:false},EMP_FIELDS:fields,DB:{employees:[employee]},REVIEW_TYPE:'Needs HR Review',SESSION:{id:'synthetic-actor',fullName:'Synthetic HR'},hasPermission:()=>allowed,showModalFieldErrors:issues=>messages.push(issues),readFields:fields=>Object.fromEntries(fields.map(field=>[field.key,values[field.key]||''])),document:{getElementById:()=>({checkValidity:()=>valid})},toast:message=>messages.push(message),recordStoragePaths:()=>new Set(),updateEmployeeNameReferences:()=>[],restoreEmployeeNameReferences(){},saveDB:async()=>{saves++;return saved;},normalizeEmployeeName:value=>value.toLowerCase(),logAudit(){},rememberCommittedRecordFiles(){},deleteStorageObjects:async()=>{},closeModal:async()=>{},renderNav(){},renderEmployeeOrigin:async()=>{},selectEmployeeDirectoryRow(){},openEmployeeProfile:async()=>{},readAddressComponent(){assert.fail('Unrelated addresses must not be read');}};
  vm.createContext(context);vm.runInContext(sections+extract('appendEmployeeRecordHistory')+extract('saveEmployeeSection',true)+extract('persistEmployeeEdit',true),context);
  return {employee,before,messages,save:()=>context.saveEmployeeSection('synthetic',index),saveFull:values=>context.persistEmployeeEdit({...employee,...values},'synthetic'),get saves(){return saves;}};
}
test('Emergency Information saves only contact fields and records the change',async()=>{
  const c=setup();await c.save();assert.equal(c.saves,1);
  assert.equal(c.employee.emergencyContactName,'Synthetic New Contact');
  for(const key of ['department','position','employmentType','status','homeAddress','dailyRate','sssNumber','allowances','employmentHistory'])assert.equal(JSON.stringify(c.employee[key]),JSON.stringify(c.before[key]),key);
  assert.equal(c.employee.recordHistory.length,1);assert.match(c.employee.recordHistory[0].detail,/emergencyContact/);
  assert.equal(Object.hasOwn(c.employee,'employmentTypeNeedsReview'),false);
});
test('failed section persistence restores the complete employee record',async()=>{
  const c=setup({saved:false});await c.save();assert.equal(c.saves,1);assert.equal(JSON.stringify(c.employee),JSON.stringify(c.before));
});
test('read-only and invalid section edits never persist',async()=>{
  for(const options of [{allowed:false},{valid:false}]){const c=setup(options);await c.save();assert.equal(c.saves,0);assert.equal(JSON.stringify(c.employee),JSON.stringify(c.before));}
});
test('zero compensation is recorded without changing other sections',async()=>{
  const c=setup({index:4});await c.save();assert.equal(c.saves,1);assert.equal(c.employee.dailyRate,0);assert.equal(c.employee.emergencyContactName,c.before.emergencyContactName);
});
test('full employee edits retain the shared persistence path',async()=>{
  const c=setup();await c.saveFull({department:'Updated Synthetic Department',dailyRate:250});
  assert.equal(c.saves,1);assert.equal(c.employee.department,'Updated Synthetic Department');assert.equal(c.employee.dailyRate,250);assert.equal(c.employee.recordHistory.length,1);
});
