// Synthetic typography/layout harness. No production records, persistence, or Supabase requests.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {ageOn} from '../../js/core/workforce-metrics.js';
import {Script} from 'node:vm';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=readFileSync(resolve(root,'js/app.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const productionHead=readFileSync(resolve(root,'index.html'),'utf8').match(/<head>([\s\S]*?)<\/head>/)[1];
const assets=[...productionHead.matchAll(/<link\b[^>]*>/g)].map(match=>match[0].replace(/href="css\//g,'href="/css/')).join('');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic modal typography</title>${assets}</head><body><div class="overlay on"><div id="modal" class="modal employee-workspace-modal"></div></div><script>
const employee={id:'synthetic',name:'SYNTHETIC-LONG-FAMILY-NAME, Sample Employee',employeeNo:'EMP-000001',department:'Synthetic Department',position:'Synthetic Position With A Long Descriptive Name',status:'Active',employmentType:'Probationary',statusReason:'Active / Normal',branchReporting:'Synthetic Branch',dateHired:'2026-10-01',birthDate:'2001-01-01',address:'Synthetic Building, Long Synthetic Street, Synthetic Barangay, Synthetic Municipality, Synthetic Province',presentAddressText:'Synthetic Present Address With Additional Building And Unit Details',emergencyContactName:'Synthetic Contact',emergencyContactRelationship:'Parent',emergencyContactPhone:'',personalEmail:'synthetic-long-contact-address@example.invalid',sssNumber:'00-0000000-0'};
const DB={employees:[employee]},EMP_STATUS=['Active','Inactive','Separated'],STATUS_REASONS={'Active':['Active / Normal']},EXIT_CLASSIFICATIONS=['Voluntary'],WORKFORCE_FACTORS=['Personal'],LIFECYCLE_EVENT_TYPES=['Employment Status Change','Regularization','Return to Work'];
let EMPLOYEE_SECTION_EDIT=null;
const readOnly=new URLSearchParams(location.search).has('readonly');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),canEdit=()=>!readOnly,hasPermission=()=>!readOnly,selectEmployeeDirectoryRow=()=>{},ensureRecordModules=async()=>{},todayISO=()=> '2026-10-13';
const employeeDisplayName=record=>record.name,employeeDepartmentNames=()=>['Synthetic Department','Another Department'],employeePositionNames=()=>[employee.position],employeeCompleteness=()=>60,classify=record=>record.employmentType,fmtDate=value=>value||'Not recorded',isSeparated=()=>false,employeeTenureText=()=> 'Synthetic tenure';
const lifecycleEmployeePreview=()=>{},syncPositionSelect=()=>{},syncEmployeeStatusReason=()=>{};
const formatPhilippineAddress=()=>'',formatGovernmentId=(_kind,value)=>value||'';
${ageOn.toString()}
const employeeAllowanceEntries=()=>[],employeeAllowanceTotal=()=>0,peso=value=>'PHP '+value;
${section('function employeeOptionLabel(','function syncEmployeeStatusReason(')}
const EMPLOYMENT_TYPES=['Regular / Permanent','Probationary'],REVIEW_TYPE='Needs HR Review',isHRRole=()=>false;
const uniqueSettingNames=values=>[...new Set(values)].filter(Boolean),nextEmployeeNumber=()=> 'EMP-000002',employeeBranchLocations=()=>['Synthetic Branch'];
const employeeAllowanceFieldsHTML=()=>'',normalizeAddress=()=>({}),addressComponentHTML=({prefix,label})=>'<div class="address-component"><h5>'+label+'</h5><div class="field"><label for="'+prefix+'_street">Street / House / Unit</label><input id="'+prefix+'_street" value="Synthetic street"></div></div>';
${section('function fieldHTML(','function readFields(')}
${section('function readFields(','function governmentIdDigits(')}
${section('function revealModalField(','async function transitionModal(')}
${section('const EMP_FIELDS = [','const EMPLOYEE_IMPORT_COLUMNS = [')}
${section('const EMP_FORM_SECTIONS = [','function syncPositionSelect(')}
${[...source.matchAll(/^function i\w+\(s\)\{.*$/gm)].map(match=>match[0]).join('\n')}
function employeeWorkspaceNavigate(id,target){if(target.startsWith('section:'))return openEmployeeSectionForm(id,Number(target.slice(8)));return show({overview:'Overview',edit:'Edit',status:'Status',lifecycle:'Lifecycle',transfer:'Transfer',history:'Overview',report:'Incident'}[target]);}
function openEmployeeOperation(){return show('Incident');}
${section('function employeeWorkspaceNav(','function employeeWorkspaceFooter(')}
const employeeWorkspaceHeader=(record,title)=>'<div class="modal-head employee-workspace-head"><div><div class="employee-workspace-breadcrumb">Employees › '+title+'</div><h3>'+esc(title==='Overview'?record.name:title)+'</h3><div class="small">'+esc(title==='Overview'?record.employeeNo:record.position)+'</div></div><button type="button" aria-label="Close">×</button></div>';
${section('function employeeWorkspaceFooter(','const EMP_FIELDS = [')}
const openModal=markup=>{EMPLOYEE_SECTION_EDIT=null;document.getElementById('modal').innerHTML=markup;};
${section('function splitEmployeeName(','function formatEmployeeName(')}
${section('function formatEmployeeName(','function employeeDisplayName(')}
${section('function openEmployeeSectionForm(','function normalizeEmployeeName(')}
const toast=message=>{document.querySelector('.modal-foot').dataset.message=message;};
const persistEmployeeEdit=async(_values,_id,patch)=>{Object.assign(employee,patch);show('Overview');};
const confirmEmployeeDuplicateNames=async()=>true,validateGovernmentIds=()=>'',employmentValidation=()=>'',readAddressComponent=async()=>({valid:true,address:{}}),readEmployeeAllowances=()=>employee.allowances||{};
const departmentCatalog=()=>[{name:employee.department,active:true}],positionCatalog=()=>[{name:employee.position,department:employee.department,active:true}];
${section('function openEmployeeWorkspaceModal(','async function returnFromEmployeeTransaction(')}
${section('function employeeProfileSummaryHTML(','function employeeProfilePersonalHTML(')}
${section('function openEmployeeStatusForm(','async function saveEmployeeStatus(')}
${section('async function openTransferForEmployee(','async function saveEmployeeTransfer(')}
${section('function openEmployeeLifecycleEventForm(','function lifecycleEventTypeChanged(')}
${section('function lifecycleEventTypeChanged(','function lifecycleEmployeePreview(')}
function show(view){
  const modal=document.getElementById('modal');modal.className='modal'+(['Incident','Access'].includes(view)?' relations-modal entry-modal':' employee-workspace-modal');
  if(view==='Status')return openEmployeeStatusForm(employee.id);
  if(view==='Transfer')return openTransferForEmployee(employee.id);
  if(view==='Lifecycle')return openEmployeeLifecycleEventForm(employee.id);
  const overview=employeeProfileSummaryHTML(employee,null);
  const fields='<div class="field"><label for="sample_name">Employee Name</label><input id="sample_name" value="'+esc(employee.name)+'"></div><div class="field"><label for="sample_department">Department</label><select id="sample_department"><option>'+esc(employee.department)+'</option></select></div><div class="field full"><label for="sample_remarks">Remarks</label><textarea id="sample_remarks">Synthetic text for layout testing only.</textarea></div>';
  const form=view==='Edit'?employeeFormSectionsHTML(employee):'<div class="formgrid">'+fields+'</div><div class="computed-note">Synthetic shared-form note.</div>';
  openEmployeeWorkspaceModal(employeeWorkspaceHeader(employee,view)+'<div class="modal-body '+(view==='Overview'?'employee-profile-workspace':view==='Edit'?'employee-form-body':'')+'">'+employeeWorkspaceNav(employee,view==='Overview'?'overview':'edit')+ (view==='Overview'?overview:form)+'</div>'+employeeWorkspaceFooter(employee,'Save'));
}
show(new URLSearchParams(location.search).get('view')||'Overview');
const initialSection=new URLSearchParams(location.search).get('section');
if(initialSection!==null&&!readOnly)openEmployeeSectionForm(employee.id,Number(initialSection));
const fixtureErrors=document.createElement('button');fixtureErrors.className='btn btn-ghost';fixtureErrors.textContent='Check required fields';fixtureErrors.onclick=()=>showModalFieldErrors([{id:'f_lastName',message:'Last Name is required.'},{id:'f_firstName',message:'First Name is required.'}]);if(!EMPLOYEE_SECTION_EDIT)document.querySelector('.modal-foot').prepend(fixtureErrors);
document.addEventListener('input',event=>clearModalFieldError(event.target));
document.addEventListener('change',event=>clearModalFieldError(event.target));
document.fonts.ready.then(()=>{
  const failures=[],check=(ok,message)=>{if(!ok)failures.push(message);};
  const input=document.querySelector('.field input:not([type="hidden"])');
  if(input){
    check(input.labels.length>0,'Form controls must have associated labels');
    check(input.getBoundingClientRect().height>=44,'Form controls must be at least 44px high');
    check(parseFloat(getComputedStyle(input).fontSize)===(innerWidth<=720?16:14.3),'Input text must follow the dialog token');
  }
  check(parseFloat(getComputedStyle(document.querySelector('.modal-head h3')).fontSize)===19.5,'Heading must use the dialog token');
  check(document.documentElement.scrollWidth<=innerWidth,'Dialog must fit viewport width');
  if(EMPLOYEE_SECTION_EDIT)check(document.querySelectorAll('.employee-form-section').length===1,'Scoped editing must show exactly one group');
  if(readOnly)check(!document.querySelector('.employee-section-edit'),'Read-only users must not have section shortcuts');
  const output=document.createElement('output');output.id='fixture-checks';output.hidden=true;output.textContent=failures.length?'FAIL: '+failures.join('; '):'PASS: computed modal tokens, labels, control heights and responsive bounds';document.body.appendChild(output);
  console.assert(!failures.length,failures.join('; '));
});
</script></body></html>`;
new Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Stopped');server.close();server.closeAllConnections();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=resolve(root,'.'+decodeURIComponent(path));if(!file.startsWith(resolve(root,'css')+sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type','text/css');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4187,'127.0.0.1',()=>console.log('Synthetic modal typography: http://127.0.0.1:4187/'));
