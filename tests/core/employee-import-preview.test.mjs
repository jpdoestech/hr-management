import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {filterEmployeeImportRows,revalidateEmployeeImport,employeeImportCorrection,employeeImportPreviewHTML} from '../../js/core/employee-import-preview.js';
const row=(rowNumber,errors=[],warnings=[])=>({rowNumber,values:{name:'Synthetic employee'},errors,warnings});
test('Ready, Errors and Warnings filter independently without changing the batch',()=>{
  const rows=[row(2),row(3,['Error']),row(4,[],['Warning']),row(5,['Error'],['Warning'])];
  assert.deepEqual(filterEmployeeImportRows(rows,'ready').map(r=>r.rowNumber),[2,4]);
  assert.deepEqual(filterEmployeeImportRows(rows,'errors').map(r=>r.rowNumber),[3,5]);
  assert.deepEqual(filterEmployeeImportRows(rows,'warnings').map(r=>r.rowNumber),[4,5]);
  assert.equal(filterEmployeeImportRows(rows).length,4);assert.equal(rows.length,4);
});
test('corrections retain untouched invalid source data and support clearing allowances',()=>{
  const original={sourceValues:{birthDate:'invalid date',dailyRate:'not a number',firstName:'Old',allowances:{Meal:100}}};
  const result=employeeImportCorrection(original,{birthDate:'',dailyRate:'',firstName:'New',allowances:{}},{birthDate:'',dailyRate:'',firstName:'Old',allowances:{Meal:100}});
  assert.equal(result.birthDate,'invalid date');assert.equal(result.dailyRate,'not a number');assert.equal(result.firstName,'New');
  assert.equal(result['allowance:Meal'],'');assert.deepEqual(result.allowances,{});assert.equal(original.sourceValues.firstName,'Old');
});
test('revalidation revisits every row including filtered-out duplicates and retains addresses/allowances',()=>{
  const preview={filter:'errors',rows:[{...row(2),sourceValues:{employeeNo:'EMP-000001',homeAddress:{street:'Synthetic street'},allowances:{Meal:50}}},{...row(3,['Duplicate']),sourceValues:{employeeNo:'EMP-000001'}}]};
  const validate=(values,number,accepted)=>({...row(number,accepted.some(r=>r.employeeNo===values.employeeNo)?['Duplicate']:[]),values:{employeeNo:values.employeeNo,meal:values['allowance:Meal']}});
  revalidateEmployeeImport(preview,validate);assert.equal(preview.rows[1].errors.length,1);assert.equal(preview.rows[0].values.meal,50);assert.deepEqual(preview.rows[0].values.homeAddress,{street:'Synthetic street'});
  preview.rows[0].sourceValues.employeeNo='EMP-000002';revalidateEmployeeImport(preview,validate);
  assert.equal(preview.rows[1].errors.length,0);assert.equal(preview.filter,'errors');assert.equal(preview.rows.length,2);
});
test('preview controls are keyboard buttons and warn even when the same row has errors',()=>{
  const preview={filter:'warnings',fileErrors:[],rows:[row(2,['Error'],['Warning'])]};
  const html=employeeImportPreviewHTML(preview,{valid:0,errors:1,warnings:1,total:1},String);
  assert.match(html,/aria-pressed="true" onclick="filterEmployeeImport\('warnings'\)"/);
  assert.match(html,/aria-label="Edit import row 2/);assert.match(html,/import-issues error/);assert.match(html,/import-issues warning/);
});
test('import row editor reuses employee form and never invokes employee persistence',()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const editor=app.slice(app.indexOf('async function openEmployeeImportRow('),app.indexOf('async function commitEmployeeImport('));
  assert.match(editor,/employeeFormSectionsHTML\(record,\{importRow:true\}\)/);
  assert.doesNotMatch(editor,/saveDB\(|saveEmployee\(|DB\.employees\.push/);
  assert.match(app,/if\(document\.getElementById\('employee_import_edit'\)\)\{await returnEmployeeImportPreview\(\);return;\}/);
});
test('save corrections cannot run after permission loss or against another import',async()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const fn=app.slice(app.indexOf('async function saveEmployeeImportRow('),app.indexOf('async function commitEmployeeImport('));
  let reads=0;
  const preview={},context={preview,sessionId:'actor',busy:false};
  const sandbox={EMPLOYEE_IMPORT_EDIT:context,EMPLOYEE_IMPORT_PREVIEW:preview,SESSION:{id:'actor'},requireEmployeeImportAdmin:()=>false,document:{getElementById:()=>{throw new Error('Should not read DOM');}},readFields:()=>reads++};
  vm.createContext(sandbox);vm.runInContext(fn,sandbox);await sandbox.saveEmployeeImportRow();assert.equal(reads,0);
  sandbox.requireEmployeeImportAdmin=()=>true;sandbox.EMPLOYEE_IMPORT_PREVIEW={};await sandbox.saveEmployeeImportRow();assert.equal(reads,0);
});

test('shared unsaved-change flow returns to preview only on discard or successful save',async()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const fn=app.slice(app.indexOf('async function requestCloseModal('),app.indexOf('function enhanceModalHeader('));
  let returns=0,saves=0,choice='cancel';
  const saveButton={isConnected:true,click:()=>saves++};
  const sandbox={document:{getElementById:id=>id==='employee_import_edit'?{}:null},EMPLOYEE_IMPORT_EDIT:{busy:false},
    modalHasUnsavedChanges:()=>true,confirmDataChange:async()=>choice,returnEmployeeImportPreview:async()=>returns++,
    MODAL_EDIT_STATE:{saveButton},CONFIRMED_CHANGE_TARGETS:new Set()};
  vm.createContext(sandbox);vm.runInContext(fn,sandbox);
  await sandbox.requestCloseModal();assert.equal(returns,0);assert.equal(saves,0);
  choice='discard';await sandbox.requestCloseModal();assert.equal(returns,1);assert.equal(saves,0);
  choice='confirm';await sandbox.requestCloseModal();assert.equal(returns,1);assert.equal(saves,1);
  assert.equal(sandbox.CONFIRMED_CHANGE_TARGETS.has(saveButton),true);
  sandbox.EMPLOYEE_IMPORT_EDIT.busy=true;await sandbox.requestCloseModal();assert.equal(saves,1);
});

