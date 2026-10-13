import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const summary=source.slice(source.indexOf('function employeeProfileSummaryHTML('),source.indexOf('function employeeProfilePersonalHTML('));
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const render=runInNewContext(summary+'\nemployeeProfileSummaryHTML',{esc,employeeCompleteness:()=>60,classify:employee=>employee.employmentType,fmtDate:value=>value||'Not recorded',isSeparated:employee=>employee.status==='Separated',employeeTenureText:()=> 'Synthetic tenure'});
const employee={position:'Synthetic Position',department:'Synthetic Department',branchReporting:'Synthetic Branch',employmentType:'Probationary',status:'Active',statusReason:'Active / Normal',dateHired:'2026-10-01',prfNumber:'PRF-TEST'};
test('Overview shows each assignment and employment field once without duplicate cards',()=>{
  const html=render(employee,null);
  for(const value of ['Synthetic Position','Synthetic Department','Synthetic Branch','PRF-TEST','Probationary','Active / Normal'])assert.equal(html.split(value).length-1,1);
  assert.equal(html.split('60%').length-1,1);assert.match(html,/<progress max="100" value="60" aria-label="Profile completeness"/);
  assert.match(html,/<dl class="profile-detail">/);assert.match(html,/<dt class="label">Position<\/dt><dd class="value">/);
  assert.doesNotMatch(html,/profile-kpis|profile-hero|employee-completeness/);
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
  assert.match(profile,/canEdit\(\)\?`<button[^\n]*openEmployeeOperation\('cases'/);
  assert.doesNotMatch(profile,/employee-profile-hero|profile-chips|Selected employee:/);
  assert.match(source,/!isOverview\?` · \$\{esc\(emp.position/);
});
