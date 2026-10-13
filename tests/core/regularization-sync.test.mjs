import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {regularizationWorkItems} from '../../js/core/regularization.js';
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const sync=app.slice(app.indexOf('let REGULARIZATION_SYNC='),app.indexOf('function classify(emp)'));
function fixture({allowed=true,error=null,dirty=false}={}){
  const employee={id:'synthetic',dateHired:'2026-04-13',status:'Active',employmentType:'Probationary'},saved={...employee,employmentType:'Regular / Permanent'};
  let calls=0,invalidations=0;
  const context={SESSION:{id:'actor'},DB:{employees:[employee]},DB_SNAPSHOT:{employees:[{...employee}]},hasPermission:()=>allowed,
    modalHasUnsavedChanges:()=>dirty,pageHasUnsavedChanges:()=>false,regularizationWorkItems,regularizationToday:()=> '2026-10-13',
    recordFromRow:row=>row.data,normalizeEmployment:data=>data,toast:()=>{},invalidateEmployeeDirectoryCache:()=>invalidations++,EMPLOYEE_PROFILE_CACHE:new Map(),
    supabase:{rpc:async()=>{calls++;return {data:error?null:[{record_id:'synthetic',data:saved}],error};}}};
  vm.createContext(context);vm.runInContext(sync,context);return {context,employee,calls:()=>calls,invalidations:()=>invalidations};
}
test('regularization sync persists server results into current records and snapshots once',async()=>{
  const f=fixture();await Promise.all([f.context.syncAutomaticRegularization(),f.context.syncAutomaticRegularization()]);
  assert.equal(f.calls(),1);assert.equal(f.employee.employmentType,'Regular / Permanent');assert.equal(f.context.DB_SNAPSHOT.employees[0].employmentType,'Regular / Permanent');assert.equal(f.invalidations(),1);
});
test('denied, dirty or unavailable sessions never pretend an employee was regularized',async()=>{
  for(const options of [{allowed:false},{dirty:true},{error:{code:'PGRST202'}}]){
    const f=fixture(options);await f.context.syncAutomaticRegularization();assert.equal(f.employee.employmentType,'Probationary');assert.equal(f.invalidations(),0);
    if(!options.error)assert.equal(f.calls(),0);
  }
});
test('Action Center and bell notifications link regularization records to the employee workspace',()=>{
  assert.match(app,/regularizationAlerts\(\)\.forEach\(item=>items.push\(notificationItem/);
  assert.match(app,/items.push\(\.\.\.regularizationAlerts\(\)\.map/);
  assert.match(app,/if\(view==='employees'&&id\)\{await go\('employees'\);await openEmployeeProfile\(id\)/);
});
test('an edit started during server processing is not overwritten by the response',async()=>{
  const f=fixture(),pending=f.context.syncAutomaticRegularization();
  f.context.modalHasUnsavedChanges=()=>true;await pending;
  assert.equal(f.calls(),1);assert.equal(f.employee.employmentType,'Probationary');assert.equal(f.invalidations(),0);
});