test('applying corrections validates addresses and revalidates drafts without database writes',async()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const fn=app.slice(app.indexOf('async function saveEmployeeImportRow('),app.indexOf('async function commitEmployeeImport('));
  const preview={rows:[{...row(2),sourceValues:{firstName:'Old'}}]},context={preview,sessionId:'actor',busy:false,rowNumber:2,baseline:{firstName:'Old',allowances:{}}};
  let valid=false,returns=0,validated=0,focused=0;
  const errorBox={textContent:'',focus:()=>focused++,isConnected:true};
  const sandbox={EMPLOYEE_IMPORT_EDIT:context,EMPLOYEE_IMPORT_PREVIEW:preview,SESSION:{id:'actor'},requireEmployeeImportAdmin:()=>true,
    EMP_FIELDS:[],document:{getElementById:()=>errorBox},readFields:()=>({firstName:'New'}),readEmployeeAllowances:()=>({}),
    readAddressComponent:async()=>({valid,message:'Choose a valid location',address:{street:'Synthetic street'}}),formatPhilippineAddress:address=>address.street,
    employeeImportCorrection,revalidateEmployeeImport,validateEmployeeImportRow:(values,number)=>{validated++;return {...row(number),values};},
    returnEmployeeImportPreview:async()=>returns++,toast:()=>{}};
  vm.createContext(sandbox);vm.runInContext(fn,sandbox);
  await sandbox.saveEmployeeImportRow();assert.equal(validated,0);assert.equal(returns,0);assert.equal(focused,1);assert.equal(context.busy,false);
  valid=true;await sandbox.saveEmployeeImportRow();assert.equal(validated,1);assert.equal(returns,1);
  assert.equal(preview.rows[0].values.firstName,'New');assert.equal(preview.rows[0].values.homeAddress.street,'Synthetic street');
  assert.equal(context.busy,false);
});
