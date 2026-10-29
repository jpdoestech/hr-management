import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EMPLOYMENT_TYPES,EMPLOYMENT_STATUSES,STATUS_REASONS,REVIEW_TYPE} from '../../js/core/employment.js';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
export function employmentFormPreview(record=null,options={}){
  const scope={EMPLOYMENT_TYPES,EMP_STATUS:EMPLOYMENT_STATUSES,STATUS_REASONS,REVIEW_TYPE,
    EXIT_CLASSIFICATIONS:['Voluntary'],WORKFORCE_FACTORS:['Other'],DB:{employees:[]},
    employeeDepartmentNames:()=>['Production'],employeePositionNames:()=>['Operator'],employeeBranchLocations:()=>['Davao'],
    uniqueSettingNames:values=>[...new Set(values)].filter(Boolean),nextEmployeeNumber:()=> 'EMP-000001',
    isHRRole:()=>false,employeeAllowanceFieldsHTML:()=>'',normalizeAddress:()=>({}),addressComponentHTML:()=>'',
    formatGovernmentId:(_,value)=>value,esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('function employeeOptionLabel('),source.indexOf('function syncEmployeeStatusReason(')),scope);
  vm.runInContext(source.slice(source.indexOf('function fieldHTML('),source.indexOf('function readFields(')),scope);
  vm.runInContext(source.slice(source.indexOf('const EMP_FIELDS = ['),source.indexOf('const EMPLOYEE_IMPORT_COLUMNS = [')),scope);
  vm.runInContext(source.slice(source.indexOf('const EMP_FORM_SECTIONS = ['),source.indexOf('function syncPositionSelect(')),scope);
  return scope.employeeFormSectionsHTML(record,options);
}
test('employee form renders separate contract, operational status and dependent reason without defaulting the status date',()=>{
  const html=employmentFormPreview();
  for(const value of EMPLOYMENT_TYPES)assert.ok(html.includes(`value="${value}"`));
  assert.match(html,/id="f_statusDate" value=""/);
  assert.match(html,/syncEmployeeStatusReason\('f_statusReason',this.value\)/);
  assert.doesNotMatch(html,/value="Newly Hired"|id="f_classOverride"/);
  assert.match(html,/value="Regular \/ Permanent" >Regular<\/option>/);
  assert.match(html,/value="Active \/ Normal" selected>Active<\/option>/);
});
test('editing an inactive employee loads its recorded reason and contract type',()=>{
  const html=employmentFormPreview({status:'Inactive',statusReason:'Floating Status',employmentType:'Seasonal',dateHired:'2020-01-01',statusDate:'2026-10-01'});
  assert.match(html,/value="Seasonal" selected/);assert.match(html,/value="Floating Status" selected/);
  assert.match(html,/id="f_statusDate" value="2026-10-01"/);assert.doesNotMatch(html,/value="Active \/ Normal"/);
});
test('a scoped Emergency Information editor contains only its three contact fields',()=>{
  const html=employmentFormPreview({emergencyContactName:'Synthetic Contact'},{section:'Emergency Information'});
  assert.equal((html.match(/employee-form-section"/g)||[]).length,1);
  for(const key of ['emergencyContactName','emergencyContactRelationship','emergencyContactPhone'])assert.ok(html.includes(`id="f_${key}"`));
  assert.doesNotMatch(html,/id="f_(lastName|department|status|dailyRate|sssNumber)"|employee-address-stack/);
});
test('Edit groups and sequence match Overview without scattering related fields',()=>{
  const html=employmentFormPreview();
  const headings=[...html.matchAll(/<h4>([^<]+)<\/h4>/g)].map(match=>match[1]);
  assert.deepEqual(headings,['Personal Information','Emergency Information','Government IDs','Employment Details','Compensation','Allowances','Remarks','Leaving Details']);
  const employment=html.slice(html.indexOf('<h4>Employment Details'),html.indexOf('<h4>Compensation'));
  const keys=['employeeNo','prfNumber','department','position','branchReporting','employmentType','status','statusReason','dateHired','statusDate'];
  let previous=-1;for(const key of keys){const index=employment.indexOf(`id="f_${key}"`);assert.ok(index>previous,key);previous=index;}
  assert.equal((html.match(/id="f_mobileNumber"/g)||[]).length,1);
  const personal=html.slice(0,html.indexOf('<h4>Emergency Information'));
  assert.match(personal,/id="f_personalEmail"/);assert.match(personal,/employee-address-stack/);
});
test('Employee workspace separates fixed controls from accessible scroll content',()=>{
  const shell=source.slice(source.indexOf('function openEmployeeWorkspaceModal('),source.indexOf('async function returnFromEmployeeTransaction('));
  assert.match(shell,/employee-workspace-controls/);assert.match(shell,/employee-workspace-scroll/);
  assert.match(shell,/node\.matches\('\.employee-workspace-nav,\.employee-profile-detailbar'\)/);
  assert.match(shell,/content\.setAttribute\('aria-label','Employee record content'\)/);
  assert.match(shell,/else content\.append\(node\)/);
  const css=readFileSync(new URL('../../css/professional.css',import.meta.url),'utf8');
  assert.match(css,/employee-workspace-controls\{flex:none/);
  assert.match(css,/employee-workspace-scroll\{flex:1 1 auto;min-height:0;overflow:auto/);
});
