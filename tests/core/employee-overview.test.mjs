import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const summary=source.slice(source.indexOf('function employeeProfileSummaryHTML('),source.indexOf('function employeeProfilePersonalHTML('));
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const labels=source.slice(source.indexOf('function employeeOptionLabel('),source.indexOf('function syncEmployeeStatusReason('));
const render=runInNewContext(labels+summary+'\nemployeeProfileSummaryHTML',{esc,employeeAllowanceEntries:()=>[{name:'Synthetic Allowance',amount:100}],employeeAllowanceTotal:()=>100,peso:value=>'PHP '+value,formatGovernmentId:(_kind,value)=>value||'',formatPhilippineAddress:()=>'',employeeCompleteness:()=>60,classify:employee=>employee.employmentType,fmtDate:value=>value||'Not recorded',isSeparated:employee=>employee.status==='Separated',employeeTenureText:()=> 'Synthetic tenure'});
const employee={position:'Synthetic Position',department:'Synthetic Department',branchReporting:'Synthetic Branch',employmentType:'Probationary',status:'Active',statusReason:'Active / Normal',dateHired:'2026-10-01',prfNumber:'PRF-TEST'};
test('Overview shows each assignment and employment field once without duplicate cards',()=>{
  const html=render(employee,null);
  for(const value of ['Synthetic Position','Synthetic Department','Synthetic Branch','PRF-TEST','Probationary'])assert.equal(html.split(value).length-1,1);
  assert.doesNotMatch(html,/Active \/ Normal/);
  assert.equal(html.split('60%').length-1,1);assert.match(html,/<progress max="100" value="60" aria-label="Profile completeness"/);
  assert.match(html,/<dl class="profile-detail">/);assert.match(html,/<dt class="label">Position<\/dt><dd class="value">/);
  assert.doesNotMatch(html,/profile-kpis|profile-hero|employee-completeness/);
});
test('Overview masks government identifiers and displays short employment labels',()=>{
  const html=render({...employee,employmentType:'Regular / Permanent',sssNumber:'00-0001234-5'},null);
  assert.match(html,/Government IDs/);assert.match(html,/Personal Information/);
  assert.match(html,/Employment Type<\/dt><dd class="value">Regular<\/dd>/);
  assert.match(html,/\*\*-\*\*\*1234-5|\*\*-\*\*\*\*234-5/);
  assert.doesNotMatch(html.split('<details')[0],/00-0001234-5|Regular \/ Permanent/);
  assert.match(html,/<details class="employee-overview-identifiers"><summary>Show full identifiers/);
  assert.match(html,/Compensation/);assert.match(html,/Synthetic Allowance/);
  assert.doesNotMatch(source,/\['pay','Pay & IDs'\]/);
});
test('Employee edit uses display labels without changing stored select values',()=>{
  const label=runInNewContext(labels+'\nemployeeOptionLabel');
  assert.equal(label('Regular / Permanent'),'Regular');assert.equal(label('Active / Normal'),'Active');assert.equal(label('Probationary'),'Probationary');
  assert.match(source,/option value="\$\{esc\(o\)\}"/);
  assert.match(source,/optionLabel:employeeOptionLabel/);
  assert.match(source,/resolved=\{\.\.\.resolved,options:STATUS_REASONS/);
});
test('Overview safely preserves missing values and separated employee details',()=>{
  const html=render({...employee,status:'Separated',exitClassification:'Voluntary',exitFactor:'Personal',exitReason:'<script>synthetic</script>',prfNumber:''},null);
  assert.match(html,/Leaving Details/);assert.match(html,/Voluntary/);assert.match(html,/Personal/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>|undefined|NaN/);assert.match(html,/PRF Number<\/dt><dd class="value">Not recorded/);
  assert.doesNotMatch(render(employee,null),/Leaving Details/);
});
test('Overview retains details navigation and role-gated ER action without a repeated profile banner',()=>{
  const profile=source.slice(source.indexOf('async function openEmployeeProfile(id)'),source.indexOf('function renderLeaves('));
  assert.match(profile,/employeeWorkspaceNav\(employee,'overview'\)/);assert.match(profile,/employeeProfileSetTab/);
  const actions=source.slice(source.indexOf('function employeeWorkspaceNav('),source.indexOf('function employeeWorkspaceFooter('));
  assert.match(actions,/if\(!canEdit\(\)\) return ''/);assert.match(actions,/openEmployeeOperation\('cases'/);
  assert.doesNotMatch(profile,/employee-profile-hero|profile-chips|Selected employee:/);
  assert.match(source,/!isOverview\?` · \$\{esc\(emp.position/);
});
