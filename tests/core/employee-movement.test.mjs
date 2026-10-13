import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {employmentValidation} from '../../js/core/employment.js';

const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const statusSave=source.slice(source.indexOf('async function saveEmployeeStatus('),source.indexOf('async function exportEmployeesCSV('));
function context(saveResult=true){
  const employee={id:'synthetic',name:'Synthetic Employee',status:'Active',statusReason:'Active / Normal',employmentType:'Project-Based',dateHired:'2025-01-01',employmentHistory:[]};
  const values={es_status:'Inactive',es_reason:'Suspended',lc_date:'2026-10-13',lc_remarks:'Synthetic HR reference',lc_exit_class:'',lc_exit_factor:'',lc_exit_reason:''};
  const messages=[];
  const scope={DB:{employees:[employee]},canEdit:()=>true,document:{getElementById:id=>id in values?{value:values[id]}:null},employmentValidation,todayISO:()=> '2026-10-13',SESSION:{fullName:'Synthetic HR'},appendEmployeeRecordHistory:()=>{},saveDB:async()=>saveResult,logAudit:()=>{},closeModal:async()=>{},renderNav:()=>{},renderEmployeeOrigin:async()=>{},openEmployeeProfile:async()=>{},employeeDisplayName:record=>record.name,toast:message=>messages.push(message)};
  return {employee,values,messages,save:runInNewContext(statusSave+'\nsaveEmployeeStatus',scope)};
}
test('Movement status change preserves validated status history and contract type',async()=>{
  const c=context();await c.save('synthetic');
  assert.equal(c.employee.status,'Inactive');assert.equal(c.employee.statusReason,'Suspended');
  assert.equal(c.employee.employmentType,'Project-Based');assert.equal(c.employee.employmentHistory.length,1);
  assert.equal(c.employee.employmentHistory[0].type,'Employment Status');assert.equal(c.employee.employmentHistory[0].remarks,'Synthetic HR reference');
});
test('Movement refuses separation without leaving details and rolls back failed saves',async()=>{
  const c=context();c.values.es_status='Separated';c.values.es_reason='Resigned';await c.save('synthetic');
  assert.equal(c.employee.status,'Active');assert.match(c.messages.join(' '),/leaving classification/);
  const failed=context(false);await failed.save('synthetic');assert.equal(failed.employee.status,'Active');assert.equal(failed.employee.employmentHistory.length,0);
});
test('Movement rejects future status dates and incompatible reasons',async()=>{
  const future=context();future.values.lc_date='2026-10-14';await future.save('synthetic');assert.equal(future.employee.status,'Active');assert.ok(future.messages.length);
  const invalid=context();invalid.values.es_reason='Resigned';await invalid.save('synthetic');assert.equal(invalid.employee.status,'Active');assert.ok(invalid.messages.length);
});
test('Legacy Status entry redirects to Movement while career events remain available',()=>{
  assert.match(source,/function openEmployeeStatusForm\(id\)\{\s*return openEmployeeLifecycleEventForm\(id,'Employment Status Change'\)/);
  assert.match(source,/if\(eventType==='Employment Status Change'\)\{\s*return saveEmployeeStatus\(id\)/);
  for(const event of ['Regularization','Promotion / Position Change','Return to Work','Resignation','Separation','Rehire','Return to Agency'])assert.ok(source.includes(event));
});
