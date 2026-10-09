import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EMPLOYMENT_TYPES,EMPLOYMENT_STATUSES,STATUS_REASONS,REVIEW_TYPE} from '../../js/core/employment.js';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
export function employmentFormPreview(record=null){
  const scope={EMPLOYMENT_TYPES,EMP_STATUS:EMPLOYMENT_STATUSES,STATUS_REASONS,REVIEW_TYPE,
    EXIT_CLASSIFICATIONS:['Voluntary'],WORKFORCE_FACTORS:['Other'],DB:{employees:[]},
    employeeDepartmentNames:()=>['Production'],employeePositionNames:()=>['Operator'],employeeBranchLocations:()=>['Davao'],
    uniqueSettingNames:values=>[...new Set(values)].filter(Boolean),nextEmployeeNumber:()=> 'EMP-000001',
    isHRRole:()=>false,employeeAllowanceFieldsHTML:()=>'',normalizeAddress:()=>({}),addressComponentHTML:()=>'',
    formatGovernmentId:(_,value)=>value,esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('function fieldHTML('),source.indexOf('function readFields(')),scope);
  vm.runInContext(source.slice(source.indexOf('const EMP_FIELDS = ['),source.indexOf('const EMPLOYEE_IMPORT_COLUMNS = [')),scope);
  vm.runInContext(source.slice(source.indexOf('const EMP_FORM_SECTIONS = ['),source.indexOf('function syncPositionSelect(')),scope);
  return scope.employeeFormSectionsHTML(record);
}
test('employee form renders separate contract, operational status and dependent reason without defaulting the status date',()=>{
  const html=employmentFormPreview();
  for(const value of EMPLOYMENT_TYPES)assert.ok(html.includes(`value="${value}"`));
  assert.match(html,/id="f_statusDate" value=""/);
  assert.match(html,/syncEmployeeStatusReason\('f_statusReason',this.value\)/);
  assert.doesNotMatch(html,/value="Newly Hired"|id="f_classOverride"/);
});
test('editing an inactive employee loads its recorded reason and contract type',()=>{
  const html=employmentFormPreview({status:'Inactive',statusReason:'Floating Status',employmentType:'Seasonal',dateHired:'2020-01-01',statusDate:'2026-10-01'});
  assert.match(html,/value="Seasonal" selected/);assert.match(html,/value="Floating Status" selected/);
  assert.match(html,/id="f_statusDate" value="2026-10-01"/);assert.doesNotMatch(html,/value="Active \/ Normal"/);
});
