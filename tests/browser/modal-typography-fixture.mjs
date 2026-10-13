// Synthetic typography/layout harness. No production records, persistence, or Supabase requests.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {ageOn} from '../../js/core/workforce-metrics.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),source=readFileSync(resolve(root,'js/app.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic modal typography</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"></head><body><div class="overlay on"><div id="modal" class="modal employee-workspace-modal"></div></div><script>
const employee={id:'synthetic',name:'SYNTHETIC-LONG-FAMILY-NAME, Sample Employee',employeeNo:'EMP-000001',department:'Synthetic Department',position:'Synthetic Position With A Long Descriptive Name',status:'Active',employmentType:'Probationary',statusReason:'Active / Normal',branchReporting:'Synthetic Branch',dateHired:'2026-10-01',birthDate:'2001-01-01',address:'Synthetic Building, Long Synthetic Street, Synthetic Barangay, Synthetic Municipality, Synthetic Province',presentAddressText:'Synthetic Present Address With Additional Building And Unit Details',emergencyContactName:'Synthetic Contact',emergencyContactRelationship:'Parent',emergencyContactPhone:'Not recorded',personalEmail:'synthetic-long-contact-address@example.invalid',sssNumber:'00-0000000-0'};
const DB={employees:[employee]},EMP_STATUS=['Active','Inactive','Separated'],STATUS_REASONS={'Active':['Active / Normal']},EXIT_CLASSIFICATIONS=['Voluntary'],WORKFORCE_FACTORS=['Personal'],LIFECYCLE_EVENT_TYPES=['Regularization','Return to Work'];
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),canEdit=()=>true,selectEmployeeDirectoryRow=()=>{},ensureRecordModules=async()=>{},todayISO=()=> '2026-10-13';
const employeeDisplayName=record=>record.name,employeeDepartmentNames=()=>['Synthetic Department','Another Department'],employeePositionNames=()=>[employee.position],employeeCompleteness=()=>60,classify=record=>record.employmentType,fmtDate=value=>value||'Not recorded',isSeparated=()=>false,employeeTenureText=()=> 'Synthetic tenure';
const lifecycleEventTypeChanged=()=>{},lifecycleEmployeePreview=()=>{},syncPositionSelect=()=>{},syncEmployeeStatusReason=()=>{};
const formatPhilippineAddress=()=>'',formatGovernmentId=(_kind,value)=>value||'';
${ageOn.toString()}
const employeeAllowanceEntries=()=>[],employeeAllowanceTotal=()=>0,peso=value=>'PHP '+value;
${section('function employeeOptionLabel(','function syncEmployeeStatusReason(')}
const EMPLOYMENT_TYPES=['Regular / Permanent','Probationary'],REVIEW_TYPE='Needs HR Review',isHRRole=()=>false;
const uniqueSettingNames=values=>[...new Set(values)].filter(Boolean),nextEmployeeNumber=()=> 'EMP-000002',employeeBranchLocations=()=>['Synthetic Branch'];
const employeeAllowanceFieldsHTML=()=>'',normalizeAddress=()=>({}),addressComponentHTML=()=>'<div class="address-component"><h5>Home Address</h5><div class="field"><label for="synthetic_street">Street / House / Unit</label><input id="synthetic_street" value="Synthetic street"></div></div>';
${section('function fieldHTML(','function readFields(')}
${section('const EMP_FIELDS = [','const EMPLOYEE_IMPORT_COLUMNS = [')}
${section('const EMP_FORM_SECTIONS = [','function syncPositionSelect(')}
${[...source.matchAll(/^function i\w+\(s\)\{.*$/gm)].map(match=>match[0]).join('\n')}
function employeeWorkspaceNavigate(id,target){return show({overview:'Overview',edit:'Edit',status:'Status',lifecycle:'Lifecycle',transfer:'Transfer'}[target]);}
function openEmployeeOperation(){return show('Incident');}
${section('function employeeWorkspaceNav(','function employeeWorkspaceFooter(')}
const employeeWorkspaceHeader=(record,title)=>'<div class="modal-head employee-workspace-head"><div><div class="employee-workspace-breadcrumb">Employees › '+title+'</div><h3>'+esc(title==='Overview'?record.name:title)+'</h3><div class="small">'+esc(title==='Overview'?record.employeeNo:record.position)+'</div></div><button type="button" aria-label="Close">×</button></div>';
const employeeWorkspaceFooter=(record,label)=>'<div class="modal-foot employee-workspace-foot"><button class="btn btn-ghost">Back</button><button class="btn btn-primary">'+label+'</button></div>';
const openEmployeeWorkspaceModal=markup=>document.getElementById('modal').innerHTML=markup;
${section('function employeeProfileSummaryHTML(','function employeeProfilePersonalHTML(')}
${section('function openEmployeeStatusForm(','async function saveEmployeeStatus(')}
${section('async function openTransferForEmployee(','async function saveEmployeeTransfer(')}
${section('function openEmployeeLifecycleEventForm(','function lifecycleEventTypeChanged(')}
function show(view){
  const modal=document.getElementById('modal');modal.className='modal'+(['Incident','Access'].includes(view)?' relations-modal entry-modal':' employee-workspace-modal');
  if(view==='Status')return openEmployeeStatusForm(employee.id);
  if(view==='Transfer')return openTransferForEmployee(employee.id);
  if(view==='Lifecycle')return openEmployeeLifecycleEventForm(employee.id);
  const overview='<div class="employee-profile-detailbar"><div class="employee-profile-tabs"><button class="employee-profile-tab active">Overview</button><button class="employee-profile-tab">History</button></div></div>'+employeeProfileSummaryHTML(employee,null);
  const fields='<div class="field"><label for="sample_name">Employee Name</label><input id="sample_name" value="'+esc(employee.name)+'"></div><div class="field"><label for="sample_department">Department</label><select id="sample_department"><option>'+esc(employee.department)+'</option></select></div><div class="field full"><label for="sample_remarks">Remarks</label><textarea id="sample_remarks">Synthetic text for layout testing only.</textarea></div>';
  const form=view==='Edit'?employeeFormSectionsHTML(employee):'<div class="formgrid">'+fields+'</div><div class="computed-note">Synthetic shared-form note.</div>';
  openEmployeeWorkspaceModal(employeeWorkspaceHeader(employee,view)+'<div class="modal-body '+(view==='Overview'?'employee-profile-workspace':view==='Edit'?'employee-form-body':'')+'">'+employeeWorkspaceNav(employee,view==='Overview'?'overview':'edit')+ (view==='Overview'?overview:form)+'</div>'+employeeWorkspaceFooter(employee,'Save'));
}
show('Overview');
</script></body></html>`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Stopped');server.close();server.closeAllConnections();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=resolve(root,'.'+decodeURIComponent(path));if(!file.startsWith(resolve(root,'css')+sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type','text/css');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4187,'127.0.0.1',()=>console.log('Synthetic modal typography: http://127.0.0.1:4187/'));
