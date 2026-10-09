import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EMPLOYMENT_TYPES,EMPLOYMENT_STATUSES,STATUS_REASONS,canonicalEmploymentType,employmentValidation,REVIEW_TYPE} from '../../js/core/employment.js';
import {normalizeEmployeeNumber,isValidEmployeeNumber,nextEmployeeNumber} from '../../js/core/employee-number.js';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
function context(){
  const context={EMPLOYMENT_TYPES,EMP_STATUS:EMPLOYMENT_STATUSES,STATUS_REASONS,REVIEW_TYPE,canonicalEmploymentType,employmentValidation,
    EXIT_CLASSIFICATIONS:['Voluntary'],WORKFORCE_FACTORS:['Other'],normalizeEmployeeNumber,isValidEmployeeNumber,nextEmployeeNumber,
    DB:{employees:[]},employeeDepartmentNames:()=>['Production'],employeeBranchLocations:()=>['Davao'],employeeAllowanceTypes:()=>[],
    positionCatalog:()=>[{name:'Operator',department:'Production',active:true}],todayISO:()=> '2026-10-09',employeeAllowanceFieldKey:name=>'allowance:'+name,
    validateGovernmentIds:()=>'',formatEmployeeName:r=>`${r.lastName}, ${r.firstName}`,employeeDisplayName:r=>r.name,employeeNameSimilarity:()=>0,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const EMPLOYEE_IMPORT_COLUMNS = ['),source.indexOf('function employeeAllowanceFieldKey(')),context);
  vm.runInContext(source.slice(source.indexOf('function employeeImportColumns('),source.indexOf('function employeeAllowanceEntries(')),context);
  vm.runInContext(source.slice(source.indexOf('function spreadsheetISODate('),source.indexOf('function parseEmployeeImportWorksheet(')),context);
  return context;
}
const row={employeeNo:'EMP-000001',lastName:'Dela Cruz',firstName:'Juan',position:'Operator',department:'Production',branchReporting:'Davao',dateHired:'2010-01-01',gender:'Male',status:'Active',employmentType:'Project-Based'};
test('Excel import keeps Status Effective Date blank and does not infer regular employment from old hire date',()=>{
  const result=context().validateEmployeeImportRow(row,2,[]);
  assert.deepEqual(Array.from(result.errors),[]);assert.equal(result.values.statusDate,'');assert.equal(result.values.statusReason,'Active / Normal');assert.equal(result.values.employmentType,'Project-Based');
});
test('Excel import requires explicit tenure and validates status reason and date separately',()=>{
  assert.match(context().validateEmployeeImportRow({...row,employmentType:''},2,[]).errors.join(';'),/Employment Type/);
  assert.match(context().validateEmployeeImportRow({...row,status:'Inactive',statusReason:'On Leave'},2,[]).errors.join(';'),/Effective Date/);
  assert.match(context().validateEmployeeImportRow({...row,statusReason:'Resigned'},2,[]).errors.join(';'),/Status Reason/);
  const result=context().validateEmployeeImportRow({...row,employmentType:'regular'},2,[]);
  assert.equal(result.values.employmentType,'Regular / Permanent');assert.equal(result.errors.length,0);
});
test('dependent reason control clears incompatible options while keeping valid reasons',()=>{
  const input={value:'Active / Normal',innerHTML:''},scope={document:{getElementById:()=>input},STATUS_REASONS,esc:value=>value};vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('function syncEmployeeStatusReason('),source.indexOf('/* ---------------- CSV export')),scope);
  scope.syncEmployeeStatusReason('reason','Inactive');assert.match(input.innerHTML,/AWOL \(Pending Review\)/);assert.doesNotMatch(input.innerHTML,/Active \/ Normal/);
  input.value='On Leave';scope.syncEmployeeStatusReason('reason','Inactive');assert.match(input.innerHTML,/On Leave" selected/);
});
test('onboarding and regularization do not reuse hiring dates as status dates',()=>{
  const conversion=source.slice(source.indexOf('async function convertOnboardingCandidate('),source.indexOf('const EMPLOYEE_COLUMN_DEFS'));
  assert.match(conversion,/status:'Active',statusReason:'Active \/ Normal'/);assert.match(conversion,/statusDate:''/);
  assert.doesNotMatch(conversion,/statusDate:candidate.proposedStartDate/);
  assert.match(source,/if\(eventType==='Regularization'\)\{ emp.employmentType='Regular \/ Permanent'/);
  assert.doesNotMatch(source,/'Regularization':'Active'/);
});

test('department transfers preserve contract and operational state and retain an assignment history',()=>{
  const transfer=source.slice(source.indexOf('async function saveEmployeeTransfer('),source.indexOf('function employeeCompleteness('));
  assert.doesNotMatch(transfer,/emp\.(status|statusReason|statusDate|employmentType)\s*=/);
  assert.match(transfer,/type:'Department Transfer'/);
});
