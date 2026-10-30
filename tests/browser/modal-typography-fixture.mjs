// Synthetic typography/layout harness. No production records, persistence, or Supabase requests.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {ageOn} from '../../js/core/workforce-metrics.js';
import {Script} from 'node:vm';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=readFileSync(resolve(root,'js/app.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const productionHTML=readFileSync(resolve(root,'index.html'),'utf8');
const confirmation=productionHTML.slice(productionHTML.indexOf('<div class="data-confirm-overlay"'),productionHTML.indexOf('<div class="toast"'));
const functionSource=name=>{const start=source.indexOf('function '+name+'(');const rest=source.slice(start);return rest.slice(0,rest.search(/\r?\n}\r?\n/)+3);};
const productionHead=productionHTML.match(/<head>([\s\S]*?)<\/head>/)[1];
const assets=[...productionHead.matchAll(/<link\b[^>]*>/g)].map(match=>match[0].replace(/href="css\//g,'href="/css/')).join('');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic modal typography</title>${assets}</head><body><div class="overlay on"><div id="modal" class="modal employee-workspace-modal"></div></div>${confirmation}<script>
${readFileSync(resolve(root,'js/core/government-ids.js'),'utf8').replace(/^export /gm,'')}
const employee={id:'synthetic',name:'SYNTHETIC-LONG-FAMILY-NAME, Sample Employee',employeeNo:'EMP-000001',department:'Synthetic Department',position:'Synthetic Position With A Long Descriptive Name',status:'Active',employmentType:'Probationary',statusReason:'Active / Normal',branchReporting:'Synthetic Branch',dateHired:'2026-10-01',birthDate:'2001-01-01',address:'Synthetic Building, Long Synthetic Street, Synthetic Barangay, Synthetic Municipality, Synthetic Province',presentAddressText:'Synthetic Present Address With Additional Building And Unit Details',emergencyContactName:'Synthetic Contact',emergencyContactRelationship:'Parent',emergencyContactPhone:'',personalEmail:'synthetic-long-contact-address@example.invalid',sssNumber:'00-0000000-0'};
const DB={employees:[employee]},EMP_STATUS=['Active','Inactive','Separated'],STATUS_REASONS={'Active':['Active / Normal']},EXIT_CLASSIFICATIONS=['Voluntary'],WORKFORCE_FACTORS=['Personal'],LIFECYCLE_EVENT_TYPES=['Employment Status Change','Regularization','Return to Work'];
let EMPLOYEE_SECTION_EDIT=null,MODAL_EDIT_STATE=null,EMPLOYEE_WORKSPACE_NAVIGATING=false,DATA_CONFIRM_PENDING=null,DATA_CONFIRM_TRIGGER=null;
const CONFIRMED_CHANGE_TARGETS=new WeakSet(),SESSION={id:'synthetic-actor',fullName:'Synthetic HR'};
const fixtureParams=new URLSearchParams(location.search);
window.FIXTURE_STATE={saveAttempts:0,profileOpens:0,employee};
if(fixtureParams.has('government-duplicate'))DB.employees.push({id:'synthetic-other',clientName:'Company Y',department:'Sales',position:'Merchandiser',lastName:'Dela Cruz',firstName:'Juan',sssNumber:'00-0001234-5',philHealthNumber:'00-000000123-4',pagIbigNumber:'0000-0001-2345',tin:'000-001-234-000'});
${section('function editorControls(','function findEditorSaveButton(')}
${functionSource('modalHasUnsavedChanges')}
${functionSource('confirmDataChange')}
${functionSource('resolveDataChangeConfirmation')}
for(const [id,result] of [['data-confirm-cancel',false],['data-confirm-discard','discard'],['data-confirm-accept','confirm']])document.getElementById(id).addEventListener('click',()=>resolveDataChangeConfirmation(result));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.getElementById('data-confirm-overlay').classList.contains('on'))resolveDataChangeConfirmation(false);});


