import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {ageOn} from '../../js/core/workforce-metrics.js';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const summary=source.slice(source.indexOf('function employeeProfileSummaryHTML('),source.indexOf('function employeeProfilePersonalHTML('));
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const labels=source.slice(source.indexOf('function employeeOptionLabel('),source.indexOf('function syncEmployeeStatusReason('));
const scope={ageOn,todayISO:()=> '2026-10-13',iShield:()=>'',esc,employeeAllowanceEntries:()=>[{name:'Synthetic Allowance',amount:100}],employeeAllowanceTotal:()=>100,peso:value=>'PHP '+value,formatGovernmentId:(_kind,value)=>value||'',formatPhilippineAddress:()=>'',employeeCompleteness:()=>60,classify:employee=>employee.employmentType,fmtDate:value=>value||'Not recorded',isSeparated:employee=>employee.status==='Separated',employeeTenureText:()=> 'Synthetic tenure'};
const render=runInNewContext(labels+summary+'\nemployeeProfileSummaryHTML',scope);
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
  assert.doesNotMatch(html,/00-0001234-5|Regular \/ Permanent/);
  assert.match(html,/aria-pressed="false"/);assert.match(html,/Unmask Government IDs/);
  assert.match(html,/Compensation/);assert.match(html,/Synthetic Allowance/);
  assert.doesNotMatch(source,/\['pay','Pay & IDs'\]/);
});
test('Overview consolidates personal, current address and emergency information',()=>{
  const html=render({...employee,birthDate:'2000-10-13',presentAddressText:'Synthetic current address',emergencyContactName:'Synthetic Contact',emergencyContactRelationship:'Parent',emergencyContactPhone:'Synthetic Phone'},null);
  for(const value of ['26 years old','Synthetic current address','Synthetic Contact','Synthetic Phone'])assert.equal(html.split(value).length-1,1);
  assert.match(html,/Emergency Information/);assert.doesNotMatch(source,/\['personal','Personal'\]/);
});
test('Government ID toggle reveals and remasks in place without replacing the form',()=>{
  const node={dataset:{governmentId:'sssNumber'},textContent:''},label={textContent:''};
  const button={pressed:'false',closest:()=>({dataset:{employeeId:'synthetic'},querySelectorAll:()=>[node]}),getAttribute(){return this.pressed;},setAttribute(_key,value){this.pressed=value;},querySelector:()=>label};
  const toggle=runInNewContext(summary+'\nemployeeProfileToggleIds',{...scope,DB:{employees:[{id:'synthetic',sssNumber:'00-0001234-5'}]}});
  toggle(button);assert.equal(node.textContent,'00-0001234-5');assert.equal(button.pressed,'true');
  toggle(button);assert.doesNotMatch(node.textContent,/00-0001234-5/);assert.equal(button.pressed,'false');assert.equal(label.textContent,'Unmask Government IDs');
});
test('Employee edit uses display labels without changing stored select values',()=>{
  const label=runInNewContext(labels+'\nemployeeOptionLabel');
  assert.equal(label('Regular / Permanent'),'Regular');assert.equal(label('Active / Normal'),'Active');assert.equal(label('Probationary'),'Probationary');
  assert.match(source,/option value="\$\{esc\(o\)\}"/);
  assert.match(source,/optionLabel:employeeOptionLabel/);
  assert.match(source,/resolved=\{\.\.\.resolved,options:STATUS_REASONS/);
});
test('Overview uses the same label width for regular rows and full-width addresses',()=>{
  const css=readFileSync(new URL('../../css/professional.css',import.meta.url),'utf8');
  assert.match(css,/\.employee-overview \.profile-detail \.item\{[^}]*grid-template-columns:var\(--employee-detail-label-width\) minmax\(0,1fr\)/);
  assert.match(css,/\.employee-overview \.profile-detail \.item\.full\{grid-template-columns:var\(--employee-detail-label-width\) minmax\(0,1fr\)/);
  assert.match(css,/\.employee-overview \.profile-detail \.item\.full\{grid-template-columns:1fr;gap:4px/);
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