const readOnly=new URLSearchParams(location.search).has('readonly');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),canEdit=()=>!readOnly,hasPermission=()=>!readOnly,selectEmployeeDirectoryRow=()=>{},ensureRecordModules=async()=>{},todayISO=()=> '2026-10-13';
const employeeDisplayName=record=>record.name,employeeDepartmentNames=()=>['Synthetic Department','Another Department'],employeePositionNames=()=>[employee.position],employeeCompleteness=()=>60,classify=record=>record.employmentType,fmtDate=value=>value||'Not recorded',isSeparated=()=>false,employeeTenureText=()=> 'Synthetic tenure';
const lifecycleEmployeePreview=()=>{},syncPositionSelect=()=>{},syncEmployeeStatusReason=()=>{};
const formatPhilippineAddress=()=>'';
${section('function governmentIdDigits(','async function dashboardOpenEmployees(')}
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
${section('async function employeeWorkspaceNavigate(','function employeeWorkspaceNav(')}
function openEmployeeOperation(){return show('Incident');}
${section('function employeeWorkspaceNav(','function employeeWorkspaceFooter(')}
const normalizeEmployeeName=value=>String(value||'').toLowerCase(),opsInitials=()=> 'SY';
${section('function employeePickerFind(','/* ---------------- icons (inline svg, currentColor) ---------------- */')}

const employeeWorkspaceHeader=(record,title)=>'<div class="modal-head employee-workspace-head"><div><div class="employee-workspace-breadcrumb">Employees › '+title+'</div><h3>'+esc(title==='Overview'?record.name:title)+'</h3><div class="small">'+esc(title==='Overview'?record.employeeNo:record.position)+'</div></div><button type="button" aria-label="Close">×</button></div>';
${section('function employeeWorkspaceFooter(','const EMP_FIELDS = [')}
const openModal=markup=>{EMPLOYEE_SECTION_EDIT=null;const modal=document.getElementById('modal');modal.innerHTML=markup;const saveButton=modal.querySelector('.modal-foot .btn-primary');MODAL_EDIT_STATE=saveButton&&modal.querySelector('.field')?{baseline:serializeEditor(modal),saveButton}:null;};
${section('function splitEmployeeName(','function formatEmployeeName(')}
${section('function formatEmployeeName(','function employeeDisplayName(')}
${section('function openEmployeeSectionForm(','function normalizeEmployeeName(')}
const toast=message=>{document.querySelector('.modal-foot').dataset.message=message;};
const recordStoragePaths=()=>new Set(),updateEmployeeNameReferences=()=>[],restoreEmployeeNameReferences=()=>{},logAudit=()=>{},rememberCommittedRecordFiles=()=>{},deleteStorageObjects=async()=>{},closeModal=async()=>{},renderNav=()=>{},renderEmployeeOrigin=async()=>{};
const saveDB=async()=>{const state=window.FIXTURE_STATE;state.saveAttempts++;await new Promise(resolve=>setTimeout(resolve,fixtureParams.has('slow')?100:0));if(fixtureParams.has('fail-once')&&state.saveAttempts===1){toast('Synthetic save failed. Your entries are retained; try again.');return false;}return true;};
${functionSource('appendEmployeeRecordHistory')}
${'async '+functionSource('persistEmployeeEdit')}
async function openEmployeeProfile(){window.FIXTURE_STATE.profileOpens++;if(fixtureParams.has('slow'))await new Promise(resolve=>setTimeout(resolve,80));show('Overview');}
const openEmployeeForm=()=>show('Edit');

const confirmEmployeeDuplicateNames=async()=>true,employmentValidation=()=>'',readAddressComponent=async()=>({valid:true,address:{}}),readEmployeeAllowances=()=>employee.allowances||{};
const departmentCatalog=()=>[{name:employee.department,active:true}],positionCatalog=()=>[{name:employee.position,department:employee.department,active:true}];
${section('function openEmployeeWorkspaceModal(','async function returnFromEmployeeTransaction(')}
${section('function employeeProfileSummaryHTML(','function employeeProfilePersonalHTML(')}
const EMPLOYEE_PROFILE_CACHE=new Map([[employee.id,{snapshot:{}}]]);
function employeeProfileTabContent(record,tab){return tab==='history'?'<h3>History</h3><p>No synthetic history recorded.</p>':employeeProfileSummaryHTML(record,null);}
${section('function employeeProfileSetTab(','function updateEmployeeProfileActivity(')}
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
  if(view==='Controls'){
    const samples=['text','email','number','date','time','datetime-local'].map((type,index)=>'<div class="field"><label for="control_'+index+'">'+type+'</label><input id="control_'+index+'" type="'+type+'" placeholder="Synthetic value"></div>').join('');
    const composite='<div class="field"><label for="control_money">Currency</label><div class="money-input"><span>PHP</span><input id="control_money" type="number" value="0"></div></div><div class="field"><label for="control_catalog">Catalog</label><div class="catalog-select-row"><select id="control_catalog"><option>Synthetic department</option></select><button type="button" class="catalog-add-button" aria-label="Add catalog option">+</button></div></div>';
    const duty='<div class="full att-duty"><label for="control_start">Duty start<input id="control_start" type="time" value="08:00"></label><label for="control_end">Duty end<input id="control_end" type="time" value="17:00"></label><label for="control_break">Break minutes<input id="control_break" type="number" value="60"></label></div>';
    const states='<div class="field"><label for="control_readonly">Readonly</label><input id="control_readonly" readonly value="Synthetic readonly"></div><div class="field"><label for="control_disabled">Disabled</label><input id="control_disabled" disabled value="Synthetic disabled"></div><div class="field"><label for="control_upload">Native upload</label><input id="control_upload" type="file"><input id="control_hidden" type="hidden"></div><label class="checkrow"><input id="control_checkbox" type="checkbox">Synthetic selection</label><label class="automation-switch"><input id="control_switch" type="checkbox">Synthetic enabled setting</label>';
    return openEmployeeWorkspaceModal(employeeWorkspaceHeader(employee,'Control sizing')+'<div class="modal-body"><div class="formgrid">'+samples+composite+employeePickerHTML({id:'control_employee',autofill:false})+states+duty+fields+'</div></div>'+employeeWorkspaceFooter(employee,'Save'));
  }
  const form=view==='Edit'?employeeFormSectionsHTML(employee):'<div class="formgrid">'+fields+'</div><div class="computed-note">Synthetic shared-form note.</div>';
  openEmployeeWorkspaceModal(employeeWorkspaceHeader(employee,view)+'<div class="modal-body '+(view==='Overview'?'employee-profile-workspace':view==='Edit'?'employee-form-body':'')+'" data-employee-profile-id="synthetic" data-active-tab="summary">'+employeeWorkspaceNav(employee,view==='Overview'?'overview':'edit')+ (view==='Overview'?'<div class="employee-profile-tab-content">'+overview+'</div>':form)+'</div>'+(view==='Overview'?'<div class="modal-foot"><button type="button" class="btn btn-ghost">Back to Directory</button></div>':employeeWorkspaceFooter(employee,'Save')));
}
show(new URLSearchParams(location.search).get('view')||'Overview');
const initialSection=new URLSearchParams(location.search).get('section');
if(initialSection!==null&&!readOnly)openEmployeeSectionForm(employee.id,Number(initialSection));
const fixtureErrors=document.createElement('button');fixtureErrors.className='btn btn-ghost fixture-validation';fixtureErrors.textContent='Check required fields';fixtureErrors.onclick=()=>showModalFieldErrors([{id:'f_lastName',message:'Last Name is required.'},{id:'f_firstName',message:'First Name is required.'}]);if(!EMPLOYEE_SECTION_EDIT&&document.querySelector('.field'))document.querySelector('.modal-foot').prepend(fixtureErrors);
document.addEventListener('input',event=>clearModalFieldError(event.target));
document.addEventListener('change',event=>clearModalFieldError(event.target));
document.fonts.ready.then(()=>{
  const failures=[],check=(ok,message)=>{if(!ok)failures.push(message);};
  const input=document.querySelector('.field input:not([type="hidden"])');
  if(input){
    check(input.labels.length>0,'Form controls must have associated labels');
    check(input.getBoundingClientRect().height>=44,'Form controls must be at least 44px high');
    check(parseFloat(getComputedStyle(input).fontSize)===(innerWidth<=720?16:14),'Input text must follow the dialog token');
  }
  const expected=innerWidth<=720?48:44;
  document.querySelectorAll('.field input:not([type="checkbox"],[type="radio"],[type="hidden"],[type="file"]),.field select').forEach(control=>{
    if(control.closest('.employee-picker-input,.tda-picker-input,.money-input'))return;
    check(Math.abs(control.getBoundingClientRect().height-expected)<1,'Consistent form height: '+control.id);
    check(parseFloat(getComputedStyle(control).fontSize)===(innerWidth<=720?16:14),'Consistent form font: '+control.id);
    const style=getComputedStyle(control),line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5;check(line+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)<=control.clientHeight+1,'Text fits vertically: '+control.id);
  });
  document.querySelectorAll('.field textarea').forEach(control=>check(control.getBoundingClientRect().height>=96,'Textareas retain their content minimum'));
  document.querySelectorAll('.employee-picker-input,.money-input,.catalog-add-button,.att-duty input').forEach(control=>check(Math.abs(control.getBoundingClientRect().height-expected)<1,'Composite control height: '+control.className));
  const hidden=document.getElementById('control_hidden');if(hidden)check(!hidden.getClientRects().length,'Hidden inputs stay hidden');
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
