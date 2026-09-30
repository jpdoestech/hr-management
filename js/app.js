import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../supabase-config.js';
import { paginationMeta, paginationHTML, paginationReset, paginateRows } from './core/pagination.js?v=20260928-4';
import { installTableEnhancer } from './core/table-enhancer.js?v=20260930-1';
import { compactRedundantPageIntros } from './core/content-layout.js?v=20260928-4';
import { buildRecordChanges, valuesEqual } from './core/record-diff.js?v=20260930-1';
import { roleCanExport } from './core/export-access.js?v=20260930-1';
import { addressComponentHTML, addressAutocompleteFocus, addressAutocompleteInput, addressAutocompleteBlur, addressAutocompleteKeydown, addressSelectOption, addressCopyFrom, initializeAddressComponents, readAddressComponent } from './address/address-component.js?v=20260929-1';
import { formatPhilippineAddress, normalizeAddress } from './address/address-models.js?v=20260929-1';

if(!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || SUPABASE_URL.includes('YOUR_PROJECT_REF')){
  document.body.innerHTML = '<div style="font-family:system-ui;padding:40px;max-width:760px;margin:auto"><h2>Supabase configuration missing</h2><p>Edit <b>supabase-config.js</b> with your Supabase project URL and publishable key.</p></div>';
  throw new Error('Supabase configuration missing');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/* =========================================================================
   SCPA HR MANAGEMENT & DISCIPLINARY DASHBOARD — GitHub Pages + Vercel + Supabase
   Phase 2: record-level Postgres persistence, Supabase Auth, and private Storage.
   ========================================================================= */

const RECORD_MODULES = ['employees','onboardingCandidates','leaves','disciplinary','nte','memos','nod','oncall','transfers','offenseCatalog','cvr','incidents','prf','evaluations','atd','workflowTasks','automationRuns','documents','lifecycleChecklists'];
let DB_SNAPSHOT = null;
let SAVE_QUEUE = Promise.resolve();
let SELF_SERVICE_READY = true;
let USER_PREFERENCES = {employeeColumns:[]};
let USER_PREFERENCES_SYNC_READY = true;
const DEFAULT_DEPARTMENT_NAMES = ['LOGISTICS','WAREHOUSE','UTILITY','MAINTENANCE','PRODUCTION','ADMIN','SALES'];

function blankDB(){
  return {employees:[],onboardingCandidates:[],leaves:[],disciplinary:[],nte:[],memos:[],nod:[],oncall:[],transfers:[],offenseCatalog:[],cvr:[],incidents:[],prf:[],evaluations:[],atd:[],workflowTasks:[],automationRuns:[],documents:[],lifecycleChecklists:[],serviceRequests:[],settings:{orgName:'SCPA',probationDays:180,fileStorageProvider:'supabase',googleDriveRootUrl:'',googleDriveClientId:'',branchLocations:['Main Office'],allowanceTypes:[],departments:DEFAULT_DEPARTMENT_NAMES.map(name=>({name,active:true})),positions:[]},audit:[],users:[]};
}
function uniqueSettingNames(values){
  const seen=new Set();
  return (Array.isArray(values)?values:[]).map(value=>String(value||'').trim()).filter(value=>{
    const key=value.toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;
  });
}
function employeeBranchLocations(){
  const configured=uniqueSettingNames(DB.settings?.branchLocations);
  return configured.length?configured:['Main Office'];
}
function employeeAllowanceTypes(){return uniqueSettingNames(DB.settings?.allowanceTypes);}
function normalizeDepartmentCatalog(values){
  const seen=new Set();
  return (Array.isArray(values)?values:[]).map(value=>typeof value==='string'?{name:value,active:true}:value).map(value=>({name:String(value?.name||'').trim(),active:value?.active!==false})).filter(value=>{
    const key=value.name.toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;
  });
}
function usedDepartmentNames(){
  const values=[];
  RECORD_MODULES.forEach(module=>(DB[module]||[]).forEach(record=>['department','fromDepartment','toDepartment'].forEach(key=>record?.[key]&&values.push(record[key]))));
  return uniqueSettingNames(values);
}
function departmentCatalog(){
  const configured=normalizeDepartmentCatalog(DB.settings?.departments);
  const base=configured.length?configured:DEFAULT_DEPARTMENT_NAMES.map(name=>({name,active:true}));
  const known=new Set(base.map(item=>item.name.toLowerCase()));
  usedDepartmentNames().forEach(name=>{if(!known.has(name.toLowerCase()))base.push({name,active:true});});
  return base;
}
function employeeDepartmentNames(current=''){
  const names=departmentCatalog().filter(item=>item.active||String(item.name).toLowerCase()===String(current).toLowerCase()).map(item=>item.name);
  return uniqueSettingNames([...names,current]);
}
function normalizePositionCatalog(values){
  const seen=new Set();
  return (Array.isArray(values)?values:[]).map(value=>typeof value==='string'?{name:value,department:'',active:true}:value).map(value=>({name:String(value?.name||'').trim(),department:String(value?.department||'').trim(),active:value?.active!==false})).filter(value=>{
    const key=`${value.department.toLowerCase()}|${value.name.toLowerCase()}`;if(!value.name||seen.has(key))return false;seen.add(key);return true;
  });
}
function positionCatalog(){
  const configured=normalizePositionCatalog(DB.settings?.positions);
  if(configured.length)return configured;
  const derived=[];
  (DB.employees||[]).forEach(employee=>employee.position&&derived.push({name:employee.position,department:employee.department||'',active:true}));
  (DB.onboardingCandidates||[]).forEach(candidate=>candidate.positionApplied&&derived.push({name:candidate.positionApplied,department:candidate.department||'',active:true}));
  return normalizePositionCatalog(derived);
}
function employeePositionNames(department='',current=''){
  const dept=String(department||'').toLowerCase();
  const names=positionCatalog().filter(item=>(!dept||item.department.toLowerCase()===dept)&&(item.active||item.name.toLowerCase()===String(current).toLowerCase())).map(item=>item.name);
  return uniqueSettingNames([...names,current]);
}

function isMissingSelfServiceTable(error){
  return ['42P01','PGRST205','PGRST204'].includes(error?.code) || /hr_service_requests/i.test(error?.message||'')&&/not find|does not exist|schema cache/i.test(error?.message||'');
}
function isMissingPreferencesTable(error){
  return ['42P01','PGRST205','PGRST204'].includes(error?.code) || /hr_user_preferences/i.test(error?.message||'')&&/not find|does not exist|schema cache/i.test(error?.message||'');
}
function userPreferencesStorageKey(){ return `slsc_hr_preferences_v1:${SESSION?.id||'guest'}`; }
function localUserPreferences(){
  try{
    const parsed=JSON.parse(localStorage.getItem(userPreferencesStorageKey())||'{}');
    return parsed&&typeof parsed==='object'?parsed:{};
  }catch(e){ return {}; }
}
async function loadUserPreferences(){
  USER_PREFERENCES={...USER_PREFERENCES,...localUserPreferences()};
  if(!SESSION?.id) return USER_PREFERENCES;
  const {data,error}=await supabase.from('hr_user_preferences').select('data').eq('user_id',SESSION.id).maybeSingle();
  if(error){
    if(isMissingPreferencesTable(error)){USER_PREFERENCES_SYNC_READY=false;return USER_PREFERENCES;}
    console.warn('Could not load account preferences',error);
    return USER_PREFERENCES;
  }
  USER_PREFERENCES_SYNC_READY=true;
  if(data?.data&&typeof data.data==='object') USER_PREFERENCES={...USER_PREFERENCES,...data.data};
  try{ localStorage.setItem(userPreferencesStorageKey(),JSON.stringify(USER_PREFERENCES)); }catch(e){}
  return USER_PREFERENCES;
}
async function persistUserPreferences(){
  try{ localStorage.setItem(userPreferencesStorageKey(),JSON.stringify(USER_PREFERENCES)); }catch(e){}
  if(!SESSION?.id) return false;
  const {error}=await supabase.from('hr_user_preferences').upsert({user_id:SESSION.id,data:USER_PREFERENCES,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(error){
    if(isMissingPreferencesTable(error)){USER_PREFERENCES_SYNC_READY=false;return false;}
    toast('Column view was saved on this browser, but account sync failed: '+error.message,true);
    return false;
  }
  USER_PREFERENCES_SYNC_READY=true;
  return true;
}
async function loadServiceRequests(target=DB){
  const {data,error}=await supabase.from('hr_service_requests').select('id,request_type,employee_profile_id,employee_record_id,manager_profile_id,status,payload,employee_note,reviewer_remarks,submitted_at,reviewed_at,reviewed_by,updated_at').order('submitted_at',{ascending:false});
  if(error){
    if(isMissingSelfServiceTable(error)){SELF_SERVICE_READY=false;target.serviceRequests=[];return [];}
    throw error;
  }
  SELF_SERVICE_READY=true;
  target.serviceRequests=data||[];
  return target.serviceRequests;
}

async function loadDB(){
  const empty = blankDB();
  const {data:rows,error} = await supabase.from('hr_records').select('module,record_id,data,updated_at').order('updated_at',{ascending:true});
  if(error) throw error;
  (rows||[]).forEach(r=>{
    if(!RECORD_MODULES.includes(r.module))return;
    const record={...(r.data||{})};
    delete record._dataResetAt;
    (empty[r.module]||(empty[r.module]=[])).push(record);
  });

  const {data:settings,error:settingsError}=await supabase.from('hr_settings').select('data').eq('id','singleton').maybeSingle();
  if(settingsError) throw settingsError;
  if(settings?.data) empty.settings=settings.data;

  if(isHRRole()){
    const {data:audit,error:auditError}=await supabase.from('hr_audit_logs').select('created_at,user_name,action').order('created_at',{ascending:false}).limit(200);
    if(auditError) throw auditError;
    empty.audit=(audit||[]).map(a=>({ts:a.created_at,user:a.user_name||'System',action:a.action}));
  }
  await loadServiceRequests(empty);

  const hasRecords = (rows||[]).length>0;
  if(!hasRecords&&isHRRole()){
    // Phase 1 migration: if the old singleton exists, import it once.
    const {data:legacy,error:legacyError}=await supabase.from('hr_app_state').select('data').eq('id','singleton').maybeSingle();
    if(legacyError && legacyError.code!=='PGRST116') throw legacyError;
    if(legacy?.data){
      const migrated={...empty,...legacy.data};
      delete migrated.users;
      await saveDBInternal(migrated);
      return migrated;
    }
  }
  DB_SNAPSHOT=JSON.parse(JSON.stringify(empty));
  return empty;
}

async function saveDBInternal(state){
  const now=new Date().toISOString();
  const {data:serverSettings,error:resetCheckError}=await supabase.from('hr_settings').select('data').eq('id','singleton').maybeSingle();
  if(resetCheckError) throw resetCheckError;
  const serverResetAt=serverSettings?.data?.dataResetAt||'';
  const clientResetAt=state.settings?.dataResetAt||'';
  if(serverResetAt&&serverResetAt!==clientResetAt){
    throw new Error('The HR database was reset in another session. Reload this page before making changes.');
  }
  const changes=buildRecordChanges(DB_SNAPSHOT||blankDB(),state,RECORD_MODULES);
  const rows=changes.upserts.map(({module,recordId,record})=>({module,record_id:recordId,data:{...record,_dataResetAt:clientResetAt},updated_at:now,updated_by:SESSION?.id||null}));
  for(let index=0;index<rows.length;index+=250){
    const {error}=await supabase.from('hr_records').upsert(rows.slice(index,index+250),{onConflict:'module,record_id'});
    if(error) throw error;
  }
  const deletesByModule=changes.deletes.reduce((map,change)=>{
    if(!map.has(change.module))map.set(change.module,[]);
    map.get(change.module).push(change);
    return map;
  },new Map());
  for(const [module,deletes] of deletesByModule){
    for(let index=0;index<deletes.length;index+=250){
      const ids=deletes.slice(index,index+250).map(change=>change.recordId);
      const {error}=await supabase.from('hr_records').delete().eq('module',module).in('record_id',ids);
      if(error) throw error;
    }
  }
  if(SESSION?.role==='Administrator'&&!valuesEqual(DB_SNAPSHOT?.settings,state.settings)){
    const {error:settingsError}=await supabase.from('hr_settings').upsert({id:'singleton',data:state.settings||{orgName:'SCPA',probationDays:180},updated_at:now,updated_by:SESSION?.id||null},{onConflict:'id'});
    if(settingsError) throw settingsError;
  }
  DB_SNAPSHOT=JSON.parse(JSON.stringify(state));
}

function saveDB(){
  const snapshot=JSON.parse(JSON.stringify(DB));
  SAVE_QUEUE=SAVE_QUEUE.then(async()=>{
    try{ await saveDBInternal(snapshot); return true; }
    catch(error){
      const resetConflict=/reset|stale HRIS session/i.test(error.message||'');
      toast(resetConflict?'The database was reset. Reloading this stale session…':'Database save failed: '+error.message,true);
      if(resetConflict)setTimeout(()=>window.location.reload(),900);
      return false;
    }
  });
  return SAVE_QUEUE;
}

let SERVER_RECORD_QUERY_READY=true;
function serverRecordQueryUnavailable(error){
  return ['42883','PGRST202','PGRST205'].includes(error?.code)||/search_hr_records|schema cache|function.*not find/i.test(error?.message||'');
}
function requestedPageState(scope,defaultSize=10){
  STATE.tablePages||={};STATE.tablePageSizes||={};
  const allowed=[10,25,50,100];
  const stored=STATE.tablePages[scope]||{};
  const size=allowed.includes(Number(stored.size))?Number(stored.size):allowed.includes(Number(STATE.tablePageSizes[scope]))?Number(STATE.tablePageSizes[scope]):defaultSize;
  return {page:Math.max(1,Number(stored.page)||1),size};
}
async function queryRecordPage({module,scope,search='',searchFields=[],filters={},classification='',sortKey='',defaultSize=10}){
  if(!SERVER_RECORD_QUERY_READY)return null;
  const requested=requestedPageState(scope,defaultSize);
  const run=async page=>supabase.rpc('search_hr_records',{
    p_module:module,p_search:String(search||'').trim(),p_search_fields:searchFields,
    p_filters:Object.fromEntries(Object.entries(filters).filter(([key,value])=>key&&String(value||'')!=='')),
    p_classification:classification||'',p_probation_days:Number(DB.settings?.probationDays)||180,
    p_sort_key:sortKey||'',p_offset:(page-1)*requested.size,p_limit:requested.size
  });
  let page=requested.page;
  let {data,error}=await run(page);
  if(error){
    if(serverRecordQueryUnavailable(error)){SERVER_RECORD_QUERY_READY=false;console.info('Server record pagination is unavailable; using local pagination until Phase 16 is applied.');return null;}
    throw error;
  }
  let total=Number(data?.[0]?.total_count||0);
  const pages=Math.max(1,Math.ceil(total/requested.size));
  if(page>pages){page=pages;({data,error}=await run(page));if(error)throw error;total=Number(data?.[0]?.total_count||0);}
  STATE.tablePageSizes[scope]=requested.size;
  STATE.tablePages[scope]={page,size:requested.size,signature:'server'};
  return {rows:(data||[]).map(row=>row.data),meta:{key:scope,total,size:requested.size,pages:Math.max(1,Math.ceil(total/requested.size)),page,start:total?(page-1)*requested.size+1:0,end:Math.min(total,page*requested.size)},server:true};
}
function serverTablePageGo(scope,page){
  const current=requestedPageState(scope);STATE.tablePages[scope]={...current,page:Math.max(1,Number(page)||1),signature:'server'};
  Promise.resolve(RENDERERS[STATE.view]?.()).catch(error=>toast('Could not load that page: '+error.message,true));
}
function serverTablePageSize(scope,size){
  const next=[10,25,50,100].includes(Number(size))?Number(size):10;
  STATE.tablePageSizes[scope]=next;STATE.tablePages[scope]={page:1,size:next,signature:'server'};
  Promise.resolve(RENDERERS[STATE.view]?.()).catch(error=>toast('Could not change the page size: '+error.message,true));
}

async function loadProfiles(){
  let {data,error}=await supabase.from('profiles').select('id,full_name,username,email,role,can_export,employee_record_id,manager_profile_id,created_at').order('created_at');
  if(error&&['42703','PGRST204'].includes(error.code))({data,error}=await supabase.from('profiles').select('id,full_name,username,email,role,employee_record_id,manager_profile_id,created_at').order('created_at'));
  if(error) throw error;
  DB.users=(data||[]).map(p=>({id:p.id,fullName:p.full_name,username:p.username,email:p.email,role:p.role,canExport:p.can_export===true,employeeRecordId:p.employee_record_id||'',managerProfileId:p.manager_profile_id||'',createdAt:p.created_at?.slice(0,10)||todayISO()}));
}

async function persistStateAndProfiles(){ await saveDB(); await loadProfiles(); }

/* ---------------- attachment storage router ---------------- */
const MAX_ATTACH_BYTES = 10*1024*1024;
const STORAGE_BUCKET = 'hr-documents';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_DRIVE_PREFIX = 'gdrive:';
let PENDING_UPLOADS = new Set();
let GOOGLE_DRIVE_TOKEN = {accessToken:'',expiresAt:0};
let GOOGLE_DRIVE_TOKEN_CLIENT = null;

function attachmentStorageProvider(){ return DB.settings?.fileStorageProvider==='google-drive'?'google-drive':'supabase'; }
function storageRefProvider(ref){ return String(ref||'').startsWith(GOOGLE_DRIVE_PREFIX)?'google-drive':'supabase'; }
function googleDriveRef(fileId){ return `${GOOGLE_DRIVE_PREFIX}${fileId}`; }
function googleDriveFileIdFromRef(ref){ return storageRefProvider(ref)==='google-drive'?String(ref).slice(GOOGLE_DRIVE_PREFIX.length):''; }
function googleDriveFileUrl(ref){ const id=googleDriveFileIdFromRef(ref)||documentDriveFileId(ref); return id?`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`:''; }
function uploadModuleFolder(module){
  const aliases={onboardingCandidates:'onboarding',leaves:'leave',memos:'memo',incidents:'incident',evaluations:'evaluation',employees:'employee',disciplinary:'disciplinary',nte:'nte',nod:'nod',oncall:'on-call',transfers:'transfer',cvr:'cvr',prf:'prf',atd:'atd',cases:'case',documents:'documents'};
  return aliases[module]||String(module||'documents').replace(/[^a-zA-Z0-9_-]/g,'-').toLowerCase();
}
function uploadFilenamePart(value,fallback='unknown'){
  const clean=String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9, -]+/g,' ').replace(/\s+/g,' ').trim();
  return clean||fallback;
}
function uploadDocumentType(module,key){
  const specific={resume:'resume',preEmploymentDocs:'pre-employment-documents',atdForm:'atd',incidentReport:'incident-report',quotation:'quotation-soa',payslip:'payslip'};
  return specific[key]||uploadModuleFolder(module).replace(/[^a-zA-Z0-9-]/g,'-');
}
function uploadEmployeeContext(){
  const pickerIds=['f_employeeName','cv_employeeName','in_employeeName'];
  let employee=pickerIds.map(id=>employeePickerSelected(id)).find(Boolean)||null;
  const explicit=document.querySelector('[data-upload-employee-id],[data-upload-record-id]');
  if(!employee&&explicit?.dataset.uploadEmployeeId) employee=DB.employees.find(row=>String(row.id)===String(explicit.dataset.uploadEmployeeId))||null;
  if(employee) return {name:employeeDisplayName(employee),employeeNo:employee.employeeNo||'',department:employee.department||''};
  const lastName=document.getElementById('f_lastName')?.value||'';
  const firstName=document.getElementById('f_firstName')?.value||'';
  const middleName=document.getElementById('f_middleName')?.value||'';
  const explicitName=explicit?.dataset.uploadEmployeeName||'';
  const typedName=pickerIds.map(id=>document.getElementById(`${id}_search`)?.value||'').find(Boolean)||'';
  return {
    name:formatEmployeeName({lastName,firstName,middleName})||explicitName||typedName||'HR Record',
    employeeNo:explicit?.dataset.uploadEmployeeNo||explicit?.dataset.uploadRecordId||'pending',
    department:explicit?.dataset.uploadDepartment||document.getElementById('f_department')?.value||'unassigned',
  };
}
function managedUploadFilename(file,module,key){
  const context=uploadEmployeeContext();
  if(context.name==='HR Record') throw new Error('Select an employee or enter the applicant name before choosing a file.');
  const extension=(String(file?.name||'').match(/\.([a-zA-Z0-9]{1,10})$/)||[])[1]?.toLowerCase()||'file';
  const employeeNumber=String(context.employeeNo||'').replace(/^EMP[\s_-]*/i,'').replace(/[^a-zA-Z0-9-]/g,'')||'pending';
  const department=String(context.department||'').toLowerCase().replace(/\b\w/g,char=>char.toUpperCase());
  return `${uploadFilenamePart(context.name,'HR Record')}_${uploadFilenamePart(employeeNumber,'pending')}_${uploadFilenamePart(department,'Unassigned')}_${uploadFilenamePart(uploadDocumentType(module,key),'document')}.${extension}`;
}
function googleDriveRootFolderId(){ return documentDriveFileId(DB.settings?.googleDriveRootUrl||''); }
function googleDriveRequest(path,options={}){
  return fetch(path,{...options,headers:{Authorization:`Bearer ${GOOGLE_DRIVE_TOKEN.accessToken}`,...(options.headers||{})}}).then(async response=>{
    if(response.ok) return response.status===204?null:response.json();
    const payload=await response.json().catch(()=>({}));
    const error=new Error(payload?.error?.message||`Google Drive request failed (${response.status}).`);
    error.status=response.status;
    throw error;
  });
}
function ensureGoogleIdentityServices(){
  if(window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-google-identity]');
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(new Error('Google authorization could not be loaded.')),{once:true});return;}
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;script.dataset.googleIdentity='true';script.onload=resolve;script.onerror=()=>reject(new Error('Google authorization could not be loaded.'));document.head.appendChild(script);
  });
}
async function requestGoogleDriveAccessToken(forcePrompt=false){
  if(GOOGLE_DRIVE_TOKEN.accessToken&&GOOGLE_DRIVE_TOKEN.expiresAt>Date.now()+60000&&!forcePrompt) return GOOGLE_DRIVE_TOKEN.accessToken;
  const clientId=String(DB.settings?.googleDriveClientId||'').trim();
  if(!clientId) throw new Error('Google Drive OAuth Client ID is not configured in Settings.');
  await ensureGoogleIdentityServices();
  return new Promise((resolve,reject)=>{
    GOOGLE_DRIVE_TOKEN_CLIENT=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:GOOGLE_DRIVE_SCOPE,callback:response=>{
      if(response?.error){reject(new Error(response.error_description||response.error));return;}
      GOOGLE_DRIVE_TOKEN={accessToken:response.access_token,expiresAt:Date.now()+(Number(response.expires_in)||3600)*1000};
      resolve(response.access_token);
    },error_callback:error=>reject(new Error(error?.message||error?.type||'Google authorization was cancelled.'))});
    GOOGLE_DRIVE_TOKEN_CLIENT.requestAccessToken({prompt:forcePrompt?'consent':''});
  });
}
async function googleDriveModuleFolder(module){
  await requestGoogleDriveAccessToken();
  const rootId=googleDriveRootFolderId();
  if(!rootId) throw new Error('A valid Google Drive Root Folder URL is required in Settings.');
  const folderName=uploadModuleFolder(module);
  const escaped=folderName.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const q=encodeURIComponent(`'${rootId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found=await googleDriveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if(found?.files?.[0]?.id) return found.files[0].id;
  const created=await googleDriveRequest('https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:folderName,mimeType:'application/vnd.google-apps.folder',parents:[rootId]})});
  return created.id;
}
async function uploadGoogleDriveAttachment(file,module,managedName=file.name){
  const folderId=await googleDriveModuleFolder(module);
  const metadata={name:managedName,parents:[folderId],description:`SLSC HR upload · ${uploadModuleFolder(module)}`};
  let uploaded;
  if(file.size<=5*1024*1024){
    const boundary=`slsc_hr_${Date.now()}`;
    const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.type||'application/octet-stream'}\r\n\r\n`,file,`\r\n--${boundary}--`]);
    uploaded=await googleDriveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
  }else{
    const start=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink&supportsAllDrives=true',{method:'POST',headers:{Authorization:`Bearer ${GOOGLE_DRIVE_TOKEN.accessToken}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':file.type||'application/octet-stream','X-Upload-Content-Length':String(file.size)},body:JSON.stringify(metadata)});
    if(!start.ok) throw new Error((await start.json().catch(()=>({})))?.error?.message||'Could not start the Google Drive upload.');
    const location=start.headers.get('Location');
    if(!location) throw new Error('Google Drive did not return a resumable upload location.');
    const finish=await fetch(location,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
    if(!finish.ok) throw new Error((await finish.json().catch(()=>({})))?.error?.message||'Google Drive upload failed.');
    uploaded=await finish.json();
  }
  return {path:googleDriveRef(uploaded.id),name:uploaded.name||managedName,provider:'google-drive',url:uploaded.webViewLink||googleDriveFileUrl(googleDriveRef(uploaded.id)),folder:uploadModuleFolder(module)};
}

function recordStoragePaths(value, out=new Set()){
  if(!value) return out;
  if(Array.isArray(value)){ value.forEach(v=>recordStoragePaths(v,out)); return out; }
  if(typeof value==='object'){
    Object.entries(value).forEach(([key,v])=>{
      if(key.endsWith('Data') && typeof v==='string' && v) out.add(v);
      else if(v && typeof v==='object') recordStoragePaths(v,out);
    });
  }
  return out;
}

async function deleteStorageObject(path){
  if(!path) return true;
  if(storageRefProvider(path)==='google-drive'){
    try{
      await requestGoogleDriveAccessToken();
      await googleDriveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(googleDriveFileIdFromRef(path))}?supportsAllDrives=true`,{method:'DELETE'});
      PENDING_UPLOADS.delete(path);
      return true;
    }catch(error){console.warn('Google Drive cleanup failed',path,error);toast('The record was updated, but the Google Drive file could not be removed: '+error.message,true);return false;}
  }
  const {error}=await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if(error){ console.warn('Storage cleanup failed',path,error); return false; }
  PENDING_UPLOADS.delete(path);
  return true;
}

async function deleteStorageObjects(paths){
  const list=[...new Set((paths||[]).filter(Boolean))];
  if(!list.length) return;
  for(const path of list) await deleteStorageObject(path);
}

function rememberCommittedRecordFiles(rec){
  recordStoragePaths(rec).forEach(path=>PENDING_UPLOADS.delete(path));
}

async function uploadAttachment(file,module='documents',managedName=file?.name||'document'){
  if(!file) return {path:'',name:''};
  if(file.size > MAX_ATTACH_BYTES){ toast(`"${file.name}" is too large (max ${Math.round(MAX_ATTACH_BYTES/1024/1024)}MB per file).`, true); throw new Error('File too large'); }
  if(attachmentStorageProvider()==='google-drive'){
    const uploaded=await uploadGoogleDriveAttachment(file,module,managedName);
    PENDING_UPLOADS.add(uploaded.path);
    return uploaded;
  }
  const safe = managedName.replace(/[^a-zA-Z0-9., _-]/g,'_');
  const path = `${SESSION.id}/${uploadModuleFolder(module)}/${Date.now()}-${uid()}-${safe}`;
  const {error}=await supabase.storage.from(STORAGE_BUCKET).upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
  if(error){ toast('Upload failed: '+error.message,true); throw error; }
  PENDING_UPLOADS.add(path);
  return {path,name:managedName,provider:'supabase'};
}

async function downloadAttachment(path, filename){
  if(!path){ toast('No stored file for this attachment.'); return; }
  if(storageRefProvider(path)==='google-drive'){
    const url=googleDriveFileUrl(path);
    if(url) window.open(url,'_blank','noopener,noreferrer');
    else toast('The Google Drive file reference is invalid.',true);
    return;
  }
  const {data,error}=await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path,120);
  if(error){ toast('Could not create download link: '+error.message,true); return; }
  const a=document.createElement('a'); a.href=data.signedUrl; a.target='_blank'; a.rel='noopener'; a.download=filename||'attachment'; document.body.appendChild(a); a.click(); a.remove();
}

async function handleFileInput(key, inputEl, module='documents'){
  const file=inputEl.files && inputEl.files[0]; if(!file) return;
  try{
    inputEl.disabled=true;
    const uploaded=await uploadAttachment(file,module,managedUploadFilename(file,module,key));
    document.getElementById('f_'+key).value=uploaded.name;
    document.getElementById('f_'+key+'_data').value=uploaded.path;
    const prev=document.getElementById('f_'+key+'_preview'); if(prev) prev.innerHTML=attachPreviewHTML(key,uploaded.name,uploaded.path);
    toast(`Uploaded to ${uploaded.provider==='google-drive'?`Google Drive / ${uploaded.folder}`:'Supabase Storage'}.`);
  }catch(e){ inputEl.value=''; toast('Upload failed: '+e.message,true); }
  finally{inputEl.disabled=false;}
}
async function clearFileField(key){
  const dataEl=document.getElementById('f_'+key+'_data');
  const path=dataEl?.value||'';
  document.getElementById('f_'+key).value='';
  dataEl.value='';
  const prev=document.getElementById('f_'+key+'_preview'); if(prev) prev.innerHTML='';
  // Newly uploaded files are safe to remove immediately. Existing committed
  // files are deleted only after the edited record successfully saves.
  if(path && PENDING_UPLOADS.has(path)) await deleteStorageObject(path);
}
function attachPreviewHTML(key,name,path){
  if(!name) return '';
  const provider=storageRefProvider(path);
  return `<div class="attach-preview">${iDoc(14)}<span class="mono" style="font-size:12px;">${esc(name)}</span>${path?`<span class="attachment-provider">${provider==='google-drive'?'Drive':'Supabase'}</span><button type="button" class="iconbtn" title="Open file" onclick="downloadAttachment('${esc(path)}','${esc(name).replace(/'/g,"\\'")}')">${iDownload(13)}</button>`:''}<button type="button" class="iconbtn" title="Remove" onclick="clearFileField('${key}')">${iTrash(13)}</button></div>`;
}

const EMP_STATUS = ['Active','AWOL','Resigned','Transferred to Another Department','Separated','Returned to Agency','Newly Hired'];
const LEAVE_TYPES = ['Vacation Leave','Sick Leave','Emergency Leave','Maternity Leave','Paternity Leave','Bereavement Leave','Others'];
const LEAVE_STATUS = ['Pending','Approved','Ongoing','Completed','Disapproved'];
const NTE_STATUS = ['Pending Explanation','Explanation Submitted','Under Review','Resolved'];
const ONCALL_STATUS = ['Active','Completed','Cancelled'];
const OFFENSE_LEVELS = ['1st Offense','2nd Offense','3rd Offense','4th Offense+'];
const CVR_STATUS = ['Pending Review','Acknowledged','Escalated to NTE','Resolved'];
const CVR_STATUS_MAP = {'Pending Review':'b-amber','Acknowledged':'b-blue','Escalated to NTE':'b-red','Resolved':'b-green'};
const INCIDENT_TYPES = ['Workplace Accident','Property Damage / Loss','Safety Violation','Equipment Malfunction','Altercation / Conflict','Theft','Near Miss'];
const INCIDENT_SEVERITY = ['Minor','Moderate','Major','Critical'];
const INCIDENT_SEVERITY_MAP = {'Minor':'b-grey','Moderate':'b-amber','Major':'b-red','Critical':'b-red'};
const INCIDENT_STATUS = ['Reported','Under Investigation','Resolved','Closed'];
const INCIDENT_STATUS_MAP = {'Reported':'b-amber','Under Investigation':'b-blue','Resolved':'b-green','Closed':'b-grey'};
const PRF_CLASS = ['Replacement for Resigned Personnel','Replacement for AWOL Personnel','Replacement for Separated Personnel','Replacement for Other Reasons','Additional Manpower (Add-On)'];
const PRF_STATUS = ['Draft','Pending Approval','Approved','Rejected','Filled','Closed'];
const PRF_STATUS_MAP = {'Draft':'b-grey','Pending Approval':'b-amber','Approved':'b-green','Rejected':'b-red','Filled':'b-blue','Closed':'b-grey'};
const EVAL_MILESTONES = [{key:'1st', label:'1st Month', days:30},{key:'3rd', label:'3rd Month', days:90},{key:'6th', label:'6th Month', days:180}];
const ATD_CATEGORIES = ['Uniforms/Expenses','Charges'];
const ATD_STATUS_MAP = {'Pending':'b-amber','Ongoing':'b-blue','Paid':'b-green'};
const ATD_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ATD_CUTOFFS = ['1st Cut-Off','2nd Cut-Off'];
const ONBOARDING_STAGES = ['Applicant','Screening','Interview','For Offer','Pre-employment','Ready to Hire','Hired','Rejected','Withdrawn'];
const ONBOARDING_STAGE_MAP = {'Applicant':'b-grey','Screening':'b-blue','Interview':'b-blue','For Offer':'b-amber','Pre-employment':'b-amber','Ready to Hire':'b-green','Hired':'b-green','Rejected':'b-red','Withdrawn':'b-grey'};
const ONBOARDING_RECOMMENDATIONS = ['Pending','Hire','Hold','Reject'];
const ONBOARDING_CHECKLIST = [
  {key:'privacyNotice',label:'Applicant privacy notice acknowledged',group:'Application'},
  {key:'resume',label:'Resume / application form received',group:'Application'},
  {key:'identity',label:'Government ID or birth record verified',group:'Identity'},
  {key:'interview',label:'Interview and evaluation completed',group:'Selection'},
  {key:'offer',label:'Offer accepted',group:'Employment'},
  {key:'contract',label:'Employment contract signed',group:'Employment'},
  {key:'standards',label:'Probationary standards communicated',group:'Employment'},
  {key:'medical',label:'Medical / fitness clearance received',group:'Pre-employment'},
  {key:'bir',label:'BIR Form 1902 / TIN verified',group:'Government'},
  {key:'sss',label:'SSS number / coverage details verified',group:'Government'},
  {key:'philHealth',label:'PhilHealth PIN / PMRF details verified',group:'Government'},
  {key:'pagIbig',label:'Pag-IBIG MID / MDF details verified',group:'Government'},
  {key:'payroll',label:'Payroll account details completed',group:'Company'},
  {key:'orientation',label:'Company and safety orientation scheduled',group:'Company'},
];
function defaultOffenseCatalog(){
  return [
    {id:uid(), offense:'Tardiness', consequence1:'Verbal Reminder', consequence2:'Written Warning', consequence3:'Suspension (3 days)', consequence4:'Termination'},
    {id:uid(), offense:'Unauthorized Absence (AWOL)', consequence1:'Written Warning', consequence2:'Suspension (5 days)', consequence3:'Suspension (10 days)', consequence4:'Termination'},
    {id:uid(), offense:'Insubordination', consequence1:'Written Warning', consequence2:'Suspension (3 days)', consequence3:'Termination', consequence4:'Termination'},
    {id:uid(), offense:'Sleeping on Duty', consequence1:'Verbal Reminder', consequence2:'Written Warning', consequence3:'Suspension (3 days)', consequence4:'Termination'},
    {id:uid(), offense:'Negligence of Duty', consequence1:'Written Warning', consequence2:'Suspension (5 days)', consequence3:'Termination', consequence4:'Termination'},
  ];
}

function uid(){ return 'r' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(d){ if(!d) return '—'; const dt=new Date(d+'T00:00:00'); if(isNaN(dt)) return d; return dt.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}); }
function daysBetweenInclusive(a,b){ if(!a||!b) return ''; const d1=new Date(a+'T00:00:00'), d2=new Date(b+'T00:00:00'); const diff=Math.round((d2-d1)/86400000)+1; return diff>0?diff:''; }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- seed data ---------------- */
function seedDB(){
  const users = [
  ];
  const employees = [
    {id:uid(), prfNumber:'PRF-2019-0011', name:'Ramon Dizon', position:'Warehouse Supervisor', department:'WAREHOUSE', dateHired:'2019-03-11', gender:'Male', status:'Active', classOverride:'Auto'},
    {id:uid(), prfNumber:'PRF-2023-0004', name:'Liza Fernandez', position:'HR Officer', department:'ADMIN', dateHired:'2023-01-16', gender:'Female', status:'Active', classOverride:'Auto'},
    {id:uid(), prfNumber:'PRF-2026-0128', name:'Carlo Mendoza', position:'Maintenance Technician', department:'MAINTENANCE', dateHired:'2026-06-01', gender:'Male', status:'Newly Hired', classOverride:'Auto'},
    {id:uid(), prfNumber:'PRF-2021-0037', name:'Angela Reyes', position:'Accounting Clerk', department:'ADMIN', dateHired:'2021-09-20', gender:'Female', status:'Active', classOverride:'Auto'},
    {id:uid(), prfNumber:'PRF-2024-0086', name:'Bryan Torres', position:'Utility Worker', department:'UTILITY', dateHired:'2024-11-04', gender:'Male', status:'AWOL', classOverride:'Auto'},
    {id:uid(), prfNumber:'PRF-2020-0024', name:'Kristine Uy', position:'Production Analyst', department:'PRODUCTION', dateHired:'2020-05-18', gender:'Female', status:'Transferred to Another Department', classOverride:'Auto'},
    {id:uid(), prfNumber:'PRF-2018-0006', name:'Noel Bautista', position:'Logistics Coordinator', department:'LOGISTICS', dateHired:'2018-02-09', gender:'Male', status:'Active', classOverride:'Auto'},
    {id:uid(), prfNumber:'PRF-2026-0148', name:'Fatima Castillo', position:'Sales Associate', department:'SALES', dateHired:'2026-07-15', gender:'Female', status:'Newly Hired', classOverride:'Auto'},
  ];
  const byName = n => employees.find(e=>e.name===n);
  const leaves = [
    {id:uid(), employeeName:'Ramon Dizon', position:byName('Ramon Dizon').position, department:'WAREHOUSE', leaveType:'Vacation Leave', startDate: shiftDate(3), endDate: shiftDate(6), reason:'Family trip', dateApplied: shiftDate(-4), dateReceived: shiftDate(-4), attachment:'ramon_leaveform.pdf', status:'Approved', remarks:''},
    {id:uid(), employeeName:'Angela Reyes', position:byName('Angela Reyes').position, department:'ADMIN', leaveType:'Sick Leave', startDate: shiftDate(-2), endDate: shiftDate(0), reason:'Flu', dateApplied: shiftDate(-3), dateReceived: shiftDate(-2), attachment:'angela_sickleave.pdf', status:'Ongoing', remarks:'Medical certificate on file'},
    {id:uid(), employeeName:'Kristine Uy', position:byName('Kristine Uy').position, department:'PRODUCTION', leaveType:'Emergency Leave', startDate: shiftDate(-10), endDate: shiftDate(-9), reason:'Family emergency', dateApplied: shiftDate(-11), dateReceived: shiftDate(-10), attachment:'', status:'Completed', remarks:''},
  ];
  const disciplinary = [
    {id:uid(), employeeName:'Bryan Torres', department:'UTILITY', violation:'Unauthorized absence (AWOL)', dateOfIncident: shiftDate(-20), action:'Written Warning', remarks:'Referred to NTE'},
    {id:uid(), employeeName:'Bryan Torres', department:'UTILITY', violation:'Tardiness', dateOfIncident: shiftDate(-40), action:'Verbal Reminder', remarks:''},
    {id:uid(), employeeName:'Carlo Mendoza', department:'MAINTENANCE', violation:'Improper use of safety equipment', dateOfIncident: shiftDate(-15), action:'Verbal Reminder', remarks:'Coaching conducted'},
  ];
  const nte = [
    {id:uid(), employeeName:'Bryan Torres', department:'UTILITY', violation:'Unauthorized absence (AWOL)', dateIssued: shiftDate(-18), dateReceived: shiftDate(-17), attachment:'nte_btorres.pdf', explanation:'Family matter, will submit medical proof.', status:'Explanation Submitted', remarks:''},
  ];
  const memos = [
    {id:uid(), employeeName:'Bryan Torres', department:'UTILITY', offenseType:'AWOL', action:'Written Warning', dateOfMemo: shiftDate(-10), dateReceived: shiftDate(-9), attachment:'memo_btorres.pdf', remarks:''},
  ];
  const nod = [];
  const transfers = [
    {id:uid(), employeeName:'Kristine Uy', fromDepartment:'WAREHOUSE', fromDate: shiftDate(-95), toDepartment:'PRODUCTION', toDate: shiftDate(-90), remarks:'Reassigned due to staffing need.'},
  ];
  const offenseCatalog = defaultOffenseCatalog();
  const cvr = [
    {id:uid(), employeeName:'Bryan Torres', department:'UTILITY', dateOfCVR: shiftDate(-19), offenses:['Unauthorized Absence (AWOL)'], otherOffense:'', attachment:'cvr_btorres.pdf', attachmentData:'', status:'Escalated to NTE', remarks:'Basis for NTE issuance.'},
  ];
  const incidents = [
    {id:uid(), employeeName:'Carlo Mendoza', department:'MAINTENANCE', dateOfIncident: shiftDate(-15), incidentTypes:['Safety Violation'], otherType:'', severity:'Moderate', description:'Employee observed not wearing required PPE while operating machinery.', attachment:'incident_cmendoza.pdf', attachmentData:'', status:'Resolved', remarks:'Coaching conducted; related Disciplinary Action record on file.'},
  ];
  const prf = [];
  const evaluations = [];
  const oncall = [
    {id:uid(), employeeName:'Jonalyn Perez', department:'WAREHOUSE', prfNumber:'PRF-2026-0142', reason:'Replacement for employee on Vacation Leave', employeeReplaced:'Ramon Dizon', startDate: shiftDate(3), endDate: shiftDate(6), status:'Active', remarks:''},
    {id:uid(), employeeName:'Mark Villanueva', department:'ADMIN', prfNumber:'PRF-2026-0139', reason:'Manpower requirement — month-end closing', employeeReplaced:'—', startDate: shiftDate(-6), endDate: shiftDate(-2), status:'Completed', remarks:''},
  ];
  const atd = [
    {id:uid(), employeeName:'Bryan Torres', department:'UTILITY', position:'Utility Worker', category:'Charges', atdDate: shiftDate(-18), deductionType:'Damaged equipment — negligence', totalAmount:4500, paymentTerms:'3 cut-offs', atdForm:'atd_btorres.pdf', atdFormData:'', incidentReport:'incident_btorres.pdf', incidentReportData:'', quotation:'quotation_repair.pdf', quotationData:'', soaAmount:4500, status:'Ongoing', remarks:'Linked to Incident Report on file.',
      payments:[{id:uid(), month:ATD_MONTHS[new Date().getMonth()], cutoff:'1st Cut-Off', amountPaid:1500, payslip:'payslip_btorres_c1.pdf', payslipData:'', dateRecorded: shiftDate(-4)}]},
  ];
  return {
    users, employees, onboardingCandidates:[], leaves, disciplinary, nte, memos, nod, oncall, transfers, offenseCatalog, cvr, incidents, prf, evaluations, atd, lifecycleChecklists:[],
    settings:{orgName:'SCPA', probationDays:180, branchLocations:['Main Office'], allowanceTypes:[]},
    audit:[{ts:new Date().toISOString(), user:'System', action:'Seeded initial demo data'}]
  };
}
function nextEmployeeNumber(list){
  const nums=(list||[]).map(e=>{ const m=String(e.employeeNo||'').match(/^EMP-(\d+)$/i); return m?parseInt(m[1],10):0; });
  const next=(Math.max(0,...nums)+1);
  return 'EMP-'+String(next).padStart(4,'0');
}
function normalizeEmployeeMasterData(){
  let changed=false;
  const used=new Set();
  (DB.employees||[]).forEach(e=>{
    if(!e.employeeNo || used.has(String(e.employeeNo).toUpperCase())){ e.employeeNo=nextEmployeeNumber(DB.employees.filter(x=>x!==e && x.employeeNo)); changed=true; }
    used.add(String(e.employeeNo).toUpperCase());
    ['birthDate','civilStatus','mobileNumber','personalEmail','address','remarks','branchReporting','tin','sssNumber','philHealthNumber','pagIbigNumber','emergencyContactName','emergencyContactRelationship','emergencyContactPhone'].forEach(k=>{ if(e[k]===undefined){ e[k]=''; changed=true; } });
    if(e.dailyRate===undefined){e.dailyRate='';changed=true;}
    if(!e.allowances||typeof e.allowances!=='object'||Array.isArray(e.allowances)){e.allowances={};changed=true;}
    const normalizedHome=normalizeAddress(e.homeAddress,e.address||'');
    const normalizedPresent=normalizeAddress(e.presentAddress,e.presentAddressText||e.address||'');
    if(JSON.stringify(e.homeAddress||null)!==JSON.stringify(normalizedHome)){e.homeAddress=normalizedHome;changed=true;}
    if(JSON.stringify(e.presentAddress||null)!==JSON.stringify(normalizedPresent)){e.presentAddress=normalizedPresent;changed=true;}
    const formattedHome=formatPhilippineAddress(normalizedHome);
    if(e.address!==formattedHome){e.address=formattedHome;changed=true;}
    const nameParts=splitEmployeeName(e);
    ['lastName','firstName','middleName'].forEach(key=>{if(e[key]===undefined){e[key]=nameParts[key]||'';changed=true;}});
    if(!Array.isArray(e.employmentHistory)){
      e.employmentHistory=[{type:'Employment Status',from:'',to:e.status||'Newly Hired',effectiveDate:e.statusDate||e.dateHired||'',remarks:'Initial employee record',changedAt:new Date().toISOString(),changedBy:'System'}];
      changed=true;
    }
  });
  return changed;
}

function shiftDate(days){ const d=new Date(); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }

let DB = blankDB();

let SESSION = null; // current user
let STATE = { view:'dashboard', search:'', filter:'', filterDept:'', filterStatus:'', employeeSearch:'', employeeDepartmentFilter:'', employeeBranchFilter:'', employeeStatusFilter:'', employeeClassFilter:'', lifecycleSearch:'', lifecycleFilter:'', checklistSearch:'', checklistType:'', checklistStatus:'Active', selfServiceSearch:'', selfServiceStatus:'', serviceApprovalSearch:'', serviceApprovalStatus:'Pending', actionSearch:'', actionLevel:'all', calMonth:new Date().getMonth(), calYear:new Date().getFullYear(), calSel:null, leaveTab:'records', weekStart:null, weeklyOpenCat:null, opsEmployeeId:'', workflowFilter:'queue', workflowStatus:'Pending', workflowType:'', workflowPriority:'', workflowDepartment:'', analyticsRange:'90d', analyticsStart:addDaysISO(new Date().toISOString().slice(0,10),-89), analyticsEnd:new Date().toISOString().slice(0,10), analyticsDept:'', reportStart:addDaysISO(new Date().toISOString().slice(0,10),-29), reportEnd:new Date().toISOString().slice(0,10), reportDept:'', documentStorage:'', documentCategory:'', documentExpiry:'', documentStatus:'', qualityFilter:'all', qualitySearch:'', automationFilter:'all', automationSearch:'', opsEmployeeSearch:'', opsEmployeeDept:'', opsEmployeeStatus:'', opsEmployeeClass:'', opsWorkFilter:'all', opsHistorySearch:'', disciplinaryFilter:'', cvrFilter:'', incidentFilter:'', evaluationFilter:'', tablePages:{}, tablePageSizes:{} };
let REPORT_CACHE = {cases:[], atdRows:[]};

/* ---------------- toast ---------------- */
let toastT;
function toast(msg, isError){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('on');
  t.classList.toggle('err', !!isError);
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'), isError?3400:2200);
}

/* ---------------- auth ---------------- */
function switchAuthTab(tab){
  const isLogin=tab==='login';
  const loginTab=document.getElementById('tab-login');
  const registerTab=document.getElementById('tab-register');
  loginTab.classList.toggle('active',isLogin);
  registerTab.classList.toggle('active',!isLogin);
  loginTab.setAttribute('aria-selected',String(isLogin));
  registerTab.setAttribute('aria-selected',String(!isLogin));
  document.getElementById('login-form').style.display = tab==='login'?'block':'none';
  document.getElementById('register-form').style.display = tab==='register'?'block':'none';
  document.querySelector('#auth-screen .auth-card')?.classList.toggle('registering',!isLogin);
  document.getElementById('auth-title').textContent=isLogin?'Welcome back':'Create your account';
  document.getElementById('auth-subtitle').textContent=isLogin?'Sign in to continue to your HR workspace.':'Register for secure access to SLSC people operations.';
  document.getElementById('auth-error').style.display='none';
}
function togglePasswordVisibility(inputId,button){
  const input=document.getElementById(inputId);
  if(!input) return;
  const reveal=input.type==='password';
  input.type=reveal?'text':'password';
  button.textContent=reveal?'Hide':'Show';
  button.setAttribute('aria-label',reveal?'Hide password':'Show password');
  input.focus();
}
function authErr(msg){ const e=document.getElementById('auth-error'); e.textContent=msg; e.style.display='block'; }

async function doLogin(ev){
  ev.preventDefault();
  const login=document.getElementById('li-user').value.trim();
  const p=document.getElementById('li-pass').value;
  if(!login||!p){ authErr('Please enter your email/username and password.'); return false; }
  let email=login;
  if(!login.includes('@')){
    const {data,error}=await supabase.rpc('get_login_email_by_username',{p_username:login.toLowerCase()});
    if(error){ authErr('Username lookup failed. Please use your email address or run supabase/fix-auth.sql.'); return false; }
    if(!data){ authErr('Username not found.'); return false; }
    email=data;
  }
  const {data,error}=await supabase.auth.signInWithPassword({email,password:p});
  if(error){ authErr(error.message); return false; }
  await bootAuthenticated(data.user);
  return false;
}
async function doRegister(ev){
  ev.preventDefault();
  const name=document.getElementById('rg-name').value.trim();
  const user=document.getElementById('rg-user').value.trim().toLowerCase();
  const email=document.getElementById('rg-email').value.trim().toLowerCase();
  const pass=document.getElementById('rg-pass').value;
  const pass2=document.getElementById('rg-pass2').value;
  if(!name||!user||!email||!pass){ authErr('Please complete all fields.'); return false; }
  if(pass!==pass2){ authErr('Passwords do not match.'); return false; }
  const {data:existingUsername}=await supabase.from('profiles').select('id').eq('username',user).maybeSingle();
  const {data:existingEmail}=await supabase.from('profiles').select('id').eq('email',email).maybeSingle();
  if(existingUsername || existingEmail){ authErr('That username or email is already registered.'); return false; }
  const {data,error}=await supabase.auth.signUp({email,password:pass,options:{data:{full_name:name,username:user}}});
  if(error){ authErr(error.message); return false; }
  if(!data.session){ authErr('Account created. Check your email to confirm the account, then log in.'); switchAuthTab('login'); return false; }
  await bootAuthenticated(data.user);
  return false;
}
async function bootAuthenticated(user){
  try{
    let {data:ownProfile,error:profileError}=await supabase.from('profiles').select('id,full_name,username,email,role,can_export,employee_record_id,manager_profile_id,created_at').eq('id',user.id).maybeSingle();
    if(profileError&&['42703','PGRST204'].includes(profileError.code))({data:ownProfile,error:profileError}=await supabase.from('profiles').select('id,full_name,username,email,role,employee_record_id,manager_profile_id,created_at').eq('id',user.id).maybeSingle());
    if(profileError) throw profileError;
    SESSION=ownProfile?{id:ownProfile.id,fullName:ownProfile.full_name,username:ownProfile.username,email:ownProfile.email,role:ownProfile.role,canExport:ownProfile.can_export===true,employeeRecordId:ownProfile.employee_record_id||'',managerProfileId:ownProfile.manager_profile_id||'',createdAt:ownProfile.created_at?.slice(0,10)||todayISO()}:{id:user.id,fullName:user.user_metadata?.full_name||user.email,username:user.user_metadata?.username||'',email:user.email,role:'Employee',canExport:false,employeeRecordId:'',managerProfileId:''};
    let state=await loadDB();
    // An empty database is a valid production state, including after an
    // administrator performs the user-preserving reset.
    DB=state;
    if(!DB.audit) DB.audit=[]; if(!DB.onboardingCandidates) DB.onboardingCandidates=[]; if(!DB.transfers) DB.transfers=[]; if(!DB.offenseCatalog) DB.offenseCatalog=defaultOffenseCatalog(); if(!DB.cvr) DB.cvr=[]; if(!DB.incidents) DB.incidents=[]; if(!DB.prf) DB.prf=[]; DB.prf.forEach(p=>{if(!p.status)p.status='Draft';}); if(!DB.evaluations) DB.evaluations=[]; if(!DB.atd) DB.atd=[]; if(!DB.workflowTasks) DB.workflowTasks=[]; if(!DB.automationRuns) DB.automationRuns=[]; if(!DB.documents) DB.documents=[]; if(!DB.lifecycleChecklists) DB.lifecycleChecklists=[]; if(!DB.serviceRequests) DB.serviceRequests=[]; DB.atd.forEach(a=>{if(!a.payments)a.payments=[];}); if(!DB.settings) DB.settings={orgName:'SCPA',probationDays:180}; DB.settings.branchLocations=uniqueSettingNames(DB.settings.branchLocations); if(!DB.settings.branchLocations.length)DB.settings.branchLocations=['Main Office']; DB.settings.allowanceTypes=uniqueSettingNames(DB.settings.allowanceTypes);
    const employeeMasterChanged=isHRRole()?normalizeEmployeeMasterData():false;
    DB_SNAPSHOT=JSON.parse(JSON.stringify(DB));
    if(employeeMasterChanged) await saveDB();
    await loadProfiles();
    const profile=DB.users.find(x=>x.id===user.id);
    if(profile) SESSION=profile;
    await loadUserPreferences();
    if(isHRRole()){
      ensureAutomationSettings();
      await workflowSyncTasks({silent:true});
    }
    enterApp();
  }catch(e){ authErr('Could not load the HR database: '+e.message); await supabase.auth.signOut(); }
}

async function doLogout(){
  if(NOTIFICATION_TIMER) clearInterval(NOTIFICATION_TIMER);
  NOTIFICATION_TIMER=null;
  if(AUTOMATION_TIMER) clearInterval(AUTOMATION_TIMER);
  AUTOMATION_TIMER=null;
  NOTIFICATION_ITEMS=[];
  closeNotificationPanel();
  await supabase.auth.signOut();
  SESSION=null;
  document.getElementById('app').classList.remove('on');
  document.getElementById('auth-screen').style.display='';
  document.getElementById('li-user').value=''; document.getElementById('li-pass').value='';
}
let NOTIFICATION_TIMER=null;
let NOTIFICATION_ITEMS=[];
const NOTIFICATION_READ_KEY='scpa_hr_notification_read_v1';

function notificationStorageKey(){ return `${NOTIFICATION_READ_KEY}:${SESSION?.id||'guest'}`; }
function notificationReadIds(){
  try{
    const raw=localStorage.getItem(notificationStorageKey());
    const parsed=raw?JSON.parse(raw):[];
    return new Set(Array.isArray(parsed)?parsed.map(String):[]);
  }catch(e){ return new Set(); }
}
function saveNotificationReadIds(ids){
  try{
    const list=[...ids].slice(-300);
    localStorage.setItem(notificationStorageKey(),JSON.stringify(list));
  }catch(e){}
}
function markNotificationRead(id){
  if(!id) return;
  const ids=notificationReadIds(); ids.add(String(id)); saveNotificationReadIds(ids);
}
function markAllNotificationsRead(ev){
  ev?.stopPropagation();
  const ids=notificationReadIds(); NOTIFICATION_ITEMS.forEach(x=>ids.add(String(x.id))); saveNotificationReadIds(ids);
  renderNotificationPanel();
  updateNotificationBadgeFromItems();
}
function closeNotificationPanel(){
  const panel=document.getElementById('notification-popover');
  const btn=document.getElementById('notification-button');
  if(panel) panel.classList.remove('on');
  if(panel) panel.setAttribute('aria-hidden','true');
  if(btn) btn.setAttribute('aria-expanded','false');
}
async function toggleNotificationPanel(ev){
  ev?.stopPropagation();
  const panel=document.getElementById('notification-popover');
  const btn=document.getElementById('notification-button');
  if(!panel) return;
  const opening=!panel.classList.contains('on');
  if(!opening){ closeNotificationPanel(); return; }
  panel.classList.add('on');
  panel.setAttribute('aria-hidden','false');
  if(btn) btn.setAttribute('aria-expanded','true');
  await renderNotificationPanel();
}
function goFromNotifications(view){ closeNotificationPanel(); go(view); }
function notificationLevelRank(level){ return level==='danger'?0:level==='warning'?1:2; }
function notificationItem(id,level,title,meta,view,recordId=''){ return {id:String(id),level,title,meta,view,recordId}; }
async function buildNotificationItems(){
  const today=todayISO();
  const next3=addDaysISO(today,3);
  const next7=addDaysISO(today,7);
  const next14=addDaysISO(today,14);
  const items=[];

  let cases=[];
  try{
    const {data,error}=await supabase.from('hr_cases').select('id,case_number,employee_name,department,status,opened_at,closed_at,assigned_to,priority,due_date,updated_at').order('updated_at',{ascending:false}).limit(250);
    if(error) throw error;
    cases=data||[];
  }catch(e){ console.warn('Notification case query failed',e); }

  const openCases=cases.filter(c=>!['Closed','Cancelled','Resolved'].includes(c.status));
  openCases.forEach(c=>{
    const label=c.case_number||'HR Case';
    if(c.due_date && c.due_date<today) items.push(notificationItem(`case-overdue-${c.id}`,'danger',`${label} is overdue`,`${c.employee_name||'Employee'} · Due ${fmtDate(c.due_date)}${c.priority?' · '+c.priority:''}`,'cases',c.id));
    else if(c.due_date && c.due_date<=next3) items.push(notificationItem(`case-due-${c.id}`,'warning',`${label} is due soon`,`${c.employee_name||'Employee'} · Due ${fmtDate(c.due_date)}${c.priority?' · '+c.priority:''}`,'cases',c.id));
    if(c.status==='For Decision') items.push(notificationItem(`case-decision-${c.id}`,'warning',`${label} is ready for decision`,`${c.employee_name||'Employee'}${c.department?' · '+c.department:''}`,'cases',c.id));
    if(c.assigned_to && SESSION?.id && c.assigned_to===SESSION.id && !['Closed','Cancelled','Resolved'].includes(c.status)){
      items.push(notificationItem(`case-assigned-${c.id}`,'info',`${label} is assigned to you`,`${c.employee_name||'Employee'} · ${c.status||'Open'}${c.due_date?' · Due '+fmtDate(c.due_date):''}`,'cases',c.id));
    }
    if(!c.assigned_to) items.push(notificationItem(`case-unassigned-${c.id}`,'warning',`${label} has no assignee`,`${c.employee_name||'Employee'}${c.department?' · '+c.department:''}`,'cases',c.id));
  });

  DB.leaves.filter(l=>l.status==='Pending').slice(0,8).forEach(l=>items.push(notificationItem(`leave-pending-${l.id}`,'warning',`Leave request pending: ${l.employeeName||'Employee'}`,`${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}${l.department?' · '+l.department:''}`,'leaves')));
  DB.leaves.filter(l=>l.startDate>today && l.startDate<=next7 && l.status!=='Disapproved').slice(0,6).forEach(l=>items.push(notificationItem(`leave-upcoming-${l.id}`,'info',`Upcoming leave: ${l.employeeName||'Employee'}`,`Starts ${fmtDate(l.startDate)}${l.endDate?' · through '+fmtDate(l.endDate):''}`,'leaves')));

  DB.employees.filter(e=>classify(e)==='Probationary' && e.dateHired).forEach(e=>EVAL_MILESTONES.forEach(m=>{
    const st=evalStatusInfo(e,m);
    if(st.label==='Overdue') items.push(notificationItem(`eval-overdue-${e.id}-${m.key}`,'danger',`Overdue evaluation: ${employeeDisplayName(e)}`,`${m.label} · Due ${fmtDate(st.due)}`,'evaluations'));
    else if(st.label==='Due Soon' && st.due<=next14) items.push(notificationItem(`eval-due-${e.id}-${m.key}`,'warning',`Evaluation due soon: ${employeeDisplayName(e)}`,`${m.label} · Due ${fmtDate(st.due)}`,'evaluations'));
  }));

  DB.nte.filter(n=>n.status!=='Resolved').slice(0,8).forEach(n=>items.push(notificationItem(`nte-${n.id}`,'warning',`NTE needs follow-up: ${n.employeeName||'Employee'}`,`${n.status||'Open'}${n.dateReceived?' · Received '+fmtDate(n.dateReceived):''}`,'nte')));
  DB.incidents.filter(r=>['Reported','Under Investigation'].includes(r.status)).slice(0,8).forEach(r=>items.push(notificationItem(`incident-${r.id}`,'danger',`Incident requires review: ${r.employeeName||'Employee'}`,`${r.status} · ${r.incidentType||r.incidentTypes?.join(', ')||'Incident report'}`,'incidents')));
  DB.atd.filter(r=>atdRemaining(r)>0 && r.status==='Ongoing').slice(0,6).forEach(r=>items.push(notificationItem(`atd-${r.id}`,'info',`ATD balance outstanding: ${r.employeeName||'Employee'}`,`${peso(atdRemaining(r))} remaining${r.deductionType?' · '+r.deductionType:''}`,'atd')));

  const docToday=today;
  const docNext30=addDaysISO(docToday,30);
  (DB.documents||[]).filter(d=>d.expirationDate && d.status!=='Archived').forEach(d=>{
    const emp=DB.employees.find(e=>String(e.id)===String(d.employeeId));
    const owner=emp?.name||d.employeeName||'HR document';
    if(d.expirationDate<docToday) items.push(notificationItem(`doc-expired-${d.id}`,'danger',`Document expired: ${d.name||'Untitled document'}`,`${owner} · Expired ${fmtDate(d.expirationDate)}`,'documents'));
    else if(d.expirationDate<=docNext30) items.push(notificationItem(`doc-expiring-${d.id}`,'warning',`Document expiring soon: ${d.name||'Untitled document'}`,`${owner} · Expires ${fmtDate(d.expirationDate)}`,'documents'));
  });

  (DB.workflowTasks||[]).filter(t=>t.automationGenerated && t.status==='Pending' && workflowVisibleToSession(t)).slice(0,10).forEach(t=>{
    const level=t.priority==='Urgent'?'danger':t.priority==='High'?'warning':'info';
    items.push(notificationItem(`automation-task-${t.id}`,level,`Automation task: ${t.title}`,`${t.employeeName||'HR workflow'}${t.dueDate?' · '+workflowDueText(t):''}`,'workflow',t.id));
  });

  const seen=new Set();
  return items.filter(x=>{ if(seen.has(x.id)) return false; seen.add(x.id); return true; })
    .sort((a,b)=>notificationLevelRank(a.level)-notificationLevelRank(b.level) || (a.title||'').localeCompare(b.title||''))
    .slice(0,40);
}
function updateNotificationBadgeFromItems(){
  const badge=document.getElementById('notification-badge');
  if(!badge) return;
  const read=notificationReadIds();
  const unread=NOTIFICATION_ITEMS.filter(x=>!read.has(String(x.id))).length;
  badge.textContent=unread>99?'99+':String(unread);
  badge.classList.toggle('show',unread>0);
  const btn=document.getElementById('notification-button');
  if(btn) btn.setAttribute('aria-label',unread?`${unread} unread notifications`:'No unread notifications');
}
async function refreshNotificationBadge(){
  if(!SESSION) return;
  try{ NOTIFICATION_ITEMS=await buildNotificationItems(); updateNotificationBadgeFromItems(); }catch(e){ console.warn('Notification refresh failed',e); }
}
async function renderNotificationPanel(){
  const list=document.getElementById('notification-list');
  const summary=document.getElementById('notification-summary');
  if(!list||!summary) return;
  list.innerHTML='<div class="notification-empty">Loading current HR alerts…</div>';
  NOTIFICATION_ITEMS=await buildNotificationItems();
  const read=notificationReadIds();
  const unread=NOTIFICATION_ITEMS.filter(x=>!read.has(String(x.id))).length;
  summary.textContent=unread?`${unread} unread · ${NOTIFICATION_ITEMS.length} current alert${NOTIFICATION_ITEMS.length===1?'':'s'}`:`All caught up · ${NOTIFICATION_ITEMS.length} current alert${NOTIFICATION_ITEMS.length===1?'':'s'}`;
  updateNotificationBadgeFromItems();
  if(!NOTIFICATION_ITEMS.length){
    list.innerHTML='<div class="notification-empty"><b>No new alerts</b>Your current HR records do not show additional notification items.</div>';
    return;
  }
  list.innerHTML=NOTIFICATION_ITEMS.map(x=>{
    const isUnread=!read.has(String(x.id));
    return `<div class="notification-item ${x.level} ${isUnread?'unread':''}" onclick="openNotification('${esc(x.id)}','${esc(x.view)}','${esc(x.recordId||'')}')"><span class="n-dot"></span><div class="n-main"><div class="n-title">${esc(x.title)}</div><div class="n-meta">${esc(x.meta)}</div></div>${isUnread?'<span class="n-unread">New</span>':''}</div>`;
  }).join('');
}
async function openNotification(id,view,recordId){
  markNotificationRead(id);
  updateNotificationBadgeFromItems();
  closeNotificationPanel();
  if(recordId && view==='cases'){ await openCaseDetails(recordId); return; }
  if(recordId && view==='workflow'){ openWorkflowTask(recordId); return; }
  go(view);
}

function enterApp(initialView='dashboard'){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').classList.add('on');
  document.getElementById('tb-name').textContent = SESSION.fullName;
  document.getElementById('tb-role').textContent = SESSION.role;
  document.getElementById('tb-av').textContent = SESSION.fullName.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const bell=document.getElementById('notification-bell-icon');
  if(bell) bell.innerHTML=iBell(17);
  const notificationWrap=document.getElementById('notification-wrap');
  if(notificationWrap) notificationWrap.style.display=(isHRRole()||SESSION?.role==='Viewer')?'':'none';
  renderNav();
  const landing=initialView==='dashboard'&&!isHRRole()&&SESSION?.role!=='Viewer'?(SESSION?.role==='Manager'?'teamApprovals':'selfService'):initialView;
  go(landing,{skipUnsaved:true});
  if(isHRRole()||SESSION?.role==='Viewer') refreshNotificationBadge();
  if(NOTIFICATION_TIMER) clearInterval(NOTIFICATION_TIMER);
  NOTIFICATION_TIMER=(isHRRole()||SESSION?.role==='Viewer')?setInterval(()=>refreshNotificationBadge(),60000):null;
  if(AUTOMATION_TIMER) clearInterval(AUTOMATION_TIMER);
  if(isHRRole()){
    runAutomationEngine({silent:true});
    AUTOMATION_TIMER=setInterval(()=>runAutomationEngine({silent:true}),300000);
  } else AUTOMATION_TIMER=null;
}

/* ---------------- Employee self-service / manager approvals ---------------- */
const SERVICE_REQUEST_STATUS_MAP={Pending:'b-amber',Approved:'b-green',Returned:'b-red',Cancelled:'b-grey'};
function currentEmployeeRecord(){
  return DB.employees.find(employee=>String(employee.id)===String(SESSION?.employeeRecordId||''))||null;
}
function pendingServiceRequestCount(){
  const rows=DB.serviceRequests||[];
  if(SESSION?.role==='Manager') return rows.filter(request=>request.status==='Pending'&&request.manager_profile_id===SESSION.id).length;
  return canReviewServiceRequests()?rows.filter(request=>request.status==='Pending').length:0;
}
function serviceRequestTypeLabel(type){ return type==='leave'?'Leave Request':'Profile Update'; }
function serviceRequestOwner(request){
  return DB.users.find(user=>user.id===request.employee_profile_id)?.fullName||DB.employees.find(employee=>String(employee.id)===String(request.employee_record_id))?.name||'Employee';
}
function serviceRequestSummary(request){
  const payload=request.payload||{};
  if(request.request_type==='leave') return `${payload.leaveType||'Leave'} · ${fmtDate(payload.startDate)} – ${fmtDate(payload.endDate)}`;
  const labels={mobileNumber:'Mobile number',personalEmail:'Personal email',address:'Home address',homeAddress:'Home address',presentAddress:'Present address',civilStatus:'Civil status',emergencyContactName:'Emergency contact',emergencyContactRelationship:'Contact relationship',emergencyContactPhone:'Emergency phone'};
  const changed=Object.keys(payload).filter(key=>labels[key]).map(key=>labels[key]);
  return changed.length?changed.join(', '):'Personal information correction';
}
async function refreshServiceRequests(){
  await loadServiceRequests(DB);
  renderNav();
}
function selfServiceSetupNotice(){
  if(!SELF_SERVICE_READY) return `<div class="notice"><b>Self-service setup required.</b> Run <span class="mono">supabase/phase10-self-service.sql</span> in the Supabase SQL Editor, then reload this page.</div>`;
  if(!SESSION?.employeeRecordId) return `<div class="self-service-empty"><div class="self-service-empty-icon">${iUser(22)}</div><h2>Your account needs an employee link</h2><p>An Administrator must connect this login to your employee master record before personal information and requests can be displayed.</p></div>`;
  return '';
}
function renderSelfService(){
  setTitle('My HR Portal','Personal information, requests, and approval status.');
  const content=document.getElementById('content');
  const setup=selfServiceSetupNotice();
  if(setup){content.innerHTML=`<div class="self-service-shell">${setup}</div>`;return;}
  const employee=currentEmployeeRecord();
  if(!employee){content.innerHTML=`<div class="self-service-shell"><div class="self-service-empty"><div class="self-service-empty-icon">${iUser(22)}</div><h2>Employee record unavailable</h2><p>The linked employee record could not be loaded. Ask HR to verify the account link and record permissions.</p></div></div>`;return;}
  const q=String(STATE.selfServiceSearch||'').trim().toLowerCase();
  const status=STATE.selfServiceStatus||'';
  const all=(DB.serviceRequests||[]).filter(request=>request.employee_profile_id===SESSION.id);
  const requests=all.filter(request=>(!status||request.status===status)&&(!q||[serviceRequestTypeLabel(request.request_type),serviceRequestSummary(request),request.status,request.reviewer_remarks].some(value=>String(value||'').toLowerCase().includes(q))));
  const pending=all.filter(request=>request.status==='Pending').length;
  const approved=all.filter(request=>request.status==='Approved').length;
  const nextLeave=DB.leaves.filter(leave=>String(leave.employeeId||'')===String(employee.id)&&leave.status==='Approved'&&leave.endDate>=todayISO()).sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)))[0];
  const journeys=(DB.lifecycleChecklists||[]).filter(checklist=>String(checklist.employeeId||'')===String(employee.id)&&lifecycleChecklistComputedStatus(checklist)!=='Cancelled').sort((a,b)=>String(a.targetDate||'').localeCompare(String(b.targetDate||'')));
  content.innerHTML=`
    <div class="self-service-shell">
      <div class="portal-header"><div><div class="eyebrow">Employee Self-Service</div><h1>Hello, ${esc((employee.name||SESSION.fullName).split(' ')[0])}.</h1><p>Review your employment details and send requests directly into the HR approval queue.</p></div><div class="portal-header-actions"><button class="btn btn-ghost" onclick="openProfileChangeRequest()">${iEdit(15)} Request profile update</button><button class="btn btn-primary" onclick="openLeaveRequest()">${iCal(15)} Request leave</button></div></div>
      <div class="portal-kpis"><div><span>Open requests</span><b>${pending}</b><small>Awaiting review</small></div><div><span>Approved requests</span><b>${approved}</b><small>All-time approvals</small></div><div><span>Employment status</span><b class="portal-kpi-text">${esc(employee.status||'—')}</b><small>${esc(classify(employee))}</small></div><div><span>Next approved leave</span><b class="portal-kpi-text">${nextLeave?fmtDate(nextLeave.startDate):'None scheduled'}</b><small>${nextLeave?esc(nextLeave.leaveType):'No upcoming leave'}</small></div></div>
      <div class="portal-grid">
        <section class="panel portal-profile"><div class="portal-section-head"><div><h2>My employment profile</h2><p>Employment fields are maintained by HR. Personal corrections can be submitted for approval.</p></div><button class="btn btn-ghost btn-sm" onclick="openProfileChangeRequest()">Request correction</button></div>
          <div class="portal-identity"><div class="portal-avatar">${esc(employeeDisplayName(employee).split(/[\s,]+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('').toUpperCase()||'E')}</div><div><h3>${esc(employeeDisplayName(employee))}</h3><p>${esc(employee.employeeNo||'—')} · ${esc(employee.position||'—')}</p><div>${statusBadge(employee.status||'—',EMP_STATUS_MAP)} ${statusBadge(classify(employee),{'Regular':'b-green','Probationary':'b-amber'})}</div></div></div>
          <dl class="portal-details"><div><dt>Department</dt><dd>${esc(employee.department||'—')}</dd></div><div><dt>Date hired</dt><dd>${fmtDate(employee.dateHired)}</dd></div><div><dt>Mobile number</dt><dd>${esc(employee.mobileNumber||'Not provided')}</dd></div><div><dt>Personal email</dt><dd>${esc(employee.personalEmail||'Not provided')}</dd></div><div><dt>Home address</dt><dd>${esc(formatPhilippineAddress(employee.homeAddress)||employee.address||'Not provided')}</dd></div><div><dt>Present address</dt><dd>${esc(formatPhilippineAddress(employee.presentAddress)||employee.presentAddressText||'Not provided')}</dd></div><div><dt>Emergency contact</dt><dd>${esc(employee.emergencyContactName||'Not provided')}${employee.emergencyContactPhone?' · '+esc(employee.emergencyContactPhone):''}</dd></div></dl>
        </section>
        <section class="panel portal-guide"><div class="portal-section-head"><div><h2>Request center</h2><p>Choose the transaction that matches what you need.</p></div></div><button class="portal-action" onclick="openLeaveRequest()"><span>${iCal(18)}</span><div><b>File a leave request</b><small>Send dates, leave type, and reason for review.</small></div><strong>›</strong></button><button class="portal-action" onclick="openProfileChangeRequest()"><span>${iUser(18)}</span><div><b>Correct personal information</b><small>Update contact, address, or emergency details.</small></div><strong>›</strong></button><div class="portal-security-note">Employment status, position, department, and classification remain HR-controlled fields.</div></section>
      </div>
      ${journeys.length?`<section class="portal-journeys"><div class="portal-section-head"><div><h2>My lifecycle progress</h2><p>Current onboarding, movement, and employment milestones.</p></div></div><div class="portal-journey-list">${journeys.map(checklist=>{const next=(checklist.items||[]).filter(item=>!item.completed).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))[0];const state=lifecycleChecklistComputedStatus(checklist);return `<article class="portal-journey"><div><span>${esc(checklist.type)}</span>${statusBadge(state,LIFECYCLE_STATUS_MAP)}</div>${lifecycleProgressHTML(checklist)}<small>${next?`Next: ${esc(next.title)} · ${fmtDate(next.dueDate)}`:'All tasks completed'}</small></article>`;}).join('')}</div></section>`:''}
      <section class="portal-history"><div class="portal-section-head"><div><h2>My requests</h2><p>${requests.length} of ${all.length} request${all.length===1?'':'s'} shown.</p></div></div><div class="data-toolbar"><div class="searchbox">${iSearch(16)}<input data-search-key="selfServiceSearch" type="search" placeholder="Search requests…" value="${esc(STATE.selfServiceSearch)}" oninput="queueSearchRender(this,'selfServiceSearch',renderSelfService)"></div><select class="filter-select" onchange="STATE.selfServiceStatus=this.value;STATE.tablePages={};renderSelfService()"><option value="">All statuses</option>${Object.keys(SERVICE_REQUEST_STATUS_MAP).map(value=>`<option value="${value}" ${STATE.selfServiceStatus===value?'selected':''}>${value}</option>`).join('')}</select>${STATE.selfServiceSearch||STATE.selfServiceStatus?`<button class="btn btn-ghost btn-sm" onclick="STATE.selfServiceSearch='';STATE.selfServiceStatus='';renderSelfService()">Clear</button>`:''}</div>
        <div class="tablewrap"><table class="data-table"><thead><tr><th>Request</th><th>Details</th><th>Submitted</th><th>Status</th><th>Reviewer remarks</th><th class="actions-head">Actions</th></tr></thead><tbody>${requests.length?requests.map(request=>`<tr><td><b>${esc(serviceRequestTypeLabel(request.request_type))}</b></td><td>${esc(serviceRequestSummary(request))}</td><td>${fmtDate(String(request.submitted_at||'').slice(0,10))}</td><td>${statusBadge(request.status,SERVICE_REQUEST_STATUS_MAP)}</td><td>${esc(request.reviewer_remarks||'—')}</td><td><div class="rowactions">${request.status==='Pending'?`<button class="btn btn-ghost btn-sm" data-confirm-change="true" data-confirm-label="Cancel request" onclick="cancelSelfServiceRequest('${request.id}')">Cancel</button>`:'<span class="small">Complete</span>'}</div></td></tr>`).join(''):`<tr><td colspan="6"><div class="empty"><b>No matching requests</b>Your submitted requests and review results will appear here.</div></td></tr>`}</tbody></table></div>
      </section>
    </div>`;
  requestAnimationFrame(()=>enhanceDataTables());
}
function openProfileChangeRequest(){
  const employee=currentEmployeeRecord(); if(!employee){toast('Your account is not linked to an employee record.',true);return;}
  openEmployeeWorkspaceModal(`<div class="modal-head"><div><h3>Request Profile Update</h3><div class="small">Changes are applied only after manager or HR approval.</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="formgrid"><div class="field"><label>Mobile Number</label><input id="ss_mobile" value="${esc(employee.mobileNumber||'')}"></div><div class="field"><label>Personal Email</label><input id="ss_email" type="email" value="${esc(employee.personalEmail||'')}"></div><div class="field"><label>Civil Status</label><select id="ss_civil">${['','Single','Married','Widowed','Separated','Other'].map(value=>`<option value="${value}" ${employee.civilStatus===value?'selected':''}>${value||'Select status'}</option>`).join('')}</select></div><div class="field"><label>Emergency Contact Name</label><input id="ss_emergency_name" value="${esc(employee.emergencyContactName||'')}"></div><div class="field"><label>Emergency Contact Relationship</label><input id="ss_emergency_relation" value="${esc(employee.emergencyContactRelationship||'')}"></div><div class="field"><label>Emergency Contact Phone</label><input id="ss_emergency_phone" value="${esc(employee.emergencyContactPhone||'')}"></div></div><div class="employee-address-stack profile-address-stack">${addressComponentHTML({prefix:'ss_home',label:'Home Address',value:employee.homeAddress||employee.address,required:true})}${addressComponentHTML({prefix:'ss_present',label:'Present Address',value:employee.presentAddress||employee.presentAddressText||employee.address,required:true,showCopy:true,copyFromPrefix:'ss_home'})}</div><div class="field"><label>Note for reviewer</label><textarea id="ss_profile_note" rows="3" placeholder="Briefly explain the correction, if needed."></textarea></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveProfileChangeRequest()">Submit Request</button></div>`);
}
async function saveProfileChangeRequest(){
  if(!SELF_SERVICE_READY) return;
  const [homeResult,presentResult]=await Promise.all([readAddressComponent('ss_home',{required:true}),readAddressComponent('ss_present',{required:true})]);
  if(!homeResult.valid||!presentResult.valid){toast(homeResult.message||presentResult.message||'Complete both addresses using valid location suggestions.',true);return;}
  const payload={mobileNumber:document.getElementById('ss_mobile').value.trim(),personalEmail:document.getElementById('ss_email').value.trim(),address:formatPhilippineAddress(homeResult.address),homeAddress:homeResult.address,presentAddress:presentResult.address,presentAddressText:formatPhilippineAddress(presentResult.address),civilStatus:document.getElementById('ss_civil').value,emergencyContactName:document.getElementById('ss_emergency_name').value.trim(),emergencyContactRelationship:document.getElementById('ss_emergency_relation').value.trim(),emergencyContactPhone:document.getElementById('ss_emergency_phone').value.trim(),note:document.getElementById('ss_profile_note').value.trim()};
  const {error}=await supabase.rpc('submit_hr_service_request',{p_request_type:'profile_update',p_payload:payload});
  if(error){toast('Could not submit request: '+error.message,true);return;}
  await closeModal(); await refreshServiceRequests(); toast('Profile update request submitted.'); renderSelfService();
}
function openLeaveRequest(){
  const employee=currentEmployeeRecord(); if(!employee){toast('Your account is not linked to an employee record.',true);return;}
  openModal(`<div class="modal-head"><div><h3>Request Leave</h3><div class="small">${esc(employeeDisplayName(employee))} · ${esc(employee.department||'Unassigned')}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="formgrid"><div class="field full"><label>Type of Leave *</label><select id="ss_leave_type">${LEAVE_TYPES.map(value=>`<option>${esc(value)}</option>`).join('')}</select></div><div class="field"><label>Start Date *</label><input id="ss_leave_start" type="date" min="${todayISO()}"></div><div class="field"><label>End Date *</label><input id="ss_leave_end" type="date" min="${todayISO()}"></div><div class="field full"><label>Reason</label><textarea id="ss_leave_reason" rows="4" placeholder="Provide the reason or relevant context for your reviewer."></textarea></div><div class="field full"><label>Note for reviewer</label><textarea id="ss_leave_note" rows="2" placeholder="Optional handover or scheduling note."></textarea></div></div><div class="computed-note">Submitting creates a pending Leave Tracker record. The status changes only after manager or HR review.</div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveLeaveRequest()">Submit Leave Request</button></div>`);
}
async function saveLeaveRequest(){
  const leaveType=document.getElementById('ss_leave_type').value;
  const startDate=document.getElementById('ss_leave_start').value;
  const endDate=document.getElementById('ss_leave_end').value;
  if(!startDate||!endDate){toast('Select both leave dates.',true);return;}
  if(endDate<startDate){toast('Leave end date cannot be before the start date.',true);return;}
  const payload={leaveType,startDate,endDate,reason:document.getElementById('ss_leave_reason').value.trim(),note:document.getElementById('ss_leave_note').value.trim()};
  const {error}=await supabase.rpc('submit_hr_service_request',{p_request_type:'leave',p_payload:payload});
  if(error){toast('Could not submit leave request: '+error.message,true);return;}
  await closeModal(); await refreshServiceRequests(); toast('Leave request submitted.'); renderSelfService();
}
async function cancelSelfServiceRequest(id){
  const {error}=await supabase.rpc('cancel_hr_service_request',{p_request_id:id});
  if(error){toast('Could not cancel request: '+error.message,true);return;}
  await refreshServiceRequests(); toast('Request cancelled.'); renderSelfService();
}
function renderTeamApprovals(){
  setTitle('Requests & Approvals','Review employee self-service transactions.');
  const content=document.getElementById('content');
  if(!canReviewServiceRequests()){content.innerHTML='<div class="notice"><b>Access restricted.</b> This workspace is available to Managers and HR personnel.</div>';return;}
  if(!SELF_SERVICE_READY){content.innerHTML=`<div class="notice"><b>Self-service setup required.</b> Run <span class="mono">supabase/phase10-self-service.sql</span> in the Supabase SQL Editor, then reload this page.</div>`;return;}
  const q=String(STATE.serviceApprovalSearch||'').trim().toLowerCase();
  const status=STATE.serviceApprovalStatus;
  const all=DB.serviceRequests||[];
  const rows=all.filter(request=>(!status||request.status===status)&&(!q||[serviceRequestOwner(request),serviceRequestTypeLabel(request.request_type),serviceRequestSummary(request),request.status].some(value=>String(value||'').toLowerCase().includes(q))));
  const pending=all.filter(request=>request.status==='Pending').length;
  const approved=all.filter(request=>request.status==='Approved').length;
  const returned=all.filter(request=>request.status==='Returned').length;
  content.innerHTML=`<div class="self-service-shell"><div class="portal-header"><div><div class="eyebrow">Manager Workspace</div><h1>Requests &amp; Approvals</h1><p>Review profile corrections and leave submissions assigned to you or HR.</p></div></div><div class="approval-summary"><div><span>Pending</span><b>${pending}</b></div><div><span>Approved</span><b>${approved}</b></div><div><span>Returned</span><b>${returned}</b></div><div><span>Total requests</span><b>${all.length}</b></div></div><section class="portal-history"><div class="data-toolbar"><div class="searchbox">${iSearch(16)}<input data-search-key="serviceApprovalSearch" type="search" placeholder="Search employee or request…" value="${esc(STATE.serviceApprovalSearch)}" oninput="queueSearchRender(this,'serviceApprovalSearch',renderTeamApprovals)"></div><select class="filter-select" onchange="STATE.serviceApprovalStatus=this.value;STATE.tablePages={};renderTeamApprovals()"><option value="" ${STATE.serviceApprovalStatus===''?'selected':''}>All statuses</option>${Object.keys(SERVICE_REQUEST_STATUS_MAP).map(value=>`<option value="${value}" ${STATE.serviceApprovalStatus===value?'selected':''}>${value}</option>`).join('')}</select>${STATE.serviceApprovalSearch||STATE.serviceApprovalStatus!=='Pending'?`<button class="btn btn-ghost btn-sm" onclick="STATE.serviceApprovalSearch='';STATE.serviceApprovalStatus='Pending';renderTeamApprovals()">Reset</button>`:''}</div><div class="tablewrap"><table class="data-table"><thead><tr><th>Employee</th><th>Request</th><th>Details</th><th>Submitted</th><th>Status</th><th class="actions-head">Actions</th></tr></thead><tbody>${rows.length?rows.map(request=>`<tr><td><b>${esc(serviceRequestOwner(request))}</b></td><td>${esc(serviceRequestTypeLabel(request.request_type))}</td><td>${esc(serviceRequestSummary(request))}</td><td>${fmtDate(String(request.submitted_at||'').slice(0,10))}</td><td>${statusBadge(request.status,SERVICE_REQUEST_STATUS_MAP)}</td><td><div class="rowactions"><button class="btn btn-ghost btn-sm" onclick="openServiceRequestReview('${request.id}')">${request.status==='Pending'?'Review':'View'}</button></div></td></tr>`).join(''):`<tr><td colspan="6"><div class="empty"><b>No matching requests</b>Try another status or search term.</div></td></tr>`}</tbody></table></div></section></div>`;
  requestAnimationFrame(()=>enhanceDataTables());
}
function serviceRequestDetailHTML(request){
  const payload=request.payload||{};
  if(request.request_type==='leave') return `<dl class="request-review-grid"><div><dt>Leave type</dt><dd>${esc(payload.leaveType||'—')}</dd></div><div><dt>Dates</dt><dd>${fmtDate(payload.startDate)} – ${fmtDate(payload.endDate)}</dd></div><div class="full"><dt>Reason</dt><dd>${esc(payload.reason||'Not provided')}</dd></div><div class="full"><dt>Employee note</dt><dd>${esc(payload.note||request.employee_note||'Not provided')}</dd></div></dl>`;
  const fields=[['Mobile number','mobileNumber'],['Personal email','personalEmail'],['Home address','address'],['Civil status','civilStatus'],['Emergency contact','emergencyContactName'],['Relationship','emergencyContactRelationship'],['Emergency phone','emergencyContactPhone']];
  return `<dl class="request-review-grid">${fields.map(([label,key])=>`<div class="${key==='address'?'full':''}"><dt>${label}</dt><dd>${esc(payload[key]||'Not provided')}</dd></div>`).join('')}<div class="full"><dt>Employee note</dt><dd>${esc(payload.note||request.employee_note||'Not provided')}</dd></div></dl>`;
}
function openServiceRequestReview(id){
  const request=(DB.serviceRequests||[]).find(row=>row.id===id); if(!request)return;
  const pending=request.status==='Pending';
  openModal(`<div class="modal-head"><div><h3>${esc(serviceRequestTypeLabel(request.request_type))}</h3><div class="small">${esc(serviceRequestOwner(request))} · Submitted ${fmtDate(String(request.submitted_at||'').slice(0,10))}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="request-review-status">${statusBadge(request.status,SERVICE_REQUEST_STATUS_MAP)}<span>${esc(serviceRequestSummary(request))}</span></div>${serviceRequestDetailHTML(request)}${pending?`<div class="field" style="margin-top:16px;"><label>Reviewer remarks ${request.request_type==='profile_update'?'':'(recommended)'}</label><textarea id="sr_review_remarks" rows="4" placeholder="Add context for the employee or HR record."></textarea></div>`:`<div class="computed-note"><b>Reviewer remarks:</b> ${esc(request.reviewer_remarks||'No remarks recorded.')}</div>`}</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Close</button>${pending?`<button class="btn btn-danger" data-confirm-change="true" data-confirm-label="Return request" onclick="reviewServiceRequest('${request.id}','Returned')">Return</button><button class="btn btn-primary" data-confirm-change="true" data-confirm-label="Approve request" onclick="reviewServiceRequest('${request.id}','Approved')">Approve</button>`:''}</div>`);
}
async function reviewServiceRequest(id,decision){
  const remarks=document.getElementById('sr_review_remarks')?.value.trim()||'';
  if(decision==='Returned'&&!remarks){toast('Add reviewer remarks before returning the request.',true);return;}
  const {error}=await supabase.rpc('review_hr_service_request',{p_request_id:id,p_decision:decision,p_remarks:remarks||null});
  if(error){toast('Could not review request: '+error.message,true);return;}
  await closeModal(); await refreshServiceRequests(); toast(`Request ${decision.toLowerCase()}.`); renderTeamApprovals();
}

/* ---------------- Phase 11: Lifecycle Checklists ---------------- */
const LIFECYCLE_TYPES=['Onboarding','Regularization','Transfer','Separation'];
const LIFECYCLE_STATUS_MAP={Active:'b-blue',Overdue:'b-red',Completed:'b-green',Cancelled:'b-grey'};
const LIFECYCLE_TEMPLATES={
  Onboarding:[['documents','Verify employment documents','HR',-5],['file','Create personnel file','HR',-3],['payroll','Complete payroll enrollment','Payroll',-2],['access','Provision system and workplace access','IT / Facilities',-1],['orientation','Complete first-day orientation','HR',0],['expectations','Confirm role expectations and handover','Hiring Manager',1],['acknowledgement','Employee acknowledgement','Employee',2]],
  Regularization:[['evaluations','Consolidate probation evaluations','HR',-14],['recommendation','Submit manager recommendation','Hiring Manager',-10],['decision','Record regularization decision','HR',-5],['records','Update employment status and documents','HR',0],['acknowledgement','Employee acknowledgement','Employee',1]],
  Transfer:[['approval','Verify approved transfer documents','HR',-7],['plan','Confirm receiving-team plan','Hiring Manager',-5],['access','Update access and workplace assignment','IT / Facilities',-2],['payroll','Update payroll and cost center','Payroll',-2],['handover','Complete role handover','Hiring Manager',-1],['records','Update employee master record','HR',0],['acknowledgement','Employee acknowledgement','Employee',1]],
  Separation:[['notice','Verify notice or decision documents','HR',-14],['interview','Complete exit interview','HR',-7],['clearance','Complete assets and account clearance','IT / Facilities',-3],['handover','Complete supervisor handover','Hiring Manager',-3],['payroll','Complete payroll clearance','Payroll',-2],['documents','Issue final documents and clearance','HR',-1],['acknowledgement','Employee acknowledgement','Employee',0]],
};
function lifecycleChecklistEmployee(checklist){ return DB.employees.find(employee=>String(employee.id)===String(checklist?.employeeId||'')); }
function lifecycleChecklistManager(checklist){ return DB.users.find(user=>String(user.id)===String(checklist?.managerProfileId||'')); }
function lifecycleChecklistProgress(checklist){
  const items=checklist?.items||[];
  const complete=items.filter(item=>item.completed).length;
  return {complete,total:items.length,pct:items.length?Math.round(complete/items.length*100):0};
}
function lifecycleChecklistComputedStatus(checklist){
  if(checklist?.status==='Cancelled') return 'Cancelled';
  const progress=lifecycleChecklistProgress(checklist);
  if(progress.total&&progress.complete===progress.total) return 'Completed';
  return (checklist?.items||[]).some(item=>!item.completed&&item.dueDate&&item.dueDate<todayISO())?'Overdue':'Active';
}
function lifecycleChecklistCanManage(checklist,item=null){
  if(isHRRole()) return true;
  if(SESSION?.role!=='Manager') return false;
  return String(checklist?.managerProfileId||'')===String(SESSION.id)||String(item?.assigneeProfileId||'')===String(SESSION.id);
}
function lifecycleChecklistPendingCount(){
  return (DB.lifecycleChecklists||[]).filter(checklist=>lifecycleChecklistComputedStatus(checklist)!=='Cancelled').reduce((count,checklist)=>count+(checklist.items||[]).filter(item=>!item.completed&&lifecycleChecklistCanManage(checklist,item)).length,0);
}
function lifecycleTemplateItems(type,targetDate,employeeId='',managerProfileId='',previous=[]){
  const employeeProfile=DB.users.find(user=>String(user.employeeRecordId||'')===String(employeeId));
  const prior=new Map((previous||[]).map(item=>[item.key,item]));
  return (LIFECYCLE_TEMPLATES[type]||[]).map(([key,title,owner,offset])=>{
    const old=prior.get(key)||{};
    const assigneeProfileId=owner==='Hiring Manager'?managerProfileId:owner==='Employee'?(employeeProfile?.id||''):(old.assigneeProfileId||'');
    return {id:old.id||uid(),key,title,owner,offset,dueDate:addDaysISO(targetDate,offset),assigneeProfileId,completed:!!old.completed,completedAt:old.completedAt||'',completedBy:old.completedBy||'',note:old.note||''};
  });
}
function lifecycleChecklistHistory(checklist,action,detail=''){
  if(!checklist.history) checklist.history=[];
  checklist.history.unshift({id:uid(),action,detail,at:new Date().toISOString(),by:SESSION?.fullName||'System',byId:SESSION?.id||''});
}
async function reloadLifecycleChecklists(){
  const {data,error}=await supabase.from('hr_records').select('data').eq('module','lifecycleChecklists').order('updated_at',{ascending:true});
  if(error) throw error;
  DB.lifecycleChecklists=(data||[]).map(row=>row.data);
  if(DB_SNAPSHOT) DB_SNAPSHOT.lifecycleChecklists=JSON.parse(JSON.stringify(DB.lifecycleChecklists));
}
function lifecycleProgressHTML(checklist){
  const progress=lifecycleChecklistProgress(checklist);
  return `<div class="checklist-progress"><div><span style="width:${progress.pct}%"></span></div><small>${progress.complete}/${progress.total} complete · ${progress.pct}%</small></div>`;
}
function renderLifecycleChecklists(){
  setTitle('Lifecycle Checklists','Onboarding, movement, regularization, and separation tasks.');
  const content=document.getElementById('content');
  if(!isHRRole()&&SESSION?.role!=='Manager'){content.innerHTML='<div class="notice"><b>Access restricted.</b> This workspace is available to managers and HR personnel.</div>';return;}
  const q=String(STATE.checklistSearch||'').trim().toLowerCase();
  const type=STATE.checklistType||'';
  const status=STATE.checklistStatus||'';
  const all=(DB.lifecycleChecklists||[]).map(checklist=>({...checklist,computedStatus:lifecycleChecklistComputedStatus(checklist)}));
  const rows=all.filter(checklist=>{
    const employee=lifecycleChecklistEmployee(checklist);
    const manager=lifecycleChecklistManager(checklist);
    return (!type||checklist.type===type)&&(!status||checklist.computedStatus===status)&&(!q||[employee?.name,employee?.employeeNo,employee?.department,checklist.type,manager?.fullName,checklist.notes].some(value=>String(value||'').toLowerCase().includes(q)));
  }).sort((a,b)=>String(a.targetDate||'').localeCompare(String(b.targetDate||'')));
  const active=all.filter(item=>['Active','Overdue'].includes(item.computedStatus)).length;
  const overdue=all.reduce((count,item)=>count+(item.items||[]).filter(task=>!task.completed&&task.dueDate&&task.dueDate<todayISO()).length,0);
  const dueSoon=all.reduce((count,item)=>count+(item.items||[]).filter(task=>!task.completed&&task.dueDate>=todayISO()&&task.dueDate<=addDaysISO(todayISO(),7)).length,0);
  const completed=all.filter(item=>item.computedStatus==='Completed').length;
  content.innerHTML=`<div class="checklist-shell">
    <div class="checklist-summary"><div><span>Active journeys</span><b>${active}</b></div><div><span>Overdue tasks</span><b>${overdue}</b></div><div><span>Due in 7 days</span><b>${dueSoon}</b></div><div><span>Completed</span><b>${completed}</b></div></div>
    <div class="data-toolbar checklist-toolbar"><div class="searchbox">${iSearch(16)}<input data-search-key="checklistSearch" type="search" placeholder="Search employee, department, or manager…" value="${esc(STATE.checklistSearch)}" oninput="queueSearchRender(this,'checklistSearch',renderLifecycleChecklists)"></div><select class="filter-select" onchange="STATE.checklistType=this.value;STATE.tablePages={};renderLifecycleChecklists()"><option value="">All journeys</option>${LIFECYCLE_TYPES.map(value=>`<option value="${value}" ${type===value?'selected':''}>${value}</option>`).join('')}</select><select class="filter-select" onchange="STATE.checklistStatus=this.value;STATE.tablePages={};renderLifecycleChecklists()"><option value="">All statuses</option>${Object.keys(LIFECYCLE_STATUS_MAP).map(value=>`<option value="${value}" ${status===value?'selected':''}>${value}</option>`).join('')}</select>${q||type||status!=='Active'?`<button class="btn btn-ghost btn-sm" onclick="STATE.checklistSearch='';STATE.checklistType='';STATE.checklistStatus='Active';renderLifecycleChecklists()">Reset</button>`:''}<span class="toolbar-spacer"></span>${isHRRole()?`<button class="btn btn-primary" onclick="openLifecycleChecklistForm()">+ New Checklist</button>`:''}</div>
    <div class="tablewrap"><table class="data-table"><thead><tr><th>Employee</th><th>Journey</th><th>Progress</th><th>Target Date</th><th>Next Task</th><th>Manager</th><th>Status</th><th class="actions-head">Action</th></tr></thead><tbody>${rows.length?rows.map(checklist=>{const employee=lifecycleChecklistEmployee(checklist);const manager=lifecycleChecklistManager(checklist);const next=(checklist.items||[]).filter(item=>!item.completed).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))[0];return `<tr><td><b>${esc(employee?.name||'Unknown employee')}</b><div class="small">${esc(employee?.employeeNo||employee?.department||'—')}</div></td><td>${esc(checklist.type)}</td><td>${lifecycleProgressHTML(checklist)}</td><td>${fmtDate(checklist.targetDate)}</td><td>${next?`<b>${esc(next.title)}</b><div class="small ${next.dueDate<todayISO()?'text-danger':''}">${esc(next.owner)} · ${fmtDate(next.dueDate)}</div>`:'<span class="small">All tasks complete</span>'}</td><td>${esc(manager?.fullName||'Unassigned')}</td><td>${statusBadge(checklist.computedStatus,LIFECYCLE_STATUS_MAP)}</td><td><div class="rowactions"><button class="btn btn-ghost btn-sm" onclick="openLifecycleChecklist('${checklist.id}')">Manage</button></div></td></tr>`;}).join(''):`<tr><td colspan="8"><div class="empty"><b>No matching lifecycle checklists</b><span>Create a journey or adjust the current filters.</span></div></td></tr>`}</tbody></table></div>
  </div>`;
  requestAnimationFrame(()=>enhanceDataTables());
}
function lifecycleTemplatePreview(type,targetDate){
  if(!type||!targetDate) return '<div class="computed-note">Choose a journey and target date to preview its tasks.</div>';
  return `<div class="checklist-template-preview">${lifecycleTemplateItems(type,targetDate).map(item=>`<div><span>${esc(item.title)}</span><small>${esc(item.owner)} · ${fmtDate(item.dueDate)}</small></div>`).join('')}</div>`;
}
function lifecycleTemplateChanged(){ const el=document.getElementById('lc_template_preview');if(el)el.innerHTML=lifecycleTemplatePreview(document.getElementById('lc_type')?.value,document.getElementById('lc_target')?.value); }
function openLifecycleChecklistForm(id=''){
  if(!isHRRole()) return;
  const checklist=(DB.lifecycleChecklists||[]).find(item=>String(item.id)===String(id));
  const existing=checklist||{type:'Onboarding',targetDate:addDaysISO(todayISO(),7),employeeId:'',managerProfileId:'',notes:''};
  const managers=DB.users.filter(user=>['Manager','Administrator','HR Staff'].includes(user.role));
  openModal(`<div class="modal-head"><div><h3>${checklist?'Edit':'New'} Lifecycle Checklist</h3><div class="small">Apply a standard journey and assign its accountable manager.</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="formgrid">${employeePickerHTML({id:'lc_employee',label:'Employee',selectedId:existing.employeeId,required:true,full:true})}<div class="field"><label>Journey *</label><select id="lc_type" onchange="lifecycleTemplateChanged()">${LIFECYCLE_TYPES.map(value=>`<option value="${value}" ${existing.type===value?'selected':''}>${value}</option>`).join('')}</select></div><div class="field"><label>Target Date *</label><input id="lc_target" type="date" value="${esc(existing.targetDate)}" onchange="lifecycleTemplateChanged()"></div><div class="field full"><label>Accountable Manager</label><select id="lc_manager"><option value="">Unassigned</option>${managers.map(user=>`<option value="${user.id}" ${String(existing.managerProfileId||'')===String(user.id)?'selected':''}>${esc(user.fullName)} · ${esc(user.role)}</option>`).join('')}</select></div><div class="field full"><label>Internal Notes</label><textarea id="lc_notes" rows="3" placeholder="Context, handover details, or special instructions…">${esc(existing.notes||'')}</textarea></div></div><div id="lc_template_preview">${lifecycleTemplatePreview(existing.type,existing.targetDate)}</div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveLifecycleChecklist('${id}')">${checklist?'Save Changes':'Create Checklist'}</button></div>`);
}
async function saveLifecycleChecklist(id=''){
  if(!isHRRole()) return;
  const employeeId=document.getElementById('lc_employee')?.value||'';
  const type=document.getElementById('lc_type')?.value||'';
  const targetDate=document.getElementById('lc_target')?.value||'';
  const managerProfileId=document.getElementById('lc_manager')?.value||'';
  const notes=document.getElementById('lc_notes')?.value.trim()||'';
  if(!employeeId||!type||!targetDate){toast('Select an employee, journey, and target date.',true);return;}
  let checklist=(DB.lifecycleChecklists||[]).find(item=>String(item.id)===String(id));
  const isNew=!checklist;
  const original=checklist?JSON.parse(JSON.stringify(checklist)):null;
  if(!checklist){checklist={id:uid(),createdAt:new Date().toISOString(),createdBy:SESSION?.id||'',history:[]};DB.lifecycleChecklists.push(checklist);}
  const previous=checklist.type===type?(checklist.items||[]):[];
  Object.assign(checklist,{employeeId,type,targetDate,managerProfileId,notes,updatedAt:new Date().toISOString(),updatedBy:SESSION?.id||''});
  checklist.items=lifecycleTemplateItems(type,targetDate,employeeId,managerProfileId,previous);
  checklist.status=lifecycleChecklistComputedStatus(checklist);
  lifecycleChecklistHistory(checklist,isNew?'Checklist created':'Checklist updated',`${type} · target ${fmtDate(targetDate)}`);
  if(!(await saveDB())){if(isNew)DB.lifecycleChecklists=DB.lifecycleChecklists.filter(item=>item!==checklist);else Object.assign(checklist,original);return;}logAudit(`${isNew?'Created':'Updated'} ${type} checklist for ${lifecycleChecklistEmployee(checklist)?.name||'employee'}`);await workflowSyncTasks({silent:true});closeModal();renderLifecycleChecklists();toast(`Checklist ${isNew?'created':'updated'}.`);
}
function lifecycleTaskState(item){ return item.completed?'Completed':item.dueDate&&item.dueDate<todayISO()?'Overdue':item.dueDate&&item.dueDate<=addDaysISO(todayISO(),7)?'Due Soon':'Upcoming'; }
function openLifecycleChecklist(id){
  const checklist=(DB.lifecycleChecklists||[]).find(item=>String(item.id)===String(id));if(!checklist)return;
  const employee=lifecycleChecklistEmployee(checklist);const manager=lifecycleChecklistManager(checklist);const status=lifecycleChecklistComputedStatus(checklist);
  openModal(`<div class="modal-head"><div><h3>${esc(checklist.type)} · ${esc(employee?.name||'Employee')}</h3><div class="small">Target ${fmtDate(checklist.targetDate)} · ${esc(manager?.fullName||'No manager assigned')}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="checklist-detail-head">${lifecycleProgressHTML(checklist)}${statusBadge(status,LIFECYCLE_STATUS_MAP)}</div>${checklist.notes?`<div class="computed-note">${esc(checklist.notes)}</div>`:''}<div class="checklist-task-list">${(checklist.items||[]).map(item=>{const state=lifecycleTaskState(item);const manageable=lifecycleChecklistCanManage(checklist,item)&&status!=='Cancelled';return `<button type="button" class="checklist-task ${item.completed?'complete':''}" ${manageable?`onclick="openLifecycleChecklistItem('${checklist.id}','${item.id}')"`:'disabled'}><span class="checklist-task-check">${item.completed?'✓':''}</span><span><b>${esc(item.title)}</b><small>${esc(item.owner)} · ${fmtDate(item.dueDate)}${item.note?' · '+esc(item.note):''}</small></span>${statusBadge(state,{Completed:'b-green',Overdue:'b-red','Due Soon':'b-amber',Upcoming:'b-grey'})}</button>`;}).join('')}</div>${(checklist.history||[]).length?`<details class="checklist-history"><summary>Audit history (${checklist.history.length})</summary>${checklist.history.slice(0,12).map(entry=>`<div><b>${esc(entry.action)}</b><span>${esc(entry.by||'System')} · ${new Date(entry.at).toLocaleString()}</span>${entry.detail?`<small>${esc(entry.detail)}</small>`:''}</div>`).join('')}</details>`:''}</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Close</button>${isHRRole()&&status!=='Cancelled'?`<button class="btn btn-ghost" onclick="openLifecycleChecklistForm('${checklist.id}')">Edit Setup</button><button class="btn btn-danger" data-confirm-change="true" data-confirm-label="Cancel checklist" onclick="cancelLifecycleChecklist('${checklist.id}')">Cancel Checklist</button>`:''}</div>`);
}
function openLifecycleChecklistItem(checklistId,itemId){
  const checklist=(DB.lifecycleChecklists||[]).find(row=>String(row.id)===String(checklistId));const item=checklist?.items?.find(row=>String(row.id)===String(itemId));if(!checklist||!item||!lifecycleChecklistCanManage(checklist,item))return;
  openModal(`<div class="modal-head"><div><h3>${esc(item.title)}</h3><div class="small">${esc(item.owner)} · due ${fmtDate(item.dueDate)}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><label class="checklist-complete-toggle"><input id="lc_item_complete" type="checkbox" ${item.completed?'checked':''}><span><b>Task completed</b><small>Completion will be recorded in the checklist audit history.</small></span></label><div class="field"><label>Transaction Note</label><textarea id="lc_item_note" rows="4" placeholder="Add completion details or a follow-up note…">${esc(item.note||'')}</textarea></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="returnToLifecycleChecklist('${checklist.id}','${item.id}')">Back</button><button class="btn btn-primary" onclick="saveLifecycleChecklistItem('${checklist.id}','${item.id}')">Save Task</button></div>`);
}
async function returnToLifecycleChecklist(checklistId,itemId){
  if(!modalHasUnsavedChanges()){openLifecycleChecklist(checklistId);return;}
  const choice=await confirmDataChange({title:'Unsaved task changes',message:'Save your task changes before returning to the checklist?',confirmLabel:'Save changes',secondaryLabel:'Discard changes',cancelLabel:'Keep editing'});
  if(choice==='confirm'){await saveLifecycleChecklistItem(checklistId,itemId);return;}
  if(choice==='discard'){MODAL_EDIT_STATE=null;openLifecycleChecklist(checklistId);}
}
async function saveLifecycleChecklistItem(checklistId,itemId){
  const checklist=(DB.lifecycleChecklists||[]).find(row=>String(row.id)===String(checklistId));const item=checklist?.items?.find(row=>String(row.id)===String(itemId));if(!checklist||!item||!lifecycleChecklistCanManage(checklist,item))return;
  const completed=!!document.getElementById('lc_item_complete')?.checked;const note=document.getElementById('lc_item_note')?.value.trim()||'';
  if(isHRRole()){
    const original=JSON.parse(JSON.stringify(checklist));
    Object.assign(item,{completed,note,completedAt:completed?new Date().toISOString():'',completedBy:completed?(SESSION?.id||''):''});
    checklist.status=lifecycleChecklistComputedStatus(checklist);checklist.updatedAt=new Date().toISOString();lifecycleChecklistHistory(checklist,completed?'Task completed':'Task updated',item.title+(note?' · '+note:''));if(!(await saveDB())){Object.keys(checklist).forEach(key=>delete checklist[key]);Object.assign(checklist,original);return;}
  }else{
    const {error}=await supabase.rpc('update_lifecycle_checklist_item',{p_checklist_id:checklistId,p_item_id:itemId,p_completed:completed,p_note:note||null});
    if(error){toast('Could not update the task: '+error.message,true);return;}
    await reloadLifecycleChecklists();
  }
  if(isHRRole()){logAudit(`${completed?'Completed':'Updated'} lifecycle task: ${item.title}`);await workflowSyncTasks({silent:true});}renderNav();openLifecycleChecklist(checklistId);toast('Lifecycle task saved.');
}
async function cancelLifecycleChecklist(id){
  if(!isHRRole())return;const checklist=(DB.lifecycleChecklists||[]).find(item=>String(item.id)===String(id));if(!checklist)return;
  const original=JSON.parse(JSON.stringify(checklist));checklist.status='Cancelled';checklist.updatedAt=new Date().toISOString();lifecycleChecklistHistory(checklist,'Checklist cancelled');if(!(await saveDB())){Object.keys(checklist).forEach(key=>delete checklist[key]);Object.assign(checklist,original);return;}logAudit(`Cancelled ${checklist.type} checklist for ${lifecycleChecklistEmployee(checklist)?.name||'employee'}`);await workflowSyncTasks({silent:true});closeModal();renderLifecycleChecklists();toast('Checklist cancelled.');
}

/* ---------------- Phase 7: Action Center ---------------- */
function actionCenterItems(caseRows){
  const today=todayISO();
  const next7=addDaysISO(today,7);
  const next14=addDaysISO(today,14);
  const items=[];
  const activeCases=(caseRows||[]).filter(c=>!['Closed','Cancelled','Resolved'].includes(c.status));
  activeCases.forEach(c=>{
    const age=analyticsDaysOpen(c.opened_at,c.closed_at);
    if(age>=30) items.push({level:'danger',title:`${c.case_number} has been open ${age} days`,detail:`${c.employee_name} · ${c.status}${c.department?' · '+c.department:''}`,meta:['HR Case','30+ days'],view:'cases',id:c.id});
    if(c.status==='For Decision') items.push({level:'warning',title:`${c.case_number} is ready for decision`,detail:`${c.employee_name}${c.department?' · '+c.department:''}`,meta:['HR Case','For Decision'],view:'cases',id:c.id});
    if(!c.assigned_to) items.push({level:'warning',title:`${c.case_number} is unassigned`,detail:`${c.employee_name}${c.department?' · '+c.department:''}`,meta:['HR Case','Unassigned'],view:'cases',id:c.id});
  });

  const pendingLeaves=DB.leaves.filter(l=>l.status==='Pending').sort((a,b)=>(a.startDate||'').localeCompare(b.startDate||''));
  pendingLeaves.slice(0,8).forEach(l=>items.push({level:'warning',title:`Leave request pending: ${l.employeeName}`,detail:`${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}${l.department?' · '+l.department:''}`,meta:['Leave','Pending'],view:'leaves'}));

  (DB.lifecycleChecklists||[]).filter(checklist=>!['Cancelled','Completed'].includes(lifecycleChecklistComputedStatus(checklist))).forEach(checklist=>{
    const employee=lifecycleChecklistEmployee(checklist);
    (checklist.items||[]).filter(task=>!task.completed&&task.dueDate&&task.dueDate<=next7).forEach(task=>items.push({level:task.dueDate<today?'danger':'warning',title:`${checklist.type}: ${employee?.name||'Employee'}`,detail:`${task.title} · due ${fmtDate(task.dueDate)}`,meta:['Lifecycle',task.dueDate<today?'Overdue':'Due soon'],view:'lifecycleChecklists',id:checklist.id}));
  });

  const evalItems=[];
  DB.employees.filter(e=>classify(e)==='Probationary' && e.dateHired).forEach(e=>EVAL_MILESTONES.forEach(m=>{
    const st=evalStatusInfo(e,m);
    if(st.label==='Overdue') evalItems.push({level:'danger',title:`Overdue evaluation: ${employeeDisplayName(e)}`,detail:`${m.label||m.key||m} due ${fmtDate(st.due)}`,meta:['Evaluation','Overdue'],view:'evaluations'});
    else if(st.label==='Due Soon' && st.due<=next14) evalItems.push({level:'warning',title:`Evaluation due soon: ${employeeDisplayName(e)}`,detail:`${m.label||m.key||m} due ${fmtDate(st.due)}`,meta:['Evaluation','Due soon'],view:'evaluations'});
  }));
  items.push(...evalItems.slice(0,10));

  DB.nte.filter(n=>n.status!=='Resolved').slice(0,10).forEach(n=>items.push({level:'warning',title:`NTE needs follow-up: ${n.employeeName}`,detail:`${n.status||'Open'}${n.dateReceived?' · received '+fmtDate(n.dateReceived):''}`,meta:['NTE','Open'],view:'nte'}));

  DB.atd.filter(r=>atdRemaining(r)>0).slice(0,10).forEach(r=>items.push({level:'info',title:`ATD balance outstanding: ${r.employeeName}`,detail:`${peso(atdRemaining(r))} remaining${r.deductionType?' · '+r.deductionType:''}`,meta:['ATD','Balance'],view:'atd'}));

  DB.leaves.filter(l=>l.startDate>today && l.startDate<=next7 && l.status!=='Disapproved').slice(0,8).forEach(l=>items.push({level:'info',title:`Upcoming leave: ${l.employeeName}`,detail:`Starts ${fmtDate(l.startDate)}${l.endDate?' · through '+fmtDate(l.endDate):''}`,meta:['Leave','Next 7 days'],view:'leaves'}));

  const rank={danger:0,warning:1,info:2};
  return items.sort((a,b)=>(rank[a.level]||9)-(rank[b.level]||9) || (a.title||'').localeCompare(b.title||''));
}
function actionCenterCounts(items){
  return {total:items.length,danger:items.filter(x=>x.level==='danger').length,warning:items.filter(x=>x.level==='warning').length,info:items.filter(x=>x.level==='info').length};
}
function actionCenterSetLevel(level){
  STATE.actionLevel=level;
  paginationReset(STATE,'action-center:list');
  renderActionCenter();
}
function actionCenterResetFilters(){
  STATE.actionSearch='';
  STATE.actionLevel='all';
  paginationReset(STATE,'action-center:list');
  renderActionCenter();
}
function actionCenterPageGo(_scope,page){
  STATE.tablePages ||= {};
  const cur=STATE.tablePages['action-center:list']||{page:1,size:10,signature:''};
  STATE.tablePages['action-center:list']={...cur,page:Math.max(1,Number(page)||1)};
  renderActionCenter();
}
function actionCenterPageSize(_scope,size){
  STATE.tablePages ||= {};
  STATE.tablePageSizes ||= {};
  const nextSize=Number(size)||10;
  const cur=STATE.tablePages['action-center:list']||{page:1,size:nextSize,signature:''};
  STATE.tablePageSizes['action-center:list']=nextSize;
  STATE.tablePages['action-center:list']={...cur,page:1,size:nextSize,signature:''};
  renderActionCenter();
}
async function renderActionCenter(){
  setTitle('Action Center','A prioritized work queue for follow-ups, deadlines, and records needing attention.');
  document.getElementById('content').innerHTML='<div class="panel"><div class="desc">Loading action items…</div></div>';
  try{
    const {data:caseRows,error}=await supabase.from('hr_cases').select('id,case_number,employee_name,department,status,opened_at,closed_at,assigned_to').order('updated_at',{ascending:false}).limit(250);
    if(error) throw error;
    const items=actionCenterItems(caseRows||[]);
    const counts=actionCenterCounts(items);
    const q=String(STATE.actionSearch||'').trim().toLowerCase();
    const filtered=items.filter(item=>(STATE.actionLevel==='all'||item.level===STATE.actionLevel)&&(!q||[item.title,item.detail,...(item.meta||[])].some(value=>String(value||'').toLowerCase().includes(q))));
    const page=paginateRows(filtered,STATE,'action-center:list',10);
    const visible=page.rows;
    const html=`
      <div class="action-center-hero">
        <div><h1>Action Center</h1><p>One queue for urgent, upcoming, and informational HR follow-ups.</p></div>
        <div class="action-center-count"><span>Open items</span><b>${counts.total}</b></div>
      </div>
      <div class="action-grid">
        <div class="panel action-queue-panel">
          <div class="dashboard-panel-head"><div><h3>Priority Work Queue</h3><div class="desc">Select an item to open its related module.</div></div><span class="record-count">${filtered.length} item${filtered.length===1?'':'s'}</span></div>
          <div class="data-toolbar action-toolbar">
            <label class="searchbox">${iSearch(15)}<input data-search-key="actionSearch" type="search" autocomplete="off" placeholder="Search work queue…" value="${esc(STATE.actionSearch)}" oninput="queueSearchRender(this,'actionSearch',renderActionCenter)"></label>
            <select class="filter-select" aria-label="Filter queue by urgency" onchange="STATE.actionLevel=this.value; paginationReset(STATE,'action-center:list'); renderActionCenter()"><option value="all" ${STATE.actionLevel==='all'?'selected':''}>All urgency</option><option value="danger" ${STATE.actionLevel==='danger'?'selected':''}>Urgent</option><option value="warning" ${STATE.actionLevel==='warning'?'selected':''}>Attention</option><option value="info" ${STATE.actionLevel==='info'?'selected':''}>Information</option></select>
            ${(STATE.actionSearch||STATE.actionLevel!=='all')?`<button class="btn btn-ghost btn-sm" onclick="actionCenterResetFilters()">Reset</button>`:''}
          </div>
          <div class="action-list-scroll"><div class="action-list">
            ${visible.length?visible.map(x=>`<button type="button" class="action-item ${x.level}" onclick="go('${x.view}')"><span class="flag"></span><span class="body"><span class="title">${esc(x.title)}</span><span class="detail">${esc(x.detail)}</span><span class="meta">${(x.meta||[]).map(m=>`<span>${esc(m)}</span>`).join('')}</span></span><span class="action-arrow" aria-hidden="true">›</span></button>`).join(''):'<div class="action-empty"><b>No work items match this view.</b><div style="margin-top:5px;">Clear the search or choose another urgency.</div></div>'}
          </div></div>
          <div class="table-pagination-wrap"><div class="table-pagination-meta">${page.meta.start?`${page.meta.start}–${page.meta.end}`:'0'} <span>of ${page.meta.total} work items</span></div>${paginationHTML(page.meta,'action-center:list',{go:'actionCenterPageGo',size:'actionCenterPageSize'})}</div>
        </div>
        <div class="action-side">
          <div class="panel">
            <h3>Queue Summary</h3><div class="desc">Grouped by urgency.</div>
            <div class="action-summary">
              <button type="button" class="metric-card metric-card-link ${STATE.actionLevel==='danger'?'active':''}" onclick="actionCenterSetLevel('danger')"><span class="k">Urgent</span><span class="v">${counts.danger}</span><span class="s">Overdue / aged</span></button>
              <button type="button" class="metric-card metric-card-link ${STATE.actionLevel==='warning'?'active':''}" onclick="actionCenterSetLevel('warning')"><span class="k">Attention</span><span class="v">${counts.warning}</span><span class="s">Needs follow-up</span></button>
              <button type="button" class="metric-card metric-card-link ${STATE.actionLevel==='info'?'active':''}" onclick="actionCenterSetLevel('info')"><span class="k">Info</span><span class="v">${counts.info}</span><span class="s">Upcoming / balance</span></button>
              <button type="button" class="metric-card metric-card-link ${STATE.actionLevel==='all'?'active':''}" onclick="actionCenterSetLevel('all')"><span class="k">Total</span><span class="v">${counts.total}</span><span class="s">Current queue</span></button>
            </div>
          </div>
          <div class="panel">
            <h3>Quick Access</h3><div class="desc">Jump directly to high-use work areas.</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <button class="btn btn-ghost btn-sm" onclick="go('cases')">HR Cases</button>
              <button class="btn btn-ghost btn-sm" onclick="go('evaluations')">Evaluations</button>
              <button class="btn btn-ghost btn-sm" onclick="go('nte')">NTE</button>
              <button class="btn btn-ghost btn-sm" onclick="go('atd')">ATD</button>
              <button class="btn btn-ghost btn-sm" onclick="go('leaves')">Leaves</button>
            </div>
          </div>
          <div class="action-tip"><b>Review note:</b> Action Center items are generated from current HR records. They are reminders for workflow review, not automatic determinations about an employee or case.</div>
        </div>
      </div>`;
    document.getElementById('content').innerHTML=html;
  }catch(e){document.getElementById('content').innerHTML=`<div class="panel"><h3>Action Center</h3><div class="notice"><b>Could not load action items.</b> ${esc(e.message||e)}</div></div>`;}
}

/* ---------------- Phase 11: HR Operations Workspace ---------------- */
function opsInitials(name){ return String(name||'').split(/\s+/).map(x=>x[0]||'').slice(0,2).join('').toUpperCase(); }
function opsOpenItems(){
  const today=todayISO();
  const next7=addDaysISO(today,7);
  const items=[];
  const openCases=[];
  const casePromise=supabase.from('hr_cases').select('id,case_number,employee_name,department,status,priority,due_date,assigned_to,opened_at').order('updated_at',{ascending:false}).limit(250);
  return casePromise.then(({data,error})=>{
    if(error) throw error;
    (data||[]).forEach(c=>{
      if(['Closed','Cancelled','Resolved'].includes(c.status)) return;
      openCases.push(c);
      if(c.assigned_to===SESSION?.id || SESSION?.role==='Administrator'){
        const age=analyticsDaysOpen(c.opened_at,null);
        const due=c.due_date?caseDeadlineInfo(c.due_date,c.status):null;
        items.push({level:age>=30||due?.cls==='overdue'?'danger':'warning',view:'cases',id:c.id,title:`${c.case_number} · ${c.employee_name}`,meta:`${c.status} · ${c.priority||'Normal'}${c.due_date?' · '+(due?.label||''):''}`,right:'HR Case'});
      }
    });
    DB.leaves.filter(l=>l.status==='Pending').slice(0,8).forEach(l=>items.push({level:'warning',view:'leaves',title:`Pending leave · ${l.employeeName}`,meta:`${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}${l.department?' · '+l.department:''}`,right:'Leave'}));
    DB.atd.filter(r=>atdRemaining(r)>0).slice(0,8).forEach(r=>items.push({level:'info',view:'atd',title:`Outstanding ATD · ${r.employeeName}`,meta:`${peso(atdRemaining(r))} remaining${r.deductionType?' · '+r.deductionType:''}`,right:'ATD'}));
    DB.nte.filter(n=>n.status!=='Resolved').slice(0,8).forEach(n=>items.push({level:'warning',view:'nte',title:`NTE follow-up · ${n.employeeName}`,meta:`${n.status||'Open'}${n.dateReceived?' · received '+fmtDate(n.dateReceived):''}`,right:'NTE'}));
    DB.employees.filter(e=>classify(e)==='Probationary' && e.dateHired).forEach(e=>EVAL_MILESTONES.forEach(m=>{
      const st=evalStatusInfo(e,m);
      if(st.label==='Overdue') items.push({level:'danger',view:'evaluations',title:`Overdue evaluation · ${employeeDisplayName(e)}`,meta:`${m.label} due ${fmtDate(st.due)}`,right:'Evaluation'});
      else if(st.label==='Due Soon' && st.due<=next7) items.push({level:'warning',view:'evaluations',title:`Evaluation due · ${employeeDisplayName(e)}`,meta:`${m.label} due ${fmtDate(st.due)}`,right:'Evaluation'});
    }));
    const rank={danger:0,warning:1,info:2};
    return {openCases,items:items.sort((a,b)=>(rank[a.level]??9)-(rank[b.level]??9)).slice(0,18)};
  });
}
function opsPrefill(module,emp){
  if(!emp) return;
  const setVal=(id,val)=>{const el=document.getElementById(id); if(el&&val!=null){el.value=val; el.dispatchEvent(new Event('change',{bubbles:true}));}};
  employeePickerSet('f_employeeName',emp.id); setVal('f_department',emp.department||'');
  employeePickerSet('in_employeeName',emp.id); setVal('in_department',emp.department||'');
  employeePickerSet('cv_employeeName',emp.id); setVal('cv_department',emp.department||'');
  employeePickerSet('case_employee',emp.id);
}
function openEmployeeOperation(module,employeeId){
  if(SESSION?.role==='Viewer'){ toast('Viewer accounts have read-only access.',true); return; }
  const emp=DB.employees.find(e=>e.id===employeeId); if(!emp) return;
  closeModal();
  if(module==='profile'){ openEmployeeProfile(employeeId); return; }
  if(module==='status'){ openEmployeeStatusForm(employeeId); return; }
  if(module==='lifecycle'){ openEmployeeLifecycleEventForm(employeeId); return; }
  if(module==='transfer'){ openTransferForEmployee(employeeId); return; }
  if(module==='documents'){ closeModal(); STATE.view='documents'; STATE.search=emp.name||''; STATE.filter=''; STATE.tablePages={}; STATE.documentStorage=''; STATE.documentCategory=''; STATE.documentExpiry=''; STATE.documentStatus=''; renderNav(); renderDocuments(); return; }
  if(module==='atd'){ openATDForm(); setTimeout(()=>opsPrefill('atd',emp),0); return; }
  if(module==='evaluations'){
    const next=EVAL_MILESTONES.find(m=>{const st=evalStatusInfo(emp,m); return st.label!=='Completed';})||EVAL_MILESTONES[EVAL_MILESTONES.length-1];
    openEvalForm(employeeId,next.key); return;
  }
  if(module==='cases'){ openCaseForm(); setTimeout(()=>opsPrefill('cases',emp),0); return; }
  if(module==='incidents'){ openIncidentForm(); setTimeout(()=>opsPrefill('incidents',emp),0); return; }
  if(module==='cvr'){ openCVRForm(); setTimeout(()=>opsPrefill('cvr',emp),0); return; }
  openRecordForm(module); setTimeout(()=>opsPrefill(module,emp),0);
}
function opsHistoryOpenAction(item){
  if(!item) return;
  const id=item.id||'';
  switch(item.view){
    case 'cases': return id?openCaseDetails(id):go('cases');
    case 'incidents': return id?openIncidentForm(id):go('incidents');
    case 'cvr': return id?openCVRForm(id):go('cvr');
    case 'evaluations': return item.employeeId&&item.milestone ? openEvalForm(item.employeeId,item.milestone) : go('evaluations');
    case 'atd': return id?openATDForm(id):go('atd');
    case 'documents': {
      const d=(DB.documents||[]).find(x=>String(x.id)===String(id));
      if(d?.driveUrl) return openDriveDocument(d.driveUrl);
      if(d?.path) return openStoredDocument(d.path,d.name||'Document');
      return go('documents');
    }
    default: return id&&(DB[item.view]||[]).some(r=>String(r.id)===String(id))?openRecordForm(item.view,id):go(item.view||'dashboard');
  }
}
function opsRecordForEmployee(module,employee){
  if(!employee) return [];
  const id=String(employee.id||'');
  const name=normalizeEmployeeName(employee.name);
  return (DB[module]||[]).filter(r=>{
    const employeeRecordId=String(r.employeeRecordId||r.employee_record_id||r.employeeId||'');
    const recordName=normalizeEmployeeName(r.employeeName||'');
    return (employeeRecordId&&employeeRecordId===id)||(!employeeRecordId&&recordName===name)||recordName===name;
  });
}
async function renderOperationsWorkspace(){
  setTitle('HR Operations','A focused, employee-centric workbench for daily HR processing, approvals, follow-through, and record navigation.');
  const allEmployees=DB.employees.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const q=String(STATE.opsEmployeeSearch||'').trim().toLowerCase();
  const depts=[...new Set(allEmployees.map(e=>e.department).filter(Boolean))].sort();
  const statusOptions=[...new Set(allEmployees.map(e=>e.status).filter(Boolean))].sort();
  const classOptions=['Probationary','Regular'];
  const filteredEmployees=allEmployees.filter(e=>{
    const hay=[e.employeeNo,e.name,e.position,e.department,e.mobileNumber,e.personalEmail].map(v=>String(v||'').toLowerCase());
    return (!q||hay.some(v=>v.includes(q))) && (!STATE.opsEmployeeDept||e.department===STATE.opsEmployeeDept) && (!STATE.opsEmployeeStatus||e.status===STATE.opsEmployeeStatus) && (!STATE.opsEmployeeClass||classify(e)===STATE.opsEmployeeClass);
  });
  let selected=allEmployees.find(e=>String(e.id)===String(STATE.opsEmployeeId))||filteredEmployees[0]||allEmployees[0]||null;
  if(selected) STATE.opsEmployeeId=selected.id;

  const probationary=allEmployees.filter(e=>classify(e)==='Probationary').length;
  const pendingLeaves=DB.leaves.filter(l=>l.status==='Pending').length;
  const openNTE=DB.nte.filter(n=>n.status!=='Resolved').length;
  const overdueEvaluations=allEmployees.filter(e=>classify(e)==='Probationary'&&EVAL_MILESTONES.some(m=>evalStatusInfo(e,m).label==='Overdue')).length;
  const documentIndex=collectDocumentIndex();
  const expiringDocs=documentIndex.filter(d=>d.expirationDate && d.expirationDate<=addDaysISO(todayISO(),30) && d.status!=='Archived').length;
  const outstandingATD=DB.atd.reduce((s,r)=>s+Math.max(0,atdRemaining(r)),0);
  document.getElementById('content').innerHTML='<div class="ops-loading"><div class="spinner"></div><span>Preparing HR operations workspace…</span></div>';

  try{
    const {openCases,items}=await opsOpenItems();
    let selectedAllCases=[];
    if(selected){
      const byId=await supabase.from('hr_cases').select('id,case_number,employee_record_id,employee_name,department,status,priority,due_date,assigned_to,opened_at,updated_at,subject').eq('employee_record_id',String(selected.id)).order('opened_at',{ascending:false}).limit(200);
      if(!byId.error) selectedAllCases=byId.data||[];
      if(!selectedAllCases.length) selectedAllCases=openCases.filter(c=>normalizeEmployeeName(c.employee_name)===normalizeEmployeeName(selected.name));
    }

    const selectedName=selected?normalizeEmployeeName(selected.name):'';
    const selectedCasesOpen=selected?openCases.filter(c=>String(c.employee_record_id||'')===String(selected.id)||normalizeEmployeeName(c.employee_name)===selectedName):[];
    const selectedCasesAll=selected?selectedAllCases:[];
    const selectedLeaves=selected?opsRecordForEmployee('leaves',selected):[];
    const selectedAtd=selected?opsRecordForEmployee('atd',selected):[];
    const selectedNte=selected?opsRecordForEmployee('nte',selected):[];
    const selectedDisc=selected?opsRecordForEmployee('disciplinary',selected):[];
    const selectedEval=selected?opsRecordForEmployee('evaluations',selected):[];
    const selectedCvr=selected?opsRecordForEmployee('cvr',selected):[];
    const selectedIncidents=selected?opsRecordForEmployee('incidents',selected):[];
    const selectedMemos=selected?opsRecordForEmployee('memos',selected):[];
    const selectedNod=selected?opsRecordForEmployee('nod',selected):[];
    const selectedTransfers=selected?opsRecordForEmployee('transfers',selected):[];
    const selectedOncall=selected?opsRecordForEmployee('oncall',selected):[];
    const selectedPrf=selected?opsRecordForEmployee('prf',selected):[];
    const selectedDocs=selected?documentIndex.filter(d=>normalizeEmployeeName(d.employeeName||'')===selectedName || String(d.employeeId||'')===String(selected.id)):[];
    const atdBalance=selectedAtd.reduce((s,r)=>s+Math.max(0,atdRemaining(r)),0);
    const completion=selected?employeeCompleteness(selected):0;
    const nextMilestone=selected?lifecycleNextMilestone(selected):null;
    const currentClass=selected?classify(selected):'';

    const history=[];
    selectedCasesAll.forEach(c=>history.push({date:c.opened_at||c.updated_at||'',type:'Case',title:`${c.case_number||'HR Case'} · ${c.subject||'Employee case'}`,meta:`${c.status||'Open'} · ${c.priority||'Normal'}${c.due_date?' · Due '+fmtDate(c.due_date):''}`,view:'cases',id:c.id}));
    selectedLeaves.forEach(l=>history.push({date:l.startDate||l.dateApplied||'',type:'Leave',title:l.leaveType||'Leave record',meta:`${fmtDate(l.startDate)} – ${fmtDate(l.endDate)} · ${l.status||''}`,view:'leaves',id:l.id}));
    selectedNte.forEach(n=>history.push({date:n.dateIssued||n.dateReceived||'',type:'NTE',title:`NTE · ${n.violation||'Notice to Explain'}`,meta:`${n.status||'Open'}${n.dateReceived?' · Received '+fmtDate(n.dateReceived):''}`,view:'nte',id:n.id}));
    selectedDisc.forEach(d=>history.push({date:d.dateOfIncident||'',type:'Discipline',title:d.violation||'Disciplinary action',meta:`${d.action||'Action recorded'}`,view:'disciplinary',id:d.id}));
    selectedEval.forEach(e=>history.push({date:e.completedDate||e.evaluationDate||e.date||'',type:'Evaluation',title:`${e.milestone||e.type||'Evaluation'}`,meta:`${e.result||e.status||'Recorded'}`,view:'evaluations',id:e.id,employeeId:e.employeeId||selected.id,milestone:e.milestone||''}));
    selectedAtd.forEach(a=>history.push({date:a.atdDate||a.dateRecorded||a.date||'',type:'ATD',title:a.deductionType||'ATD record',meta:`${atdComputeStatus(a)} · ${peso(atdRemaining(a))} remaining`,view:'atd',id:a.id}));
    selectedCvr.forEach(c=>history.push({date:c.dateOfCVR||'',type:'CVR',title:`CVR · ${[...(c.offenses||[]),c.otherOffense].filter(Boolean).join(', ')||'Violation record'}`,meta:c.status||'Recorded',view:'cvr',id:c.id}));
    selectedIncidents.forEach(i=>history.push({date:i.dateOfIncident||'',type:'Incident',title:`Incident · ${[...(i.incidentTypes||[]),i.otherType].filter(Boolean).join(', ')||'Incident report'}`,meta:`${i.severity||''}${i.status?' · '+i.status:''}`,view:'incidents',id:i.id}));
    selectedMemos.forEach(m=>history.push({date:m.dateOfMemo||m.dateReceived||'',type:'Memo',title:`Memorandum · ${m.offenseType||'Offense'}`,meta:m.action||'Issued',view:'memos',id:m.id}));
    selectedNod.forEach(n=>history.push({date:n.dateOfNod||n.dateReceived||'',type:'NOD',title:`NOD · ${n.relatedOffense||'Decision'}`,meta:n.finalAction||'Decision recorded',view:'nod',id:n.id}));
    selectedTransfers.forEach(t=>history.push({date:t.toDate||t.fromDate||'',type:'Transfer',title:`Transfer · ${t.fromDepartment||'—'} → ${t.toDepartment||'—'}`,meta:t.remarks||'Department movement',view:'transfers',id:t.id}));
    selectedOncall.forEach(o=>history.push({date:o.startDate||'',type:'On-call',title:`On-call · ${o.reason||'Assignment'}`,meta:`${fmtDate(o.startDate)} – ${fmtDate(o.endDate)} · ${o.status||''}`,view:'oncall',id:o.id}));
    selectedPrf.forEach(p=>history.push({date:p.dateOfRequest||'',type:'PRF',title:`PRF · ${p.prfNumber||'Personnel Request'}`,meta:`${p.classification||''}${p.status?' · '+p.status:''}`,view:'prf',id:p.id}));
    selectedDocs.forEach(d=>history.push({date:d.documentDate||d.uploadedAt||d.expirationDate||'',type:'Document',title:d.name||d.fileName||'HR Document',meta:`${d.category||'Document'} · ${d.storage||'Stored'}`,view:'documents',id:d.id}));
    history.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));

    const historyTypes=[...new Set(history.map(x=>x.type))].sort((a,b)=>a.localeCompare(b));
    const historyQ=String(STATE.opsHistorySearch||'').trim().toLowerCase();
    const filteredHistory=history.filter(x=>{
      const typeOk=STATE.opsWorkFilter==='all'||x.type.toLowerCase()===String(STATE.opsWorkFilter||'').toLowerCase();
      const searchOk=!historyQ||[x.type,x.title,x.meta].some(v=>String(v||'').toLowerCase().includes(historyQ));
      return typeOk&&searchOk;
    });
    const actionCounts={cases:selectedCasesOpen.length,incidents:selectedIncidents.length,cvr:selectedCvr.length,nte:selectedNte.filter(x=>x.status!=='Resolved').length,memos:selectedMemos.length,nod:selectedNod.length,disciplinary:selectedDisc.length,leaves:selectedLeaves.filter(x=>x.status==='Pending').length,evaluations:selectedEval.length,status:1,lifecycle:Array.isArray(selected?.employmentHistory)?selected.employmentHistory.length:0,transfer:selectedTransfers.length,atd:selectedAtd.length,prf:selectedPrf.filter(x=>x.status==='Pending Approval').length,oncall:selectedOncall.length,documents:selectedDocs.length};
    const actionGroups=[
      {title:'Employee Relations',description:'Create and manage employee-relations records.',items:[['Case','cases'],['Incident','incidents'],['CVR','cvr'],['NTE','nte'],['Memo','memos'],['NOD','nod'],['Discipline','disciplinary']]},
      {title:'People & Workforce',description:'Manage employment, leave, attendance, movement, requests, and files.',items:[['Leave','leaves'],['Evaluation','evaluations'],['Status','status'],['Lifecycle','lifecycle'],['Transfer','transfer'],['ATD','atd'],['PRF','prf'],['On-call','oncall'],['Documents','documents']]}
    ];
    const iconFor=(key)=>key==='cases'?iShield(17):key==='leaves'?iCal(17):key==='evaluations'?iChart(17):key==='documents'?iDoc(17):key==='transfer'?iSwap(17):key==='status'?iShield(17):key==='atd'?iDoc(17):iDoc(17);
    const actionHtml=selected?actionGroups.map(group=>`<div class="ops-action-group"><div class="ops-action-group-head"><div><h4>${group.title}</h4><p>${group.description}</p></div></div><div class="ops-action-grid pro">${group.items.map(([label,key])=>`<button class="ops-action pro" onclick="openEmployeeOperation('${key}','${selected.id}')"><span class="ico">${iconFor(key)}</span><span class="action-copy"><span class="title">${label}</span><span class="meta">${key==='documents'?'Review files':key==='status'||key==='lifecycle'?'Update master record':'Create / review'}</span></span>${actionCounts[key]?`<span class="action-count">${actionCounts[key]}</span>`:''}</button>`).join('')}</div></div>`).join(''):'<div class="empty"><b>Select an employee</b><span>Choose an employee from the directory to unlock operations.</span></div>';
    const coverageItems=[['Cases','cases'],['Incidents','incidents'],['CVR','cvr'],['NTE','nte'],['Memo','memos'],['NOD','nod'],['Discipline','disciplinary'],['Leave','leaves'],['Evaluation','evaluations'],['Status','status'],['Lifecycle','lifecycle'],['Transfer','transfer'],['ATD','atd'],['PRF','prf'],['On-call','oncall'],['Documents','documents']];

    const dirRows=filteredEmployees.map(e=>{
      const empCases=openCases.filter(c=>String(c.employee_record_id||'')===String(e.id)||normalizeEmployeeName(c.employee_name)===normalizeEmployeeName(e.name)).length;
      const leaveCount=DB.leaves.filter(l=>normalizeEmployeeName(l.employeeName)===normalizeEmployeeName(e.name)&&l.status==='Pending').length;
      const issueCount=opsRecordForEmployee('nte',e).filter(n=>n.status!=='Resolved').length + opsRecordForEmployee('incidents',e).filter(i=>!['Resolved','Closed'].includes(i.status)).length;
      return `<tr class="ops-directory-row ${String(e.id)===String(selected?.id)?'selected':''}" onclick="STATE.opsEmployeeId='${e.id}';STATE.opsHistorySearch='';STATE.tablePages={};renderOperationsWorkspace()"><td><div class="cell-identity"><span class="avatar-sm">${esc(opsInitials(employeeDisplayName(e)))}</span><div><b>${esc(employeeDisplayName(e))}</b><div class="muted">${esc(e.employeeNo||'—')}</div></div></div></td><td>${esc(e.position||'—')}</td><td>${esc(e.department||'—')}</td><td>${statusBadge(e.status,EMP_STATUS_MAP)}</td><td>${statusBadge(classify(e),classify(e)==='Regular'?{'Regular':'b-green'}:{'Probationary':'b-amber'})}</td><td>${empCases||leaveCount||issueCount?`<span class="count-chip">${empCases+leaveCount+issueCount} attention</span>`:'<span class="muted">Clear</span>'}</td><td><button class="iconbtn" title="Open workspace" onclick="event.stopPropagation();STATE.opsEmployeeId='${e.id}';renderOperationsWorkspace()">›</button></td></tr>`;
    }).join('');
    const workRows=filteredHistory.slice(0,200).map(x=>{
      const safeView=String(x.view||'').replace(/'/g,"\\'");
      const safeId=String(x.id||'').replace(/'/g,"\\'");
      const safeEmp=String(x.employeeId||'').replace(/'/g,"\\'");
      const safeMilestone=String(x.milestone||'').replace(/'/g,"\\'");
      return `<tr><td class="mono">${fmtDate(x.date)}</td><td><span class="type-pill">${esc(x.type)}</span></td><td><b>${esc(x.title)}</b><div class="muted">${esc(x.meta)}</div></td><td><button class="btn btn-ghost btn-sm" onclick="opsHistoryOpenAction({view:'${safeView}',id:'${safeId}',employeeId:'${safeEmp}',milestone:'${safeMilestone}'})">Open</button></td></tr>`;
    }).join('');
    const priorityRows=items.slice(0,8).map(x=>`<div class="ops-priority-item ${x.level==='danger'?'danger':''}" onclick="${x.id?`openCaseDetails('${x.id}')`:`go('${x.view}')`}"><span class="priority-dot"></span><div><div class="title">${esc(x.title)}</div><div class="meta">${esc(x.meta)}</div></div><span class="right">${esc(x.right||'')}</span></div>`).join('');
    const opsActions=selected?[...selectedCasesOpen,...selectedLeaves.filter(x=>x.status==='Pending'),...selectedNte.filter(x=>x.status!=='Resolved'),...selectedIncidents.filter(x=>!['Resolved','Closed'].includes(x.status)),...selectedPrf.filter(x=>x.status==='Pending Approval')].length:0;

    const html=`
      <div class="ops-pro-header"><div><div class="eyebrow">HR Operations</div><h1>Daily Operations Workspace</h1><p>One workspace for employee selection, operational queues, case follow-through, lifecycle activity, and HR actions.</p></div><div class="page-header-actions">${canEdit()?`<button class="btn btn-brass" onclick="openEmployeeForm()">${iPlus(15)} New Employee</button><button class="btn btn-ghost" onclick="openCaseForm()">${iShield(15)} New Case</button>`:''}<button class="btn btn-ghost" onclick="go('actionCenter')">Action Center</button></div></div>
      <div class="ops-coverage-strip"><div class="coverage-title"><span>Workspace coverage</span><b>16 / 16 operational areas enabled</b><small>Every core HR action can be opened from HR Operations.</small></div><div class="coverage-pills">${coverageItems.map(([label,key])=>`<span class="coverage-pill ${selected&&actionCounts[key]?'has-work':''}"><i></i>${label}${selected&&actionCounts[key]?` <b>${actionCounts[key]}</b>`:''}</span>`).join('')}</div></div>
      <div class="ops-kpi-grid">
        <div class="ops-kpi"><span>Open Cases</span><b>${openCases.length}</b><small>Current operational case load</small></div>
        <div class="ops-kpi"><span>Pending Leave</span><b>${pendingLeaves}</b><small>Awaiting HR action</small></div>
        <div class="ops-kpi"><span>Open NTE</span><b>${openNTE}</b><small>Follow-up required</small></div>
        <div class="ops-kpi"><span>Overdue Reviews</span><b>${overdueEvaluations}</b><small>Probation milestones</small></div>
        <div class="ops-kpi"><span>Documents · 30d</span><b>${expiringDocs}</b><small>Expiring or overdue</small></div>
        <div class="ops-kpi"><span>ATD Outstanding</span><b>${peso(outstandingATD)}</b><small>Remaining balance</small></div>
      </div>
      <div class="ops-pro-grid">
        <section class="panel ops-directory">
          <div class="panel-heading-row"><div><h3>Employee Directory</h3><p>Search and filter the workforce, then open a complete employee operations workspace.</p></div><span class="record-count">${filteredEmployees.length} / ${allEmployees.length}</span></div>
          <div class="ops-directory-filters">
            <div class="searchbox ops-searchbox">${iSearch(16)}<input id="ops-employee-search" data-search-key="opsEmployeeSearch" type="search" autocomplete="off" placeholder="Search employee, ID, position, department, contact…" value="${esc(STATE.opsEmployeeSearch||'')}" oninput="queueSearchRender(this,'opsEmployeeSearch',renderOperationsWorkspace)" onkeydown="if(event.key==='Enter'){event.preventDefault();queueSearchRender(this,'opsEmployeeSearch',renderOperationsWorkspace,0)}" aria-label="Search employees"></div>
            <select class="filter-select" onchange="STATE.opsEmployeeDept=this.value;STATE.tablePages={};renderOperationsWorkspace()"><option value="">All Departments</option>${depts.map(d=>`<option value="${esc(d)}" ${STATE.opsEmployeeDept===d?'selected':''}>${esc(d)}</option>`).join('')}</select>
            <select class="filter-select" onchange="STATE.opsEmployeeStatus=this.value;STATE.tablePages={};renderOperationsWorkspace()"><option value="">All Statuses</option>${statusOptions.map(v=>`<option value="${esc(v)}" ${STATE.opsEmployeeStatus===v?'selected':''}>${esc(v)}</option>`).join('')}</select>
            <select class="filter-select" onchange="STATE.opsEmployeeClass=this.value;STATE.tablePages={};renderOperationsWorkspace()"><option value="">All Classifications</option>${classOptions.map(v=>`<option value="${v}" ${STATE.opsEmployeeClass===v?'selected':''}>${v}</option>`).join('')}</select>
            <button class="btn btn-primary btn-sm" onclick="queueSearchRender(document.getElementById('ops-employee-search'),'opsEmployeeSearch',renderOperationsWorkspace,0)">${iSearch(14)} Search</button>${q||STATE.opsEmployeeDept||STATE.opsEmployeeStatus||STATE.opsEmployeeClass?`<button class="btn btn-ghost btn-sm" onclick="cancelSearchRender('opsEmployeeSearch');STATE.opsEmployeeSearch='';STATE.opsEmployeeDept='';STATE.opsEmployeeStatus='';STATE.opsEmployeeClass='';STATE.tablePages={};renderOperationsWorkspace()">Clear</button>`:''}
          </div>
          <div class="table-card ops-directory-card"><div class="table-card-head"><div class="table-meta"><b>${filteredEmployees.length}</b> employees <span class="table-meta-muted">${opsActions} selected-work items require attention${selected?' for this employee':''}</span></div><button class="btn btn-ghost btn-sm" onclick="STATE.opsEmployeeSearch='';STATE.opsEmployeeDept='';STATE.opsEmployeeStatus='';STATE.opsEmployeeClass='';STATE.tablePages={};renderOperationsWorkspace()">Reset View</button></div><div class="tablewrap"><table class="data-table" id="ops-directory-table"><thead><tr><th>Employee</th><th>Position</th><th>Department</th><th>Status</th><th>Class</th><th>Attention</th><th class="actions-head">Open</th></tr></thead><tbody>${dirRows||`<tr><td colspan="7"><div class="empty"><b>No employees found</b><span>Adjust your search or filters.</span></div></td></tr>`}</tbody></table></div></div>
        </section>
        <aside class="ops-side-stack">
          <section class="panel"><div class="panel-heading-row"><div><h3>Priority Work</h3><p>Current operational items needing attention.</p></div><button class="btn btn-ghost btn-sm" onclick="go('actionCenter')">All</button></div><div class="ops-priority-list">${priorityRows||'<div class="empty"><b>Queue is clear</b><span>No priority work was found.</span></div>'}</div></section>
          <section class="panel"><div class="panel-heading-row"><div><h3>Operations Guide</h3><p>A consistent six-step HR processing flow.</p></div></div><div class="ops-process-grid">${[['1','Open request','Locate the employee and confirm the master record.'],['2','Assess','Review current work, history, and data-quality findings.'],['3','Create record','Start the relevant HR action without leaving the workspace.'],['4','Process workflow','Assign, review, approve, and track deadlines.'],['5','Store evidence','Link documents and related records to the employee/case.'],['6','Close & audit','Complete the action and preserve the activity history.']].map(([n,t,d])=>`<div class="ops-process-step"><span>${n}</span><div><b>${t}</b><small>${d}</small></div></div>`).join('')}</div></section>
        </aside>
      </div>
      <section class="panel ops-selected-panel">
        ${selected?`<div class="ops-selected-head"><div class="cell-identity"><span class="avatar-lg">${esc(opsInitials(selected.name))}</span><div><div class="eyebrow">Selected employee</div><h2>${esc(selected.name)}</h2><p>${esc(selected.employeeNo||'—')} · ${esc(selected.position||'—')} · ${esc(selected.department||'Unassigned')} · ${esc(employeeTenureText(selected))}</p><div class="ops-identity-contact">${selected.mobileNumber?`<span>${esc(selected.mobileNumber)}</span>`:''}${selected.personalEmail?`<span>${esc(selected.personalEmail)}</span>`:''}${selected.dateHired?`<span>Hired ${fmtDate(selected.dateHired)}</span>`:''}</div></div></div><div class="page-header-actions"><button class="btn btn-primary" onclick="openEmployeeProfile('${selected.id}')">${iUser(15)} Employee 360</button>${canEdit()?`<button class="btn btn-ghost" onclick="openEmployeeForm('${selected.id}')">${iEdit(14)} Edit Employee</button>`:''}</div></div>`:'<div class="empty"><b>No employee selected</b><span>Select an employee above to begin.</span></div>'}
        ${selected?`<div class="ops-detail-kpis"><div><span>Status</span><b>${statusBadge(selected.status,EMP_STATUS_MAP)}</b></div><div><span>Classification</span><b>${statusBadge(currentClass,currentClass==='Regular'?{'Regular':'b-green'}:{'Probationary':'b-amber'})}</b></div><div><span>Master Data</span><b>${completion}%</b><small>Profile completeness</small></div><div><span>Open Cases</span><b>${selectedCasesOpen.length}</b><small>${selectedCasesAll.length} total cases</small></div><div><span>Open Relations</span><b>${selectedIncidents.filter(x=>!['Resolved','Closed'].includes(x.status)).length+selectedNte.filter(x=>x.status!=='Resolved').length}</b><small>Incident + NTE</small></div><div><span>Documents</span><b>${selectedDocs.length}</b><small>${selectedDocs.filter(d=>d.expirationDate&&d.expirationDate<=addDaysISO(todayISO(),30)).length} need review</small></div><div><span>ATD</span><b>${peso(atdBalance)}</b><small>Outstanding</small></div><div><span>Activity</span><b>${history.length}</b><small>Connected records</small></div></div>
          <div class="ops-health"><div class="health-bar"><span style="width:${Math.min(100,Math.max(0,completion))}%"></span></div><div><b>Master-data completeness</b><span>${completion}% populated</span></div>${nextMilestone?`<div><b>Next milestone</b><span>${esc(nextMilestone.label)}${nextMilestone.date?' · '+fmtDate(nextMilestone.date):''}</span></div>`:'<div><b>Lifecycle</b><span>No pending milestone</span></div>'}</div>
          <div class="ops-section-block">${actionHtml}</div>`:''}
      </section>
      <section class="panel ops-history-panel"><div class="panel-heading-row"><div><h3>Employee Work History</h3><p>All connected HR activity for the selected employee, not only currently open items.</p></div><div class="toolbar-inline ops-history-tools"><div class="searchbox compact-search">${iSearch(14)}<input data-search-key="opsHistorySearch" type="search" autocomplete="off" placeholder="Search activity…" value="${esc(STATE.opsHistorySearch||'')}" oninput="queueSearchRender(this,'opsHistorySearch',renderOperationsWorkspace)" onkeydown="if(event.key==='Enter'){event.preventDefault();queueSearchRender(this,'opsHistorySearch',renderOperationsWorkspace,0)}" aria-label="Search employee work history"></div><select class="filter-select" onchange="STATE.opsWorkFilter=this.value;STATE.tablePages={};renderOperationsWorkspace()"><option value="all">All Activity</option>${historyTypes.map(v=>`<option value="${esc(v.toLowerCase())}" ${STATE.opsWorkFilter===v.toLowerCase()?'selected':''}>${esc(v)}</option>`).join('')}</select>${historyQ||STATE.opsWorkFilter!=='all'?`<button class="btn btn-ghost btn-sm" onclick="cancelSearchRender('opsHistorySearch');STATE.opsHistorySearch='';STATE.opsWorkFilter='all';STATE.tablePages={};renderOperationsWorkspace()">Clear</button>`:''}<button class="btn btn-ghost btn-sm" onclick="openEmployeeProfile('${selected?.id||''}')" ${selected?'':'disabled'}>Employee 360</button></div></div><div class="table-card"><div class="table-card-head"><div class="table-meta"><b>${filteredHistory.length}</b> activities <span class="table-meta-muted">${historyQ?`matching “${esc(STATE.opsHistorySearch)}” · `:''}${STATE.opsWorkFilter==='all'?'all connected HR records':`filtered to ${esc(STATE.opsWorkFilter)}`}</span></div></div><div class="tablewrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Activity</th><th class="actions-head">Action</th></tr></thead><tbody>${workRows||`<tr><td colspan="4"><div class="empty"><b>No operational history</b><span>No matching connected records were found for this employee.</span></div></td></tr>`}</tbody></table></div></div></section>`;
    document.getElementById('content').innerHTML=html;
    requestAnimationFrame(()=>enhanceDataTables());
  }catch(e){ document.getElementById('content').innerHTML=`<div class="panel"><h3>HR Operations</h3><div class="notice"><b>Could not load the workspace.</b> ${esc(e.message||e)}</div></div>`; }
}
const NAV = [
  {sec:'My Workspace',items:[
    {v:'selfService',label:'My HR Portal',icon:iUser,roles:['Employee','Manager']},
    {v:'teamApprovals',label:'Requests & Approvals',icon:iCheck,roles:['Administrator','HR Staff','Manager'],count:()=>pendingServiceRequestCount()},
    {v:'lifecycleChecklists',label:'Lifecycle Checklists',icon:iCheck,roles:['Administrator','HR Staff','Manager'],count:()=>lifecycleChecklistPendingCount()},
  ]},
  {sec:'Overview',items:[
    {v:'dashboard',label:'Dashboard',icon:iGrid},
    {v:'actionCenter',label:'Action Center',icon:iShield},
    {v:'workflow',label:'Workflow & Approvals',icon:iCheck,count:()=>workflowPendingCount()},
    {v:'automation',label:'Automation Center',icon:iChart,count:()=>automationPendingCount()},
    {v:'operations',label:'HR Operations',icon:iGrid},
    {v:'analytics',label:'Management Analytics',icon:iChart},
    {v:'weeklyReport',label:'Weekly Report',icon:iChart},
  ]},
  {sec:'People & Records',items:[
    {v:'employees',label:'Employee Information',icon:iUsers},
    {v:'onboarding',label:'Onboarding & Applicants',icon:iCheck,roles:['Administrator','HR Staff'],count:()=>onboardingOpenCount()},
    {v:'employeeLifecycle',label:'Employment Lifecycle',icon:iSwap},
    {v:'leaves',label:'Leave Tracker',icon:iCal},
    {v:'evaluations',label:'Probationary Evaluations',icon:iChart},
    {v:'transfers',label:'Department Transfers',icon:iSwap},
    {v:'prf',label:'PRF',icon:iDoc},
    {v:'oncall',label:'On-Call / Replacement',icon:iSwap},
    {v:'atd',label:'ATD Monitoring',icon:iChart},
  ]},
  {sec:'Employee Relations',items:[
    {v:'cases',label:'HR Cases',icon:iShield},
    {v:'incidents',label:'Incident Reports',icon:iShield},
    {v:'cvr',label:'CVR',icon:iShield},
    {v:'nte',label:'NTE',icon:iDoc},
    {v:'memos',label:'Memorandum',icon:iDoc},
    {v:'nod',label:'NOD',icon:iDoc},
    {v:'disciplinary',label:'Disciplinary Action',icon:iShield},
    {v:'offenseCatalog',label:'Offense Catalog',icon:iDoc},
    {v:'offenseSummary',label:'Offense Summary',icon:iChart},
  ]},
  {sec:'Documents & Governance',items:[
    {v:'documents',label:'Document Center',icon:iDoc},
    {v:'dataQuality',label:'Data Quality & Governance',icon:iCheck},
    {v:'reports',label:'Reports',icon:iChart},
    {v:'users',label:'User Management',icon:iUsers},
    {v:'settings',label:'Settings',icon:iGear,roles:['Administrator','HR Staff']},
  ]},
];
const NAV_SECTION_ICONS={
  'My Workspace':iUser,
  'Overview':iGrid,
  'People & Records':iUsers,
  'Employee Relations':iShield,
  'Documents & Governance':iDoc,
};
function navItemVisible(item){
  const role=SESSION?.role||'HR Staff';
  if(item.roles) return item.roles.includes(role);
  return !['Employee','Manager'].includes(role);
}
function navSectionForView(view){return NAV.find(group=>group.items.some(item=>item.v===view&&navItemVisible(item)))?.sec||'';}
function navLabelForView(view){return NAV.flatMap(group=>group.items).find(item=>item.v===view&&navItemVisible(item))?.label||'';}
let NAV_PANEL_SECTION='';
function closeNavGroupPanel(){
  document.getElementById('navgroup-popover')?.remove();
  document.querySelectorAll('.navgroup-head[aria-expanded="true"]').forEach(button=>button.setAttribute('aria-expanded','false'));
  document.querySelectorAll('.navgroup.panel-open').forEach(group=>group.classList.remove('panel-open'));
  NAV_PANEL_SECTION='';
}
function positionNavGroupPanel(panel,trigger){
  if(!panel||!trigger||window.matchMedia('(max-width:720px)').matches){panel?.style.removeProperty('left');panel?.style.removeProperty('top');return;}
  const rect=trigger.getBoundingClientRect();
  const width=Math.min(286,window.innerWidth-24);
  const left=Math.min(rect.right+8,window.innerWidth-width-12);
  const top=Math.max(12,Math.min(rect.top,window.innerHeight-panel.offsetHeight-12));
  panel.style.left=`${left}px`;panel.style.top=`${top}px`;
}
function toggleNavGroup(sec,trigger){
  if(NAV_PANEL_SECTION===sec){closeNavGroupPanel();return;}
  closeNavGroupPanel();
  const group=NAV.find(item=>item.sec===sec);if(!group)return;
  const items=group.items.filter(navItemVisible);if(!items.length)return;
  const panel=document.createElement('div');panel.id='navgroup-popover';panel.className='navgroup-popover';panel.setAttribute('role','menu');panel.setAttribute('aria-label',`${sec} transactions`);
  const activeItem=items.find(item=>item.v===STATE.view);
  panel.innerHTML=`<div class="navgroup-popover-head"><div class="navgroup-popover-heading"><div class="navgroup-popover-breadcrumb"><span>SLSC HR</span><i>›</i><b>${esc(sec)}</b></div><strong>${esc(activeItem?.label||'Select a workspace')}</strong><small>${items.length} available view${items.length===1?'':'s'}</small></div><button type="button" class="navgroup-popover-close" title="Close navigation" aria-label="Close navigation" onclick="closeNavGroupPanel()">&times;</button></div><div class="navgroup-popover-list">${items.map(item=>`<button type="button" role="menuitem" class="navgroup-popover-item${STATE.view===item.v?' active':''}" data-nav-view="${item.v}">${item.icon(16)}<span>${esc(item.label)}</span>${item.count?`<em>${item.count()}</em>`:''}</button>`).join('')}</div>`;
  panel.querySelectorAll('[data-nav-view]').forEach(button=>button.addEventListener('click',()=>{const view=button.dataset.navView;closeNavGroupPanel();go(view);}));
  document.body.appendChild(panel);NAV_PANEL_SECTION=sec;trigger.setAttribute('aria-expanded','true');trigger.closest('.navgroup')?.classList.add('panel-open');positionNavGroupPanel(panel,trigger);
  requestAnimationFrame(()=>panel.querySelector('.navgroup-popover-item.active,.navgroup-popover-item')?.focus());
}
function renderNav(){
  closeNavGroupPanel();
  const nav=document.getElementById('nav'); nav.innerHTML='';
  NAV.forEach(group=>{
    const items=group.items.filter(navItemVisible);
    if(!items.length) return;
    const active=items.some(it=>STATE.view===it.v);
    const sectionIcon=NAV_SECTION_ICONS[group.sec]||iGrid;
    const g=document.createElement('section');g.className='navgroup'+(active?' has-active':'');
    const head=document.createElement('button');head.type='button';head.className='navgroup-head';head.setAttribute('aria-expanded','false');head.setAttribute('aria-haspopup','menu');head.innerHTML=`<span class="navgroup-head-main"><span class="navgroup-icon">${sectionIcon(15)}</span><span class="navgroup-title">${esc(group.sec)}</span><span class="navgroup-size">${items.length}</span></span><span class="navgroup-chevron">${iArrowLeft(13)}</span>`;head.onclick=()=>toggleNavGroup(group.sec,head);g.appendChild(head);
    nav.appendChild(g);
  });
}
function toggleSidebar(){
  const app=document.getElementById('app');
  if(!app) return;
  const open=app.classList.toggle('sidebar-open');
  if(!open)closeNavGroupPanel();
  const btn=document.querySelector('.mobile-menu');
  if(btn) btn.setAttribute('aria-expanded',open?'true':'false');
}
function closeSidebar(){
  const app=document.getElementById('app');
  if(!app) return;
  app.classList.remove('sidebar-open');
  closeNavGroupPanel();
  const btn=document.querySelector('.mobile-menu');
  if(btn) btn.setAttribute('aria-expanded','false');
}
async function go(view,{skipUnsaved=false}={}){
  const navItem=NAV.flatMap(group=>group.items).find(item=>item.v===view);
  if(navItem&&!navItemVisible(navItem)){toast('This workspace is not available for your role.',true);return;}
  if(!skipUnsaved && !(await requestPageNavigation(view))) return;
  STATE.view=view; STATE.search=''; STATE.filter=''; STATE.filterDept=''; STATE.filterStatus='';
  const content=document.getElementById('content');
  content?.classList.toggle('employee-directory-content',view==='employees');
  content?.classList.toggle('data-focused-content',DATA_FOCUSED_VIEWS.has(view));
  STATE.tablePages={};
  closeSidebar();
  renderNav();
  const renderer=RENDERERS[view];
  if(typeof renderer==='function') await Promise.resolve(renderer());
  if(STATE.view!==view) return;
  requestAnimationFrame(()=>{
    enhanceDataTables();
    capturePageEditState();
  });
}

const DATA_FOCUSED_VIEWS=new Set([
  'teamApprovals','lifecycleChecklists','workflow','automation','operations','employees','onboarding','employeeLifecycle','leaves','evaluations','transfers','prf','oncall','atd','cases','incidents','cvr','nte','memos','nod','disciplinary','offenseCatalog','offenseSummary','documents','dataQuality','users'
]);

const SEARCH_RENDER_TIMERS=new Map();
function queueSearchRender(input,stateKey,renderFn,delay=460){
  const view=STATE.view;
  const timerKey=`${view}:${stateKey}`;
  STATE[stateKey]=input.value;
  clearTimeout(SEARCH_RENDER_TIMERS.get(timerKey));
  const searchHost=input.closest('.searchbox,.search');
  searchHost?.classList.add('search-pending');
  SEARCH_RENDER_TIMERS.set(timerKey,setTimeout(async()=>{
    SEARCH_RENDER_TIMERS.delete(timerKey);
    if(STATE.view!==view) return;
    const selectionStart=input.selectionStart;
    const selectionEnd=input.selectionEnd;
    const scrollX=window.scrollX;
    const scrollY=window.scrollY;
    STATE.tablePages={};
    await Promise.resolve(renderFn());
    if(STATE.view!==view) return;
    requestAnimationFrame(()=>{
      const next=document.querySelector(`[data-search-key="${stateKey}"]`);
      if(!next) return;
      next.focus();
      const end=next.value.length;
      next.setSelectionRange?.(Math.min(selectionStart??end,end),Math.min(selectionEnd??end,end));
      next.closest('.searchbox,.search')?.classList.remove('search-pending');
      window.scrollTo(scrollX,scrollY);
    });
  },Math.max(0,Number(delay)||0)));
}
function cancelSearchRender(stateKey){
  for(const [key,timer] of SEARCH_RENDER_TIMERS){
    if(key.endsWith(`:${stateKey}`)){ clearTimeout(timer); SEARCH_RENDER_TIMERS.delete(key); }
  }
  document.querySelectorAll(`[data-search-key="${stateKey}"]`).forEach(input=>input.closest('.searchbox,.search')?.classList.remove('search-pending'));
}

/* ---------------- searchable employee picker ---------------- */
function employeePickerFind({id='',name=''}={}){
  if(id){const match=DB.employees.find(employee=>String(employee.id)===String(id));if(match)return match;}
  const normalized=normalizeEmployeeName(name);
  return normalized?DB.employees.find(employee=>normalizeEmployeeName(employee.name)===normalized)||null:null;
}
function employeePickerHTML({id,label='Employee',selectedId='',selectedName='',mode='id',required=false,full=false,placeholder='Type an employee name or number',onSelect='',autofill=true}={}){
  const selected=employeePickerFind({id:selectedId,name:selectedName});
  const stored=selected?(mode==='name'?selected.name:selected.id):'';
  const display=selected?employeeDisplayName(selected):selectedName||'';
  return `<div class="field ${full?'full':''}"><label for="${id}_search">${esc(label)}${required?' *':''}</label><div class="employee-picker" id="${id}_picker" data-mode="${mode}" data-on-select="${esc(onSelect)}" data-autofill="${autofill?'true':'false'}" data-selected-id="${esc(selected?.id||'')}"><input type="hidden" id="${id}" value="${esc(stored)}"><div class="employee-picker-input">${iSearch(15)}<input id="${id}_search" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}_options" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(display)}" onfocus="employeePickerOpen('${id}')" oninput="employeePickerInput('${id}',this.value)" onkeydown="employeePickerKeydown(event,'${id}')"><button type="button" class="employee-picker-clear" title="Clear employee" aria-label="Clear employee" onclick="employeePickerClear('${id}')">&times;</button></div><div class="employee-picker-options" id="${id}_options" role="listbox" hidden></div></div></div>`;
}
function employeePickerMatches(query){
  const q=String(query||'').trim().toLowerCase();
  const rows=DB.employees.filter(employee=>!q||[employee.name,employeeDisplayName(employee),employee.employeeNo].some(value=>String(value||'').toLowerCase().includes(q)));
  return rows.sort((a,b)=>{
    const aName=employeeDisplayName(a).toLowerCase(),bName=employeeDisplayName(b).toLowerCase();
    const aFirst=q&&(aName.startsWith(q)||String(a.employeeNo||'').toLowerCase().startsWith(q))?0:1;
    const bFirst=q&&(bName.startsWith(q)||String(b.employeeNo||'').toLowerCase().startsWith(q))?0:1;
    return aFirst-bFirst||aName.localeCompare(bName);
  });
}
function employeePickerRender(id,query=''){
  const picker=document.getElementById(`${id}_picker`);const options=document.getElementById(`${id}_options`);const input=document.getElementById(`${id}_search`);if(!picker||!options||!input)return;
  const rows=employeePickerMatches(query);const hasQuery=String(query||'').trim().length>0;const visible=hasQuery?rows:rows.slice(0,20);picker.dataset.activeIndex='-1';
  options.innerHTML=visible.length?visible.map((employee,index)=>`<button type="button" role="option" data-index="${index}" data-employee-id="${esc(employee.id)}" onmousedown="event.preventDefault()" onclick="employeePickerChoose('${id}','${esc(employee.id)}')"><span class="employee-picker-avatar">${esc(opsInitials(employeeDisplayName(employee)))}</span><span><b>${esc(employeeDisplayName(employee))}</b><small>${esc(employee.employeeNo||'No employee number')} · ${esc(employee.position||'No position')}</small></span><em>${esc(employee.department||'Unassigned')}</em></button>`).join(''):`<div class="employee-picker-empty"><b>No employee found</b><span>Try the employee's name or employee number.</span></div>`;
  if(rows.length>visible.length) options.insertAdjacentHTML('beforeend',`<div class="employee-picker-more">Type a name or employee number to search all ${rows.length} employees.</div>`);
  options.hidden=false;input.setAttribute('aria-expanded','true');
}
function employeePickerOpen(id){
  const picker=document.getElementById(`${id}_picker`);const input=document.getElementById(`${id}_search`);if(!picker||!input)return;
  employeePickerRender(id,picker.dataset.selectedId?'':input.value);
}
function employeePickerInput(id,value){
  const picker=document.getElementById(`${id}_picker`);const hidden=document.getElementById(id);if(!picker||!hidden)return;
  picker.dataset.selectedId='';hidden.value='';employeePickerRender(id,value);
}
function employeePickerClose(id){
  const input=document.getElementById(`${id}_search`);const options=document.getElementById(`${id}_options`);if(options)options.hidden=true;if(input)input.setAttribute('aria-expanded','false');
}
function employeePickerAutofill(employee){
  const values={f_department:employee.department||'',f_position:employee.position||'',f_fromDepartment:employee.department||'',cv_department:employee.department||'',in_department:employee.department||''};
  Object.entries(values).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.value=value;});
}
function employeePickerChoose(id,employeeId){
  const picker=document.getElementById(`${id}_picker`);const input=document.getElementById(`${id}_search`);const hidden=document.getElementById(id);const employee=DB.employees.find(row=>String(row.id)===String(employeeId));if(!picker||!input||!hidden||!employee)return;
  picker.dataset.selectedId=employee.id;hidden.value=picker.dataset.mode==='name'?employee.name:employee.id;input.value=employeeDisplayName(employee);input.setAttribute('aria-activedescendant','');employeePickerClose(id);
  if(picker.dataset.autofill==='true')employeePickerAutofill(employee);
  const callback=picker.dataset.onSelect;if(callback&&typeof window[callback]==='function')window[callback]();
  hidden.dispatchEvent(new Event('change',{bubbles:true}));input.focus();
}
function employeePickerClear(id){
  const picker=document.getElementById(`${id}_picker`);const input=document.getElementById(`${id}_search`);const hidden=document.getElementById(id);if(!picker||!input||!hidden)return;
  picker.dataset.selectedId='';hidden.value='';input.value='';employeePickerRender(id,'');input.focus();
}
function employeePickerSet(id,reference){
  const employee=employeePickerFind({id:String(reference||''),name:String(reference||'')});
  if(employee){employeePickerChoose(id,employee.id);return true;}
  const input=document.getElementById(`${id}_search`);const hidden=document.getElementById(id);if(input)input.value=String(reference||'');if(hidden)hidden.value='';return false;
}
function employeePickerSelected(id){
  const picker=document.getElementById(`${id}_picker`);return DB.employees.find(employee=>String(employee.id)===String(picker?.dataset.selectedId||''))||null;
}
function employeePickerKeydown(event,id){
  const picker=document.getElementById(`${id}_picker`);const options=document.getElementById(`${id}_options`);if(!picker||!options)return;
  if(event.key==='Escape'){employeePickerClose(id);return;}
  if(options.hidden&&(event.key==='ArrowDown'||event.key==='ArrowUp'))employeePickerOpen(id);
  const buttons=[...options.querySelectorAll('button[data-employee-id]')];if(!buttons.length)return;
  let index=Number(picker.dataset.activeIndex||-1);
  if(event.key==='ArrowDown'){event.preventDefault();index=Math.min(buttons.length-1,index+1);}
  else if(event.key==='ArrowUp'){event.preventDefault();index=Math.max(0,index-1);}
  else if(event.key==='Enter'&&index>=0){event.preventDefault();employeePickerChoose(id,buttons[index].dataset.employeeId);return;}
  else return;
  picker.dataset.activeIndex=String(index);buttons.forEach((button,i)=>button.classList.toggle('active',i===index));buttons[index]?.scrollIntoView({block:'nearest'});
}

/* ---------------- icons (inline svg, currentColor) ---------------- */
function iGrid(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;}
function iUsers(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17.5" cy="8.5" r="2.4"/><path d="M15 14.3c2.7.2 4.7 2.2 4.9 5.7"/></svg>`;}
function iCal(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v3M16 3v3"/></svg>`;}
function iShield(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z"/></svg>`;}
function iCheck(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12.5l4.2 4.2L19 7"/></svg>`;}
function iDoc(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>`;}
function iSwap(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h13M17 8l-3-3M17 8l-3 3M20 16H7M7 16l3-3M7 16l3 3"/></svg>`;}
function iChart(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>`;}
function iUser(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/></svg>`;}
function iGear(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 000-3l1-1.7-1.7-1.7-1.7 1a1.7 1.7 0 00-3 0l-1-1.7H11l-1 1.7a1.7 1.7 0 00-3 0l-1.7-1L3.6 8.8l1 1.7a1.7 1.7 0 000 3l-1 1.7 1.7 1.7 1.7-1a1.7 1.7 0 003 0l1 1.7h1.9l1-1.7a1.7 1.7 0 003 0l1.7 1 1.7-1.7-1-1.7z"/></svg>`;}
function iPlus(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;}
function iEdit(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>`;}
function iTrash(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`;}
function iMore(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></svg>`;}
function iSearch(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;}
function iDownload(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>`;}
function iUpload(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21V9M7 14l5-5 5 5M4 4h16"/></svg>`;}
function iColumns(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>`;}
function iInfo(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>`;}
function iBell(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 9a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9z"/><path d="M10 21h4"/></svg>`;}
function iArrowLeft(s){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>`;}

/* ---------------- audit / permissions ---------------- */
function logAudit(action){
  const entry={ts:new Date().toISOString(), user:SESSION?SESSION.fullName:'System', action};
  DB.audit.unshift(entry); DB.audit=DB.audit.slice(0,200);
  supabase.from('hr_audit_logs').insert({user_id:SESSION?.id||null,user_name:entry.user,action:entry.action}).then(({error})=>{ if(error) console.warn('Audit log failed',error); });
}
function isHRRole(role=SESSION?.role){ return role==='Administrator'||role==='HR Staff'; }
function canEdit(){ return !SESSION || isHRRole(); }
function canExport(){ return roleCanExport(SESSION?.role,SESSION?.canExport); }
function requireExportAccess(){
  if(canExport())return true;
  toast('Export is disabled for this account. Ask a System Administrator to enable export access.',true);
  return false;
}
function canReviewServiceRequests(){ return isHRRole()||SESSION?.role==='Manager'; }
function setTitle(t,sub){ document.getElementById('tb-title').textContent=t; document.getElementById('tb-sub').textContent=sub||''; }

const INFORMATION_NOTES={
  leaveUploads:{title:'Leave document handling',body:`Uploaded leave forms use the storage destination selected by the System Administrator. Files can be up to ${Math.round(MAX_ATTACH_BYTES/1024/1024)}MB each. Automatic OCR or text extraction is not performed, so all fields must be entered or confirmed manually.`},
  disciplinaryLevels:{title:'Offense level calculation',body:"The offense level is counted automatically from the employee's prior records for the same violation and references the approved disciplinary policy. Confirm the suggested action before saving."},
  cvrOcr:{title:'CVR document handling',body:"The system does not automatically scan or OCR a photo or scan of a printed CVR. Select or enter the offenses shown on the paper CVR and attach the source document. Offense level and consequence are calculated from the employee's CVR history and the Offense Catalog."},
  incidentOcr:{title:'Incident report handling',body:'The system does not automatically scan or OCR a printed or photographed incident report. Select or enter the incident types shown on the report and attach the source document. Repeat-incident counts are calculated from saved history.'},
  atdUploads:{title:'ATD document handling',body:`ATD forms, incident reports, quotation or SOA documents, and payslips use the storage destination selected by the System Administrator. Files can be up to ${Math.round(MAX_ATTACH_BYTES/1024/1024)}MB each. Payment status and balances are calculated from recorded payments.`},
  evaluations:{title:'Evaluation due dates',body:'Evaluation due dates are calculated from Date Hired at 30, 90, and 180 days. Mark an evaluation complete and attach its document after completion.'},
  offenseSummary:{title:'Offense summary calculation',body:'This view combines Disciplinary Action and CVR records by employee. Levels and consequences use the same Offense Catalog lookup used by CVR.'},
  userAdministration:{title:'User administration access',body:'Only Administrators can change account roles or profile details. New users register from the login screen and must then be linked to the appropriate employee record.'},
};
function informationNoteButton(noteId){
  const note=INFORMATION_NOTES[noteId];if(!note)return '';
  return `<button type="button" class="btn btn-ghost information-note-button" title="${esc(note.title)}" aria-label="Open information: ${esc(note.title)}" onclick="openInformationNote('${noteId}')">${iInfo(16)}<span class="information-note-label">Info</span></button>`;
}
function openInformationNote(noteId){
  const note=INFORMATION_NOTES[noteId];if(!note)return;
  openModal(`<div class="modal-head"><div class="information-modal-title"><span>${iInfo(18)}</span><h3>${esc(note.title)}</h3></div><button type="button" onclick="closeModal()" aria-label="Close information">&times;</button></div><div class="modal-body information-modal-body"><p>${esc(note.body)}</p></div><div class="modal-foot"><button type="button" class="btn btn-primary" onclick="closeModal()">Got it</button></div>`);
}

/* ---------------- classification ---------------- */
function classify(emp){
  if(emp.classOverride && emp.classOverride!=='Auto') return emp.classOverride;
  if(!emp.dateHired) return '—';
  const hired = new Date(emp.dateHired+'T00:00:00');
  const days = Math.floor((Date.now()-hired.getTime())/86400000);
  return days >= (DB.settings.probationDays||180) ? 'Regular' : 'Probationary';
}

/* ---------------- CSV export ---------------- */
function toCSV(rows, cols){
  const head = cols.map(c=>`"${c.label}"`).join(',');
  const body = rows.map(r=> cols.map(c=>{
    let v = typeof c.get==='function'? c.get(r) : r[c.key];
    v = (v==null?'':String(v)).replace(/"/g,'""');
    return `"${v}"`;
  }).join(',')).join('\n');
  return head+'\n'+body;
}
function downloadCSV(filename, csv){
  if(!requireExportAccess())return false;
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/* ---------------- modal helpers ---------------- */
let MODAL_TRIGGER=null;
let MODAL_EDIT_STATE=null;
let PAGE_EDIT_STATE=null;
let PENDING_PAGE_NAVIGATION=null;
const CONFIRMED_MODAL_CLOSE_TARGETS=new WeakSet();
const EDIT_SAVE_HANDLER_PATTERN=/\b(?:save[A-Z]\w*|[A-Za-z_$]\w*Save[A-Z]\w*|addCaseNote|linkCaseRecord|createCaseFromRecord)\s*\(/;

function editorControls(root,{page=false}={}){
  if(!root) return [];
  const ignoredPageArea='.toolbar,.data-toolbar,.analytics-toolbar,.workflow-toolbar,.ops-directory-filters,.table-pagination';
  return [...root.querySelectorAll('input,select,textarea,[contenteditable="true"]')].filter(control=>{
    if(control.disabled || control.closest('#data-confirm-overlay')) return false;
    if(page && (control.closest(ignoredPageArea) || control.dataset.searchKey!=null || control.type==='search')) return false;
    return !['button','submit','reset','hidden'].includes(String(control.type||'').toLowerCase());
  });
}
function serializeEditor(root,options={}){
  return JSON.stringify(editorControls(root,options).map((control,index)=>{
    const key=control.id||control.name||`${control.tagName.toLowerCase()}-${index}`;
    if(control.matches('[contenteditable="true"]')) return [key,control.textContent||''];
    if(control.type==='file') return [key,[...(control.files||[])].map(file=>`${file.name}:${file.size}:${file.lastModified}`)];
    if(control.type==='checkbox'||control.type==='radio') return [key,control.checked];
    if(control.tagName==='SELECT'&&control.multiple) return [key,[...control.selectedOptions].map(option=>option.value)];
    return [key,control.value];
  }));
}
function findEditorSaveButton(root){
  const candidates=[...root.querySelectorAll('button,[role="button"]')].map((button,index)=>{
    const handler=button.getAttribute('onclick')||'';
    const label=(button.textContent||button.title||'').replace(/\s+/g,' ').trim();
    const intent=dataChangeIntent(button,'click');
    if(!intent || intent.danger) return null;
    const score=EDIT_SAVE_HANDLER_PATTERN.test(handler)?3:/\b(save|add note|link record|create|register|update)\b/i.test(label)?2:0;
    return score?{button,score,index}:null;
  }).filter(Boolean);
  candidates.sort((a,b)=>b.score-a.score||a.index-b.index);
  return candidates[0]?.button||null;
}
function captureModalEditState(){
  const modal=document.getElementById('modal');
  const saveButton=findEditorSaveButton(modal);
  const controls=editorControls(modal);
  MODAL_EDIT_STATE=saveButton&&controls.length?{baseline:serializeEditor(modal),saveButton}:null;
}
function modalHasUnsavedChanges(){
  const modal=document.getElementById('modal');
  return Boolean(MODAL_EDIT_STATE && modal?.isConnected && serializeEditor(modal)!==MODAL_EDIT_STATE.baseline);
}
function capturePageEditState(){
  const content=document.getElementById('content');
  const saveButton=findEditorSaveButton(content);
  const controls=editorControls(content,{page:true});
  PAGE_EDIT_STATE=saveButton&&controls.length?{view:STATE.view,baseline:serializeEditor(content,{page:true}),saveButton}:null;
}
function pageHasUnsavedChanges(){
  const content=document.getElementById('content');
  return Boolean(PAGE_EDIT_STATE && PAGE_EDIT_STATE.view===STATE.view && serializeEditor(content,{page:true})!==PAGE_EDIT_STATE.baseline);
}
async function requestPageNavigation(view){
  if(!pageHasUnsavedChanges()) return true;
  const choice=await confirmDataChange({
    title:'Unsaved changes',
    message:'You changed data on this page. Save your changes before leaving?',
    confirmLabel:'Save changes',
    secondaryLabel:'Discard changes',
    cancelLabel:'Keep editing',
  });
  if(choice==='confirm'){
    const saveButton=PAGE_EDIT_STATE?.saveButton;
    if(saveButton?.isConnected){
      PENDING_PAGE_NAVIGATION=view;
      CONFIRMED_CHANGE_TARGETS.add(saveButton);
      saveButton.click();
    }
    return false;
  }
  if(choice==='discard'){
    PAGE_EDIT_STATE=null;
    return true;
  }
  return false;
}
async function requestCloseModal(trigger=null){
  if(!modalHasUnsavedChanges()){
    if(trigger){CONFIRMED_MODAL_CLOSE_TARGETS.add(trigger);trigger.click();}
    else await closeModal();
    return true;
  }
  const choice=await confirmDataChange({
    title:'Unsaved changes',
    message:'You changed this record. Save your changes before leaving?',
    confirmLabel:'Save changes',
    secondaryLabel:'Discard changes',
    cancelLabel:'Keep editing',
  });
  if(choice==='confirm'){
    const saveButton=MODAL_EDIT_STATE?.saveButton;
    if(saveButton?.isConnected){
      CONFIRMED_CHANGE_TARGETS.add(saveButton);
      saveButton.click();
    }
    return false;
  }
  if(choice==='discard'){
    if(trigger){CONFIRMED_MODAL_CLOSE_TARGETS.add(trigger);trigger.click();}
    else await closeModal();
    return true;
  }
  return false;
}
function enhanceModalHeader(modal){
  const head=modal?.querySelector(':scope > .modal-head');
  if(!head||head.classList.contains('employee-workspace-head')||head.querySelector('.employee-workspace-breadcrumb,.modal-context-breadcrumb')) return;
  const title=head.querySelector('h3');
  if(!title) return;
  const section=navSectionForView(STATE.view)||'SLSC HR';
  const page=navLabelForView(STATE.view)||document.getElementById('tb-title')?.textContent?.trim()||'Workspace';
  const action=title.textContent.trim();
  const closeButton=Array.from(head.children).find(child=>child.matches('button'));
  const copy=document.createElement('div');
  copy.className='modal-head-copy';
  Array.from(head.children).filter(child=>child!==closeButton).forEach(child=>copy.appendChild(child));
  const trail=[section,page];
  if(action&&action.toLowerCase()!==page.toLowerCase()) trail.push(action);
  const breadcrumb=document.createElement('div');
  breadcrumb.className='modal-context-breadcrumb';
  breadcrumb.setAttribute('aria-label','Current location');
  breadcrumb.innerHTML=trail.map((label,index)=>`${index?'<span aria-hidden="true">›</span>':''}<${index===trail.length-1?'b':'span'}>${esc(label)}</${index===trail.length-1?'b':'span'}>`).join('');
  copy.prepend(breadcrumb);
  head.insertBefore(copy,closeButton||null);
}
function openModal(html){
  const overlay=document.getElementById('overlay');
  const modal=document.getElementById('modal');
  MODAL_TRIGGER=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.classList.remove('case-modal','employee-workspace-modal');
  modal.innerHTML=html;
  enhanceModalHeader(modal);
  overlay.classList.add('on');
  overlay.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
  requestAnimationFrame(()=>{
    modal.scrollTop=0;
    modal.querySelector('.modal-body')?.scrollTo(0,0);
    enhanceRowActionMenus();
    Promise.resolve(initializeAddressComponents(modal)).finally(()=>captureModalEditState());
    (modal.querySelector('.modal-head button')||modal).focus();
  });
}
async function closeModal(keepUploads=[]){
  const keep=new Set(Array.isArray(keepUploads)?keepUploads:[keepUploads]);
  const pending=[...PENDING_UPLOADS].filter(path=>!keep.has(path));
  pending.forEach(path=>PENDING_UPLOADS.delete(path));
  const overlay=document.getElementById('overlay');
  overlay.classList.remove('on');
  overlay.setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
  document.getElementById('modal').innerHTML='';
  MODAL_EDIT_STATE=null;
  if(MODAL_TRIGGER?.isConnected) MODAL_TRIGGER.focus();
  MODAL_TRIGGER=null;
  await deleteStorageObjects(pending);
}
document.getElementById('overlay').addEventListener('click',e=>{if(e.target.id==='overlay') requestCloseModal();});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  if(document.getElementById('data-confirm-overlay')?.classList.contains('on')) return;
  if(document.getElementById('overlay').classList.contains('on')) requestCloseModal();
});

const DATA_CHANGE_HANDLER_PATTERN=/\b(?:save[A-Z]\w*|[A-Za-z_$]\w*Save[A-Z]\w*|delete[A-Z]\w*|doRegister|createCaseFromRecord|linkRecordToExistingCase|linkCaseRecord|unlinkCaseRecord|addCaseNote|setCaseWorkflowStatus|workflowCompleteTask|workflowDecideTask|runAutomationEngine|toggleAutomationRule)\s*\(/;
const CONFIRMED_CHANGE_TARGETS=new WeakSet();
let DATA_CONFIRM_PENDING=null;
let DATA_CONFIRM_TRIGGER=null;
function dataChangeIntent(target,eventType='click'){
  if(!target || target.closest?.('#data-confirm-overlay')) return null;
  if(target.dataset?.confirmChange==='false') return null;
  const attr=eventType==='submit'?'onsubmit':eventType==='change'?'onchange':'onclick';
  const handler=target.getAttribute?.(attr)||'';
  if(target.dataset?.confirmChange!=='true' && !DATA_CHANGE_HANDLER_PATTERN.test(handler)) return null;
  const submitLabel=eventType==='submit'?target.querySelector?.('button[type="submit"],input[type="submit"]')?.textContent:'';
  const rawLabel=(target.dataset?.confirmLabel||target.getAttribute?.('title')||submitLabel||target.textContent||'Save changes').replace(/\s+/g,' ').trim();
  const label=rawLabel||'Save changes';
  const danger=/delete|remove|reject|unlink|close case/i.test(`${label} ${handler}`);
  return {
    title:danger?'Confirm destructive change':'Confirm data change',
    message:`You are about to ${label.toLowerCase()}. This will update stored system data${danger?' and may not be reversible':''}. Do you want to continue?`,
    confirmLabel:danger?(label.match(/delete|remove|reject|unlink|close/i)?.[0]||'Confirm'):'Confirm',
    danger,
  };
}
function confirmDataChange({title='Confirm data change',message='This action will update stored system data. Do you want to continue?',confirmLabel='Confirm',secondaryLabel='',cancelLabel='Cancel',danger=false,warning=false}={}){
  if(DATA_CONFIRM_PENDING) DATA_CONFIRM_PENDING(false);
  const overlay=document.getElementById('data-confirm-overlay');
  const accept=document.getElementById('data-confirm-accept');
  const discard=document.getElementById('data-confirm-discard');
  const cancel=document.getElementById('data-confirm-cancel');
  DATA_CONFIRM_TRIGGER=document.activeElement instanceof HTMLElement?document.activeElement:null;
  document.getElementById('data-confirm-title').textContent=title;
  document.getElementById('data-confirm-message').textContent=message;
  cancel.textContent=cancelLabel;
  discard.textContent=secondaryLabel||'Discard changes';
  discard.hidden=!secondaryLabel;
  accept.textContent=confirmLabel;
  accept.className=`btn ${danger?'btn-danger':warning?'btn-brass':'btn-primary'}`;
  overlay.classList.toggle('danger',danger);
  overlay.classList.toggle('warning',warning&&!danger);
  overlay.classList.add('on');
  overlay.setAttribute('aria-hidden','false');
  document.body.classList.add('data-confirm-open');
  return new Promise(resolve=>{
    DATA_CONFIRM_PENDING=resolve;
    requestAnimationFrame(()=>cancel.focus());
  });
}
function resolveDataChangeConfirmation(result){
  if(!DATA_CONFIRM_PENDING) return;
  const resolve=DATA_CONFIRM_PENDING;
  DATA_CONFIRM_PENDING=null;
  const overlay=document.getElementById('data-confirm-overlay');
  overlay.classList.remove('on','danger','warning');
  overlay.setAttribute('aria-hidden','true');
  document.body.classList.remove('data-confirm-open');
  if(DATA_CONFIRM_TRIGGER?.isConnected) DATA_CONFIRM_TRIGGER.focus();
  DATA_CONFIRM_TRIGGER=null;
  resolve(result);
}
document.getElementById('data-confirm-cancel').addEventListener('click',()=>resolveDataChangeConfirmation(false));
document.getElementById('data-confirm-discard').addEventListener('click',()=>resolveDataChangeConfirmation('discard'));
document.getElementById('data-confirm-accept').addEventListener('click',()=>resolveDataChangeConfirmation('confirm'));
document.getElementById('data-confirm-overlay').addEventListener('click',event=>{
  if(event.target.id==='data-confirm-overlay') resolveDataChangeConfirmation(false);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.getElementById('data-confirm-overlay').classList.contains('on')){
    event.preventDefault();
    resolveDataChangeConfirmation(false);
  }
});
document.addEventListener('click',async event=>{
  const target=event.target.closest?.('#modal button,#modal [role="button"]');
  if(!target) return;
  if(CONFIRMED_MODAL_CLOSE_TARGETS.has(target)){CONFIRMED_MODAL_CLOSE_TARGETS.delete(target);return;}
  if(!(target.getAttribute('onclick')||'').includes('closeModal(') || !modalHasUnsavedChanges()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  await requestCloseModal(target);
},true);
document.addEventListener('click',async event=>{
  const target=event.target.closest?.('button,[role="button"]');
  if(!target) return;
  if(CONFIRMED_CHANGE_TARGETS.has(target)){CONFIRMED_CHANGE_TARGETS.delete(target);return;}
  const intent=dataChangeIntent(target,'click');
  if(!intent) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if(await confirmDataChange(intent)){
    CONFIRMED_CHANGE_TARGETS.add(target);
    target.click();
  }
},true);
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(CONFIRMED_CHANGE_TARGETS.has(form)){CONFIRMED_CHANGE_TARGETS.delete(form);return;}
  const intent=dataChangeIntent(form,'submit');
  if(!intent) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if(await confirmDataChange(intent)){
    CONFIRMED_CHANGE_TARGETS.add(form);
    form.requestSubmit();
  }
},true);
document.addEventListener('change',async event=>{
  const target=event.target;
  if(CONFIRMED_CHANGE_TARGETS.has(target)){CONFIRMED_CHANGE_TARGETS.delete(target);return;}
  const intent=dataChangeIntent(target,'change');
  if(!intent) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const desiredChecked=target.checked;
  if(target.type==='checkbox'||target.type==='radio') target.checked=!desiredChecked;
  if(await confirmDataChange(intent)){
    if(target.type==='checkbox'||target.type==='radio') target.checked=desiredChecked;
    CONFIRMED_CHANGE_TARGETS.add(target);
    target.dispatchEvent(new Event('change',{bubbles:true}));
  }
},true);
window.addEventListener('beforeunload',event=>{
  if(!modalHasUnsavedChanges()&&!pageHasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue='';
});

const ROW_ACTION_MENUS=new Map();
let ROW_ACTION_MENU_ID=0;
function rowActionLabel(button,index){
  const explicit=(button.getAttribute('aria-label')||button.title||'').trim();
  if(explicit) return explicit;
  const visible=(button.textContent||'').replace(/\s+/g,' ').trim();
  if(visible && !/^action(?:s)?$/i.test(visible)) return visible;
  const handler=(button.getAttribute('onclick')||'').toLowerCase();
  if(handler.includes('delete')||handler.includes('remove')) return 'Delete';
  if(handler.includes('transfer')) return 'Record transfer';
  if(handler.includes('status')) return 'Update status';
  if(handler.includes('payment')) return 'Payments';
  if(handler.includes('edit')||handler.includes('form')) return 'Edit';
  if(handler.includes('profile')||handler.includes('details')||handler.includes('open')) return 'View details';
  return `Action ${index+1}`;
}
function enhanceRowActionMenus(){
  for(const [id,menu] of ROW_ACTION_MENUS){
    if(!menu.trigger?.isConnected) ROW_ACTION_MENUS.delete(id);
  }
  document.querySelectorAll('#content .rowactions, #modal .rowactions').forEach(group=>{
    if(group.dataset.menuEnhanced==='true') return;
    const buttons=[...group.querySelectorAll(':scope > button:not([disabled])')];
    if(!buttons.length) return;
    const id=`row-actions-${++ROW_ACTION_MENU_ID}`;
    const actions=buttons.map((button,index)=>({
      button,
      label:rowActionLabel(button,index),
      icon:button.querySelector('svg')?.outerHTML||iMore(17),
      danger:/delete|remove/i.test(`${button.title} ${button.getAttribute('onclick')||''}`),
    }));
    const trigger=document.createElement('button');
    trigger.type='button';
    trigger.className='btn btn-ghost btn-sm row-action-trigger';
    trigger.title='Open actions';
    trigger.setAttribute('aria-label','Open actions');
    trigger.setAttribute('aria-haspopup','dialog');
    trigger.setAttribute('onclick',`openRowActionMenu('${id}')`);
    trigger.innerHTML=iEdit(15);
    group.replaceChildren(trigger);
    group.classList.add('is-menu');
    group.dataset.menuEnhanced='true';
    ROW_ACTION_MENUS.set(id,{actions,trigger});
  });
}
function openRowActionMenu(id){
  const menu=ROW_ACTION_MENUS.get(id);
  if(!menu) return;
  openModal(`
    <div class="modal-head"><div><h3>Actions</h3><div class="small">Choose the transaction you want to perform.</div></div><button type="button" onclick="closeModal()" aria-label="Close">&times;</button></div>
    <div class="modal-body"><div class="row-action-menu">
      ${menu.actions.map((action,index)=>`<button type="button" class="row-action-option${action.danger?' danger':''}" onclick="runRowAction('${id}',${index})"><span class="row-action-option-icon">${action.icon}</span><span>${esc(action.label)}</span></button>`).join('')}
    </div></div>
    <div class="modal-foot"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button></div>
  `);
}
async function runRowAction(id,index){
  const action=ROW_ACTION_MENUS.get(id)?.actions[index];
  if(!action) return;
  const intent=dataChangeIntent(action.button,'click');
  if(intent && !(await confirmDataChange(intent))) return;
  await closeModal();
  action.button.click();
}

function fieldHTML(f, val){
  const v = val==null?'':val;
  if(f.employeePicker||f.key==='employeeName'||f.key==='employeeReplaced'){
    return employeePickerHTML({id:`f_${f.key}`,label:f.label,selectedId:f.employeeSelectedId||'',selectedName:v,mode:'name',required:!!f.required,full:!!f.full,autofill:f.key==='employeeName'});
  }
  if(f.type==='select'){
    const options=typeof f.options==='function'?f.options(v):(f.options||[]);
    const selectId=`f_${f.key}`;
    const catalogType=f.catalog;
    const catalogButton=catalogType&&isHRRole()?`<button type="button" class="catalog-add-button" title="Add ${catalogType}" aria-label="Add ${catalogType}" onclick="toggleCatalogQuickAdd('${catalogType}','${selectId}','${f.catalogDepartmentId||''}','${f.catalogPositionId||''}')">${iPlus(15)}</button>`:'';
    const quickAdd=catalogButton?`<div id="${selectId}_catalog_editor" class="catalog-quick-add" hidden data-catalog-type="${catalogType}" data-select-id="${selectId}" data-department-id="${f.catalogDepartmentId||''}" data-position-id="${f.catalogPositionId||''}"><input id="${selectId}_catalog_name" type="text" maxlength="${catalogType==='department'?60:80}" placeholder="New ${catalogType} name" onkeydown="catalogQuickAddKeydown(event,'${selectId}')"><button type="button" class="btn btn-primary btn-sm" data-confirm-change="false" onclick="saveCatalogQuickAdd('${selectId}')">Add</button><button type="button" class="btn btn-ghost btn-sm" onclick="toggleCatalogQuickAdd('${catalogType}','${selectId}')">Cancel</button></div>`:'';
    return `<div class="field ${f.full?'full':''}"><label>${f.label}${f.required?' *':''}</label>
      <div class="catalog-select-row"><select id="${selectId}" ${f.required?'required':''} ${f.onchange?`onchange="${f.onchange}"`:''}>
        ${f.placeholder?`<option value="">${esc(f.placeholder)}</option>`:''}${options.map(o=>`<option value="${esc(o)}" ${o===v?'selected':''}>${esc(o)}</option>`).join('')}
      </select>${catalogButton}</div>${quickAdd}</div>`;
  }
  if(f.type==='textarea'){
    return `<div class="field full"><label>${f.label}${f.required?' *':''}</label><textarea id="f_${f.key}" rows="3" ${f.required?'required':''} ${f.maxLength?`maxlength="${f.maxLength}"`:''}>${esc(v)}</textarea></div>`;
  }
  if(f.type==='file'){
    const existingData = f.existingData || '';
    const storageModule=uploadModuleFolder(f.storagePrefix||STATE.view||'documents');
    const provider=attachmentStorageProvider()==='google-drive'?'Google Drive':'Supabase Storage';
    return `<div class="field ${f.full?'full':''}"><label>${f.label}</label>
      <input type="hidden" id="f_${f.key}" value="${esc(v)}">
      <input type="hidden" id="f_${f.key}_data" value="${esc(existingData)}">
      <button type="button" class="btn btn-ghost btn-sm" onclick="this.nextElementSibling.click()">${iPlus(13)} Choose File</button>
      <input type="file" style="display:none" onchange="handleFileInput('${f.key}', this, '${esc(storageModule)}')">
      <div id="f_${f.key}_preview">${attachPreviewHTML(f.key, v, existingData)}</div>
      <div class="computed-note" style="margin-top:6px;">New file: ${esc(provider)}${provider==='Google Drive'?` / ${esc(storageModule)}`:''} (max ${Math.round(MAX_ATTACH_BYTES/1024/1024)}MB).</div>
      </div>`;
  }
  const formatAttrs=f.format?`inputmode="numeric" maxlength="${f.format==='sss'?13:f.format==='philHealth'?15:f.format==='pagIbig'?14:15}" oninput="formatGovernmentIdInput(this,'${f.format}')"`:'';
  const numericAttrs=f.type==='number'?`${f.min!=null?`min="${f.min}"`:''} ${f.step!=null?`step="${f.step}"`:''}`:'';
  return `<div class="field ${f.full?'full':''}"><label>${f.label}${f.required?' *':''}</label><input type="${f.type}" id="f_${f.key}" value="${esc(f.format?formatGovernmentId(f.format,v):v)}" ${f.required?'required':''} ${f.readonly?'readonly':''} ${formatAttrs} ${numericAttrs}></div>`;
}
function readFields(fields){
  const out={};
  fields.forEach(f=>{
    const el=document.getElementById('f_'+f.key);
    out[f.key]= el? el.value.trim(): '';
    if(f.employeePicker||f.key==='employeeName'||f.key==='employeeReplaced'){
      const selected=employeePickerSelected('f_'+f.key);
      if(f.key==='employeeName') out.employeeId=selected?.id||'';
      if(f.key==='employeeReplaced') out.employeeReplacedId=selected?.id||'';
    }
    if(f.type==='file'){
      const dataEl = document.getElementById('f_'+f.key+'_data');
      out[f.key+'Data'] = dataEl? dataEl.value : '';
    }
  });
  return out;
}
function governmentIdDigits(value){ return String(value||'').replace(/\D/g,''); }
function formatGovernmentId(kind,value){
  const digits=governmentIdDigits(value);
  if(kind==='sss') return [digits.slice(0,2),digits.slice(2,9),digits.slice(9,10)].filter(Boolean).join('-');
  if(kind==='philHealth') return [digits.slice(0,2),digits.slice(2,11),digits.slice(11,12)].filter(Boolean).join('-');
  if(kind==='pagIbig') return [digits.slice(0,4),digits.slice(4,8),digits.slice(8,12)].filter(Boolean).join('-');
  if(kind==='tin') return [digits.slice(0,3),digits.slice(3,6),digits.slice(6,9),digits.slice(9,12)].filter(Boolean).join('-');
  return digits;
}
function formatGovernmentIdInput(input,kind){ input.value=formatGovernmentId(kind,input.value); }
function governmentIdError(kind,value){
  if(!String(value||'').trim()) return '';
  const digits=governmentIdDigits(value);
  const valid=kind==='sss'?digits.length===10:kind==='philHealth'||kind==='pagIbig'?digits.length===12:kind==='tin'?[9,12].includes(digits.length):true;
  if(valid) return '';
  return {sss:'SSS Number must contain 10 digits (example: 09-5421455-9).',philHealth:'PhilHealth PIN must contain 12 digits in 2-9-1 format.',pagIbig:'Pag-IBIG MID must contain 12 digits in 4-4-4 format.',tin:'TIN must contain 9 digits, with an optional 3-digit branch code.'}[kind]||'Invalid government ID.';
}
function validateGovernmentIds(values){
  return [['tin','tin'],['sssNumber','sss'],['philHealthNumber','philHealth'],['pagIbigNumber','pagIbig']].map(([key,kind])=>governmentIdError(kind,values[key])).find(Boolean)||'';
}

/* ================================================================
   DASHBOARD
   ================================================================ */
async function dashboardOpenEmployees(classification=''){
  STATE.employeeSearch='';
  STATE.employeeDepartmentFilter='';
  STATE.employeeBranchFilter='';
  STATE.employeeStatusFilter='';
  STATE.employeeClassFilter=classification;
  await go('employees');
}
async function dashboardOpenCases(status=''){
  await go('cases');
  if(status){ STATE.filter=status; STATE.tablePages={}; await renderCases(); }
}
async function renderDashboard(){
  setTitle('Dashboard', `Overview of all HR & disciplinary records — ${DB.settings.orgName}`);
  document.getElementById('content').innerHTML='<div class="panel"><div class="desc">Loading dashboard…</div></div>';
  try{
    const [{data:cases,error:caseError}]=await Promise.all([
      supabase.from('hr_cases').select('id,case_number,employee_name,department,status,opened_at,closed_at,updated_at').order('updated_at',{ascending:false}).limit(250)
    ]);
    if(caseError) throw caseError;
    if(STATE.view!=='dashboard') return;

    const today=todayISO();
    const next7=addDaysISO(today,7);
    const next30=addDaysISO(today,30);
    const emps=DB.employees;
    const total=emps.length;
    const statusCounts={}; EMP_STATUS.forEach(s=>statusCounts[s]=0);
    emps.forEach(e=>statusCounts[e.status]=(statusCounts[e.status]||0)+1);
    const male=emps.filter(e=>e.gender==='Male').length;
    const female=emps.filter(e=>e.gender==='Female').length;
    const probationary=emps.filter(e=>classify(e)==='Probationary').length;
    const regular=emps.filter(e=>classify(e)==='Regular').length;
    const onLeaveToday=DB.leaves.filter(l=>l.startDate<=today && l.endDate>=today && l.status!=='Disapproved').length;
    const upcomingLeaves=DB.leaves.filter(l=>l.startDate>today && l.startDate<=next30 && l.status!=='Disapproved').sort((a,b)=>a.startDate.localeCompare(b.startDate));
    const activeOnCall=DB.oncall.filter(o=>o.status==='Active').length;
    const openNTE=DB.nte.filter(n=>n.status!=='Resolved').length;
    const atdOutstanding=DB.atd.reduce((sum,r)=>sum+atdRemaining(r),0);
    const atdOpen=DB.atd.filter(r=>atdRemaining(r)>0).length;
    const evalOverdue=[];
    const evalDueSoon=[];
    emps.filter(e=>classify(e)==='Probationary' && e.dateHired).forEach(e=>EVAL_MILESTONES.forEach(m=>{
      const st=evalStatusInfo(e,m);
      if(st.label==='Overdue') evalOverdue.push({employee:e,milestone:m,due:st.due});
      else if(st.label==='Due Soon') evalDueSoon.push({employee:e,milestone:m,due:st.due});
    }));

    const allCases=cases||[];
    const activeCases=allCases.filter(c=>!['Closed','Cancelled','Resolved'].includes(c.status));
    const agedCases=activeCases.filter(c=>analyticsDaysOpen(c.opened_at,c.closed_at)>=30);
    const statusList=['Open','NTE Issued','Memo Issued','For Decision','Resolved','Closed'];
    const caseStatus={}; allCases.forEach(c=>caseStatus[c.status]=(caseStatus[c.status]||0)+1);
    const caseDept={}; activeCases.forEach(c=>{const d=c.department||'Unassigned';caseDept[d]=(caseDept[d]||0)+1;});
    const recentCases=allCases.slice(0,6);

    const attention=[];
    if(agedCases.length) attention.push({danger:true,title:`${agedCases.length} HR case(s) open 30+ days`,meta:'Review aging cases and update their current workflow stage.',view:'cases'});
    if(evalOverdue.length) attention.push({danger:true,title:`${evalOverdue.length} probationary evaluation(s) overdue`,meta:'Review the overdue 30 / 90 / 180-day evaluations.',view:'evaluations'});
    if(openNTE) attention.push({title:`${openNTE} NTE record(s) awaiting resolution`,meta:'Review outstanding Notice to Explain records.',view:'nte'});
    if(atdOutstanding>0) attention.push({title:`${peso(atdOutstanding)} ATD balance outstanding`,meta:`${atdOpen} deduction record(s) still have a remaining balance.`,view:'atd'});
    if(onLeaveToday) attention.push({title:`${onLeaveToday} employee(s) on leave today`,meta:'Review the Leave Tracker for current coverage.',view:'leaves'});
    if(!attention.length) attention.push({title:'No immediate attention items',meta:'The current HR records do not show overdue or open follow-ups.',view:'analytics'});

    const deptRows=Object.entries(caseDept).sort((a,b)=>b[1]-a[1]);
    const maxDept=Math.max(...Object.values(caseDept),1);
    const statusMax=Math.max(...statusList.map(s=>caseStatus[s]||0),1);

    const upcoming=[
      ...upcomingLeaves.slice(0,4).map(l=>({date:l.startDate,title:l.employeeName,meta:`${l.leaveType} · ${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`,view:'leaves'})),
      ...evalDueSoon.slice(0,4).map(x=>({date:x.due,title:x.employee.name,meta:`${x.milestone.label} evaluation · due ${fmtDate(x.due)}`,view:'evaluations'}))
    ].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,7);

    const html=`
      <div class="dashboard-hero">
        <div>
          <div class="eyebrow">${esc(DB.settings.orgName)} · HR Operations</div>
          <h1>Good ${new Date().getHours()<12?'morning':new Date().getHours()<18?'afternoon':'evening'}, ${esc((SESSION?.fullName||'Team').split(' ')[0])}.</h1>
          <p>${fmtDate(today)} · A current snapshot of people, cases, leave, evaluations, and payroll-related deductions.</p>
        </div>
        <div class="dashboard-actions">
          ${canEdit()?`<button class="btn btn-brass btn-sm" onclick="openEmployeeForm()">${iPlus(14)} Add Employee</button><button class="btn btn-ghost btn-sm" onclick="openCaseForm()">${iPlus(14)} New HR Case</button>`:''}
          <button class="btn btn-ghost btn-sm" onclick="go('analytics')">${iChart(14)} Analytics</button>
        </div>
      </div>

      <div class="dashboard-kpis">
        <button type="button" class="dashboard-kpi dashboard-kpi-link" style="--accent:var(--brass)" onclick="dashboardOpenEmployees()"><span class="top"><span class="label">Employees</span><span class="icon">${iUsers(15)}</span></span><span class="value">${total}</span><span class="meta">${statusCounts['Active']||0} active · ${probationary} probationary</span></button>
        <button type="button" class="dashboard-kpi dashboard-kpi-link" style="--accent:var(--rust)" onclick="dashboardOpenCases()"><span class="top"><span class="label">Active Cases</span><span class="icon">${iShield(15)}</span></span><span class="value">${activeCases.length}</span><span class="meta">${agedCases.length} aged 30+ days</span></button>
        <button type="button" class="dashboard-kpi dashboard-kpi-link" style="--accent:var(--forest)" onclick="go('leaves')"><span class="top"><span class="label">On Leave Today</span><span class="icon">${iCal(15)}</span></span><span class="value">${onLeaveToday}</span><span class="meta">${upcomingLeaves.length} upcoming in 30 days</span></button>
        <button type="button" class="dashboard-kpi dashboard-kpi-link" style="--accent:var(--amber)" onclick="go('actionCenter')"><span class="top"><span class="label">Open Follow-ups</span><span class="icon">${iDoc(15)}</span></span><span class="value">${openNTE+evalOverdue.length}</span><span class="meta">${openNTE} NTE · ${evalOverdue.length} overdue evaluations</span></button>
        <button type="button" class="dashboard-kpi dashboard-kpi-link" style="--accent:var(--ink)" onclick="go('atd')"><span class="top"><span class="label">ATD Outstanding</span><span class="icon">₱</span></span><span class="value" style="font-size:22px;">${peso(atdOutstanding)}</span><span class="meta">${atdOpen} record(s) with balance</span></button>
      </div>

      <div class="dashboard-grid">
        <div class="panel">
          <div class="dashboard-panel-head"><div><h3>Attention Required</h3><div class="desc">Items that may need an HR follow-up today.</div></div><button class="btn btn-ghost btn-sm" onclick="go('analytics')">View All</button></div>
          <div class="alert-grid">
            ${attention.slice(0,6).map(a=>`<div class="alert-card ${a.danger?'danger':''}" onclick="go('${a.view}')"><span class="bullet"></span><div><div class="a-title">${esc(a.title)}</div><div class="a-meta">${esc(a.meta)}</div></div></div>`).join('')}
          </div>
        </div>
        <div class="panel">
          <div class="dashboard-panel-head"><div><h3>Case Pipeline</h3><div class="desc">Current distribution of HR case stages.</div></div><button class="btn btn-ghost btn-sm" onclick="go('cases')">Manage</button></div>
          <div class="case-pipeline">
            ${statusList.map(s=>{const c=caseStatus[s]||0;const pct=Math.round(c/statusMax*100);const stage=s==='Open'?'var(--brass)':s==='NTE Issued'||s==='Memo Issued'?'var(--amber)':s==='For Decision'?'var(--ink)':s==='Resolved'?'var(--forest)':'var(--slate)';return `<button type="button" class="case-stage case-stage-link" onclick="dashboardOpenCases('${esc(s)}')"><span class="stage-label">${esc(s)}</span><span class="stage-count">${c}</span><span class="stage-bar"><span class="stage-fill" style="--stage:${stage};width:${pct}%"></span></span></button>`;}).join('')}
          </div>
        </div>
      </div>

      <div class="dashboard-grid equal">
        <div class="panel">
          <div class="dashboard-panel-head"><div><h3>Active Cases by Department</h3><div class="desc">Open workload grouped by current department.</div></div></div>
          <div class="chart-list">
            ${deptRows.length?deptRows.slice(0,7).map(([d,c])=>`<div class="chart-row"><div class="label" title="${esc(d)}">${esc(d)}</div><div class="chart-track"><div class="chart-fill" style="width:${Math.round(c/maxDept*100)}%"></div></div><div class="chart-count">${c}</div></div>`).join(''):'<div class="small">No active cases yet.</div>'}
          </div>
          <div class="dashboard-footnote">Use this as an operational workload view; it is not a measure of employee performance or legal outcome.</div>
        </div>
        <div class="panel">
          <div class="dashboard-panel-head"><div><h3>Next 30 Days</h3><div class="desc">Upcoming leave starts and probationary evaluation due dates.</div></div></div>
          <div class="dashboard-list">
            ${upcoming.length?upcoming.map(x=>`<div class="dashboard-list-row" onclick="go('${x.view}')" style="cursor:pointer;"><div><div class="primary">${esc(x.title)}</div><div class="secondary">${esc(x.meta)}</div></div><div class="right">${fmtDate(x.date)}</div></div>`).join(''):'<div class="small">Nothing scheduled in the next 30 days.</div>'}
          </div>
        </div>
      </div>

      <div class="dashboard-grid equal">
        <div class="panel">
          <div class="dashboard-panel-head"><div><h3>Recent HR Cases</h3><div class="desc">Most recently updated case records.</div></div><button class="btn btn-ghost btn-sm" onclick="go('cases')">View All</button></div>
          <div class="tablewrap"><table class="dashboard-mini-table"><thead><tr><th>Case</th><th>Employee</th><th>Status</th><th>Age</th></tr></thead><tbody>
            ${recentCases.length?recentCases.map(c=>`<tr onclick="openCaseDetails('${c.id}')" style="cursor:pointer;"><td><b class="mono">${esc(c.case_number)}</b></td><td>${esc(c.employee_name)}</td><td>${statusBadge(c.status,CASE_STATUS_MAP)}</td><td>${analyticsDaysOpen(c.opened_at,c.closed_at)}d</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">No HR cases yet.</div></td></tr>'}
          </tbody></table></div>
        </div>
        <div class="panel">
          <div class="dashboard-panel-head"><div><h3>Workforce Composition</h3><div class="desc">Current employee mix.</div></div><button class="btn btn-ghost btn-sm" onclick="go('employees')">Employees</button></div>
          <div class="donut-wrap" style="margin-bottom:14px;">
            ${donut([{v:male,c:'#B8863B'},{v:female,c:'#3C6E52'}])}
            <div class="legend"><div class="row"><span class="dot" style="background:#B8863B"></span>Male<span class="amt">${male}</span></div><div class="row"><span class="dot" style="background:#3C6E52"></span>Female<span class="amt">${female}</span></div></div>
          </div>
          <div style="height:1px;background:var(--line);margin:8px 0 12px;"></div>
          <div class="grid cols-2" style="gap:10px;">
            <button type="button" class="metric-card metric-card-link" onclick="dashboardOpenEmployees('Regular')"><span class="k">Regular</span><span class="v">${regular}</span><span class="s">Classified by threshold</span></button>
            <button type="button" class="metric-card metric-card-link" onclick="dashboardOpenEmployees('Probationary')"><span class="k">Probationary</span><span class="v">${probationary}</span><span class="s">Within probation period</span></button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="dashboard-panel-head"><div><h3>HR Operations Pulse</h3><div class="desc">A compact view of the modules most often reviewed by management.</div></div><button class="btn btn-ghost btn-sm" onclick="go('weeklyReport')">Weekly Report</button></div>
        <div class="grid cols-4">
          <div class="metric-card"><div class="k">Incidents</div><div class="v">${DB.incidents.length}</div><div class="s">Recorded incident reports</div></div>
          <div class="metric-card"><div class="k">Disciplinary</div><div class="v">${DB.disciplinary.length}</div><div class="s">Disciplinary action records</div></div>
          <div class="metric-card"><div class="k">Active On-Call</div><div class="v">${activeOnCall}</div><div class="s">Current replacement assignments</div></div>
          <div class="metric-card"><div class="k">Memoranda</div><div class="v">${DB.memos.length}</div><div class="s">Memoranda of offense</div></div>
        </div>
        <div class="dashboard-footnote">Dashboard figures are descriptive summaries of information stored in the application. Review the underlying records before making operational decisions.</div>
      </div>
    `;
    document.getElementById('content').innerHTML=html;
  }catch(e){
    if(STATE.view!=='dashboard') return;
    document.getElementById('content').innerHTML=`<div class="panel"><h3>Dashboard</h3><div class="notice"><b>Could not load dashboard data.</b> ${esc(e.message||e)}</div></div>`;
  }
}
function donut(segs){
  const total = segs.reduce((s,x)=>s+x.v,0)||1;
  let acc=0; const stops=[];
  segs.forEach(s=>{ const start=acc/total*360; acc+=s.v; const end=acc/total*360; stops.push(`${s.c} ${start}deg ${end}deg`); });
  const bg = stops.length? `conic-gradient(${stops.join(',')})` : '#EEEDE7';
  return `<div class="donut" style="background:${bg}; display:flex;align-items:center;justify-content:center;">
    <div style="width:74px;height:74px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-family:'Source Serif 4',serif;font-weight:700;font-size:18px;">${total}</div>
  </div>`;
}

/* ================================================================
   GENERIC CRUD MODULE FACTORY (used by leaves, disciplinary, nte, memos, nod, oncall)
   ================================================================ */
function moduleConfig(key){ return MODULES[key]; }

async function renderModuleView(key){
  const cfg = MODULES[key];
  setTitle(cfg.title, cfg.subtitle);
  const data = DB[key] || [];
  const q = String(STATE.search||'').trim().toLowerCase();
  const hasDepartment = data.some(r=>r && Object.prototype.hasOwnProperty.call(r,'department')) || (cfg.fields||[]).some(f=>f.key==='department');
  const hasStatus = data.some(r=>r && Object.prototype.hasOwnProperty.call(r,'status')) || (cfg.fields||[]).some(f=>f.key==='status');
  const deptOptions=[...new Set(data.map(r=>String(r.department||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const autoStatusOptions=[...new Set(data.map(r=>String(r.status||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  let filteredRows = data.filter(r=>{
    const searchOk=!q || (cfg.searchFields||[]).some(f=> String(r[f]??'').toLowerCase().includes(q));
    const deptOk=!STATE.filterDept || String(r.department||'')===STATE.filterDept;
    const statusOk=!STATE.filterStatus || String(r.status||'')===STATE.filterStatus;
    const legacyFilterOk=!STATE.filter || !cfg.filterField || r[cfg.filterField]===STATE.filter;
    return searchOk&&deptOk&&statusOk&&legacyFilterOk;
  });
  filteredRows = filteredRows.slice().sort((a,b)=>String(b[cfg.sortKey]??'').localeCompare(String(a[cfg.sortKey]??'')));
  const pageScope=`records:${key}`;
  let pageResult;
  try{
    pageResult=await queryRecordPage({module:key,scope:pageScope,search:STATE.search,searchFields:cfg.searchFields||[],filters:{department:STATE.filterDept,status:STATE.filterStatus,[cfg.filterField||'']:STATE.filter},sortKey:cfg.sortKey||'',defaultSize:10});
  }catch(error){toast('Server filtering failed; showing locally cached records: '+error.message,true);pageResult=null;}
  if(!pageResult){const local=paginateRows(filteredRows,STATE,pageScope,10);pageResult={...local,server:false};}
  const rows=pageResult.rows;
  const total=pageResult.meta.total;
  const legacyOptions=cfg.filterOptions||[];
  const statusUsesLegacy=cfg.filterField==='status';
  const showClear=STATE.search||STATE.filter||STATE.filterDept||STATE.filterStatus;
  const html=`
    <div class="page-header">
      <div><div class="eyebrow">${esc(cfg.title)}</div><h1>${esc(cfg.title)}</h1><p>${esc(cfg.subtitle||'Manage and review HR records.')}</p></div>
      <div class="page-header-actions">${canEdit()?`<button class="btn btn-brass" onclick="openRecordForm('${key}')">${iPlus(15)} ${esc(cfg.addLabel)}</button>`:''}</div>
    </div>
    ${cfg.notice?`<div class="notice notice-soft"><b>Important:</b> ${cfg.notice}</div>`:''}
    <div class="data-toolbar">
      <div class="searchbox">${iSearch(16)}<input id="tbl-search" data-table-search data-search-key="search" placeholder="Search ${esc(cfg.title.toLowerCase())}…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',()=>renderModuleView('${key}'))" onkeydown="if(event.key==='Enter'){event.preventDefault();queueSearchRender(this,'search',()=>renderModuleView('${key}'),0)}" aria-label="Search ${esc(cfg.title)}"></div>
      ${hasDepartment&&deptOptions.length?`<select class="filter-select" aria-label="Filter by department" onchange="STATE.filterDept=this.value;STATE.tablePages={};renderModuleView('${key}')"><option value="">All Departments</option>${deptOptions.map(o=>`<option value="${esc(o)}" ${STATE.filterDept===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`:''}
      ${statusUsesLegacy?`<select class="filter-select" aria-label="Filter ${esc(cfg.filterLabel||'status')}" onchange="STATE.filter=this.value;STATE.tablePages={};renderModuleView('${key}')"><option value="">All ${esc(cfg.filterLabel||'records')}</option>${legacyOptions.map(o=>`<option value="${esc(o)}" ${STATE.filter===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`:''}
      ${hasStatus&&!statusUsesLegacy&&autoStatusOptions.length?`<select class="filter-select" aria-label="Filter by status" onchange="STATE.filterStatus=this.value;STATE.tablePages={};renderModuleView('${key}')"><option value="">All Statuses</option>${autoStatusOptions.map(o=>`<option value="${esc(o)}" ${STATE.filterStatus===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`:''}
      <button class="btn btn-primary btn-sm" onclick="queueSearchRender(document.getElementById('tbl-search'),'search',()=>renderModuleView('${key}'),0)">${iSearch(14)} Search</button>
      ${showClear?`<button class="btn btn-ghost btn-sm" onclick="STATE.search='';STATE.filter='';STATE.filterDept='';STATE.filterStatus='';STATE.tablePages={};renderModuleView('${key}')">Clear</button>`:''}
      <div class="toolbar-spacer"></div>
      ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportModuleCSV('${key}')">${iDownload(14)} Export</button>`:''}
      ${cfg.extraToolbar?cfg.extraToolbar():''}
    </div>
    <div class="table-card">
      <div class="table-card-head"><div class="table-meta"><b>${total}</b> ${total===1?'record':'records'} <span class="table-meta-muted">${showClear?`filtered from ${data.length}`:'in total'}</span></div></div>
      <div class="tablewrap"><table class="data-table" data-server-paginated="true">
        <thead><tr>${cfg.columns.map(c=>`<th>${c.label}</th>`).join('')}<th class="actions-head">Actions</th></tr></thead>
        <tbody>
          ${rows.length?rows.map(r=>`<tr>${cfg.columns.map(c=>`<td>${c.render?c.render(r):esc(r[c.key]??'—')}</td>`).join('')}
            <td><div class="rowactions">${canEdit()?`<button class="iconbtn" title="Edit" onclick="openRecordForm('${key}','${r.id}')">${iEdit(14)}</button><button class="iconbtn" title="Delete" onclick="deleteRecord('${key}','${r.id}')">${iTrash(14)}</button>`:'<span class="small">View only</span>'}</div></td>
          </tr>`).join(''):`<tr><td colspan="${cfg.columns.length+1}"><div class="empty"><b>No matching records</b><span>${showClear?'Try clearing the search/filter or changing the criteria.':`${esc(cfg.addLabel)} to get started.`}</span></div></td></tr>`}
        </tbody>
      </table></div>
      ${total?`<div class="table-pagination-wrap"><div class="table-pagination-meta">${pageResult.meta.start}–${pageResult.meta.end} <span>of ${total} records</span></div>${paginationHTML(pageResult.meta,pageScope,{go:'serverTablePageGo',size:'serverTablePageSize'})}</div>`:''}
    </div>`;
  document.getElementById('content').innerHTML=html;
  requestAnimationFrame(()=>enhanceDataTables());
}
function openRecordForm(key, id){
  const cfg = MODULES[key];
  const existing = id? DB[key].find(r=>r.id===id) : null;
  const fields = cfg.fields.map(f=>{
    const next=f.type==='file'&&existing?{...f,storagePrefix:key,existingData:existing[f.key+'Data']||''}:{...f,storagePrefix:key};
    if(existing&&f.key==='employeeName')next.employeeSelectedId=existing.employeeId||'';
    if(existing&&f.key==='employeeReplaced')next.employeeSelectedId=existing.employeeReplacedId||'';
    return next;
  });
  openModal(`
    <div class="modal-head"><h3>${existing? 'Edit':'Add'} ${cfg.singular}</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="formgrid" id="record-form">
        ${fields.map(f=> fieldHTML(f, existing? existing[f.key] : (f.default? f.default() : ''))).join('')}
      </div>
      ${cfg.computedNote? `<div class="computed-note">${cfg.computedNote}</div>`:''}
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRecord('${key}','${id||''}')">Save Record</button>
    </div>
  `);
}
let CASE_WORKFLOW_CONTEXT = null;

async function linkNewRecordToCase(caseId, module, rec){
  if(!caseId || !rec) return true;
  const label = caseRecordLabel(module, rec);
  const {error} = await supabase.from('hr_case_links').insert({
    case_id:caseId, module, record_id:String(rec.id), label, linked_by:SESSION?.id||null
  });
  if(error){
    toast('Record saved, but it could not be linked to the HR case: '+error.message,true);
    return false;
  }
  const newStatus = module==='nte'?'NTE Issued' : module==='memos'?'Memo Issued' : module==='nod'?'For Decision' : null;
  if(newStatus){
    const {data:beforeCase}=await supabase.from('hr_cases').select('status,due_date').eq('id',caseId).maybeSingle();
    const {error:statusError}=await supabase.from('hr_cases').update({status:newStatus,updated_by:SESSION?.id||null}).eq('id',caseId);
    if(statusError) console.warn('Case status update failed',statusError);
    else await addCaseActivity(caseId,'status',`Status changed from ${beforeCase?.status||'—'} to ${newStatus} after creating ${caseModuleLabel(module)}.`,beforeCase?.status||null,newStatus,beforeCase?.due_date||null);
  }
  await addCaseActivity(caseId,'linked',`Linked ${caseModuleLabel(module)}: ${label}.`);
  logAudit(`Linked ${caseModuleLabel(module)} to HR case`);
  return true;
}

function openWorkflowRecordForm(module, caseId){
  if(SESSION?.role==='Viewer') return;
  CASE_WORKFLOW_CONTEXT = {caseId, module};
  openRecordForm(module);
  supabase.from('hr_cases').select('employee_record_id,employee_name,department,subject').eq('id',caseId).maybeSingle().then(({data,error})=>{
    if(error||!data) return;
    const deptInput=document.getElementById('f_department');
    employeePickerSet('f_employeeName',data.employee_record_id||data.employee_name||'');
    if(deptInput && !deptInput.value) deptInput.value=data.department||'';
    const dateMap={nte:'f_dateIssued',memos:'f_dateOfMemo',nod:'f_dateOfNod'};
    const dateId=dateMap[module]; if(document.getElementById(dateId) && !document.getElementById(dateId).value) document.getElementById(dateId).value=todayISO();
    if(module==='nte'){
      const v=document.getElementById('f_violation'); if(v && !v.value) v.value=data.subject||'';
      const st=document.getElementById('f_status'); if(st && !st.value) st.value='Pending Explanation';
    }
    if(module==='memos'){
      const v=document.getElementById('f_offenseType'); if(v && !v.value) v.value=data.subject||'';
      const d=document.getElementById('f_action'); if(d && !d.value) d.value='';
    }
    if(module==='nod'){
      const v=document.getElementById('f_relatedOffense'); if(v && !v.value) v.value=data.subject||'';
    }
  });
}

async function saveRecord(key, id){
  const cfg = MODULES[key];
  const vals = readFields(cfg.fields);
  const invalidEmployeeFields=cfg.fields.filter(f=>f.employeePicker||f.key==='employeeName'||f.key==='employeeReplaced').filter(f=>{
    const typed=document.getElementById(`f_${f.key}_search`)?.value.trim();
    return typed&&!employeePickerSelected(`f_${f.key}`);
  });
  if(invalidEmployeeFields.length){toast('Select '+invalidEmployeeFields.map(f=>f.label).join(', ')+' from the employee results.',true);return;}
  const missing = cfg.fields.filter(f=>f.required && !vals[f.key]);
  if(missing.length){ toast('Please complete: '+missing.map(f=>f.label).join(', ')); return; }
  let rec;
  let oldStoragePaths=new Set();
  const workflowCaseId = CASE_WORKFLOW_CONTEXT?.module===key ? CASE_WORKFLOW_CONTEXT.caseId : null;
  if(id){
    rec = DB[key].find(r=>r.id===id);
    oldStoragePaths=recordStoragePaths(rec);
    Object.assign(rec, vals);
    logAudit(`Updated ${cfg.singular.toLowerCase()} record for ${vals[cfg.searchFields[0]]||''}`);
    toast(cfg.singular+' updated.');
  } else {
    rec = {id:uid(), ...vals};
    DB[key].push(rec);
    logAudit(`Added new ${cfg.singular.toLowerCase()} record for ${vals[cfg.searchFields[0]]||''}`);
    toast(cfg.singular+' added.');
  }
  await saveDB();
  await workflowSyncTasks({silent:true});
  const newStoragePaths=recordStoragePaths(rec);
  rememberCommittedRecordFiles(rec);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  await closeModal([...newStoragePaths]); renderNav();
  CASE_WORKFLOW_CONTEXT=null;
  if(workflowCaseId && !id){
    await linkNewRecordToCase(workflowCaseId,key,rec);
    await openCaseDetails(workflowCaseId);
  } else {
    RENDERERS[key]? RENDERERS[key]() : renderModuleView(key);
  }
}
async function deleteRecord(key,id){
  const cfg = MODULES[key];
  const old=DB[key].find(r=>r.id===id);
  const storagePaths=recordStoragePaths(old);
  DB[key] = DB[key].filter(r=>r.id!==id);
  logAudit(`Deleted a ${cfg.singular.toLowerCase()} record`);
  await saveDB();
  await deleteStorageObjects(storagePaths);
  renderNav(); RENDERERS[key]? RENDERERS[key]() : renderModuleView(key);
  toast(cfg.singular+' deleted.');
}
function exportModuleCSV(key){
  if(!requireExportAccess())return;
  const cfg = MODULES[key];
  const seen=new Set();
  const cols=[];
  (cfg.fields||[]).forEach(field=>{
    if(seen.has(field.key)) return;
    seen.add(field.key);
    cols.push({label:field.label.replace(/\s*\*\s*$/,''),get:record=>record[field.key]});
  });
  (cfg.columns||[]).forEach(column=>{
    if(seen.has(column.key)&&!column.csv) return;
    seen.add(column.key);
    cols.push({label:column.label,get:column.csv||(record=>record[column.key])});
  });
  ['createdAt','createdByName','updatedAt','updatedByName'].forEach(auditKey=>{
    if(DB[key]?.some(record=>record?.[auditKey])) cols.push({label:({createdAt:'Created At',createdByName:'Created By',updatedAt:'Updated At',updatedByName:'Updated By'})[auditKey],get:record=>record[auditKey]});
  });
  const csv = toCSV(DB[key], cols);
  downloadCSV(key+'_export.csv', csv);
  toast(`Exported ${DB[key].length} complete ${cfg.title.toLowerCase()} records.`);
}

function downloadRecordAttachment(moduleKey, id, fieldKey){
  const rec = DB[moduleKey].find(r=>r.id===id);
  if(!rec) return;
  downloadAttachment(rec[fieldKey+'Data'], rec[fieldKey]);
}
function attachCellHTML(moduleKey, r, fieldKey){
  const name = r[fieldKey];
  const data = r[fieldKey+'Data'];
  if(!name) return '<span class="small">—</span>';
  return `<div class="attach-cell">${iDoc(13)}<span title="${esc(name)}" style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>${data?`<button class="iconbtn" title="Download" onclick="downloadRecordAttachment('${moduleKey}','${r.id}','${fieldKey}')">${iDownload(12)}</button>`:'<span class="small" title="No stored file (demo record or uploaded before this feature)">n/a</span>'}</div>`;
}

/* status badge helper */
function statusBadge(val, map){
  const cls = (map&&map[val]) || 'b-grey';
  return `<span class="badge ${cls}"><span class="dot"></span>${esc(val||'—')}</span>`;
}
const EMP_STATUS_MAP = {'Active':'b-green','AWOL':'b-red','Resigned':'b-grey','Transferred to Another Department':'b-blue','Separated':'b-red','Returned to Agency':'b-amber','Newly Hired':'b-blue'};
const LEAVE_STATUS_MAP = {'Pending':'b-amber','Approved':'b-blue','Ongoing':'b-green','Completed':'b-grey','Disapproved':'b-red'};
const NTE_STATUS_MAP = {'Pending Explanation':'b-amber','Explanation Submitted':'b-blue','Under Review':'b-blue','Resolved':'b-green'};
const ONCALL_STATUS_MAP = {'Active':'b-green','Completed':'b-grey','Cancelled':'b-red'};

/* ================================================================
   PHASE 10 — EMPLOYEE LIFECYCLE
   ================================================================ */
const LIFECYCLE_EVENT_TYPES = [
  'Onboarding Completed','Probation Started','30-Day Review','90-Day Review','Regularization',
  'Promotion / Position Change','Return to Work','Resignation','Separation','AWOL / Leave of Absence',
  'Rehire / Return to Agency','Other'
];
const LIFECYCLE_EVENT_STATUS = {
  'Resignation':'Resigned',
  'Separation':'Separated',
  'AWOL / Leave of Absence':'AWOL',
  'Return to Work':'Active',
  'Rehire / Return to Agency':'Returned to Agency',
  'Regularization':'Active'
};
function lifecycleInitials(emp){ return (emp?.name||'Employee').split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
function lifecycleDaysSince(dateStr){ if(!dateStr) return null; const d=new Date(dateStr+'T00:00:00'); if(isNaN(d)) return null; return Math.max(0,Math.floor((new Date()-d)/86400000)); }
function lifecycleMilestoneStatus(emp, milestone){
  const rec=getEvalRecord(emp.id,milestone.key);
  const due=evalDueDate(emp.dateHired,milestone.days);
  if(rec?.completedDate) return {label:'Completed',cls:'b-green',due,completed:rec.completedDate};
  if(due<todayISO()) return {label:'Overdue',cls:'b-red',due};
  if(due<=addDaysISO(todayISO(),14)) return {label:'Due Soon',cls:'b-amber',due};
  return {label:'Upcoming',cls:'b-grey',due};
}
function lifecycleNextMilestone(emp){
  if(!emp?.dateHired) return null;
  if(['Resigned','Separated'].includes(emp.status)) return {label:emp.status,date:emp.statusDate||'',state:'Complete'};
  if(emp.status==='Returned to Agency') return {label:'Returned to Agency',date:emp.statusDate||'',state:'Complete'};
  if(classify(emp)!=='Probationary') return {label:'Regularized',date:emp.statusDate||'',state:'Complete'};
  for(const m of EVAL_MILESTONES){
    const st=lifecycleMilestoneStatus(emp,m);
    if(st.label!=='Completed') return {label:m.label,date:st.due,state:st.label};
  }
  return {label:'6th Month Review',date:evalDueDate(emp.dateHired,180),state:'Completed'};
}
function lifecycleRecentEvents(limit=12){
  const cutoff=addDaysISO(todayISO(),-90);
  const events=[];
  (DB.employees||[]).forEach(emp=>{
    (Array.isArray(emp.employmentHistory)?emp.employmentHistory:[]).forEach(h=>{
      events.push({employee:emp,date:h.effectiveDate||String(h.changedAt||'').slice(0,10),type:h.eventType||h.type||'Employment Status',title:h.eventType||`${h.from||'Initial'}${h.from?' → ':''}${h.to||'—'}`,meta:h.remarks||'',changedBy:h.changedBy||'System'});
    });
  });
  (DB.transfers||[]).forEach(t=>events.push({employeeName:t.employeeName,date:t.toDate,type:'Department Transfer',title:`${t.fromDepartment} → ${t.toDepartment}`,meta:t.remarks||'',changedBy:'HR'}));
  return events.filter(e=>e.date && e.date>=cutoff && e.date<=todayISO()).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,limit);
}
function openEmployeeLifecycleEventForm(id){
  if(!canEdit()) return;
  const existingEmp=id?DB.employees.find(e=>e.id===id):null;
  if(id&&!existingEmp){toast('Employee record could not be found.',true);return;}
  if(existingEmp) selectEmployeeDirectoryRow(existingEmp.id);
  openEmployeeWorkspaceModal(`
    ${existingEmp?employeeWorkspaceHeader(existingEmp,'Lifecycle Event'):`<div class="modal-head employee-workspace-head"><div><div class="employee-workspace-breadcrumb"><span>Employment Lifecycle</span><span>›</span><b>Record Event</b></div><h3>Record Employment Lifecycle Event</h3><div class="small">Add a verified employment milestone or status event.</div></div><button type="button" onclick="closeModal()" aria-label="Close lifecycle form">&times;</button></div>`}
    <div class="modal-body">
      ${existingEmp?employeeWorkspaceNav(existingEmp,'lifecycle'):''}
      <div class="formgrid">
        ${existingEmp?`<div class="field full"><label>Employee</label><input value="${esc(employeeDisplayName(existingEmp))}" disabled><input type="hidden" id="lc_employee" value="${esc(existingEmp.id)}"></div>`:employeePickerHTML({id:'lc_employee',label:'Employee',selectedId:'',required:true,full:true,onSelect:'lifecycleEmployeePreview'})}
        <div class="field"><label>Event Type *</label><select id="lc_eventType" onchange="lifecycleEventTypeChanged()">${LIFECYCLE_EVENT_TYPES.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>
        <div class="field"><label>Effective Date *</label><input type="date" id="lc_date" value="${todayISO()}"></div>
        <div class="field" id="lc_position_wrap" style="display:none"><label>New Position</label><input id="lc_position" placeholder="e.g. HR Officer II"></div>
        <div class="field full"><label>Remarks / HR Reference</label><textarea id="lc_remarks" rows="3" placeholder="Reference, reason, approving authority, or other HR note…"></textarea></div>
      </div>
      <div id="lc_preview" class="lifecycle-helper">Select an employee to see the current employment state.</div>
    </div>
    ${existingEmp?employeeWorkspaceFooter(existingEmp,'Save Lifecycle Event','saveEmployeeLifecycleEvent()'):`<div class="modal-foot employee-workspace-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><div class="toolbar-spacer"></div><button class="btn btn-primary" onclick="saveEmployeeLifecycleEvent()">Save Lifecycle Event</button></div>`}
  `);
  lifecycleEventTypeChanged(); lifecycleEmployeePreview();
}
function lifecycleEventTypeChanged(){
  const type=document.getElementById('lc_eventType')?.value;
  const wrap=document.getElementById('lc_position_wrap');
  if(wrap) wrap.style.display=type==='Promotion / Position Change'?'block':'none';
  const preview=document.getElementById('lc_preview');
  if(preview && type==='Regularization') preview.textContent='This event will mark the employee as Active and set Classification to Regular.';
  else if(preview && type==='Resignation') preview.textContent='This event will set Employment Status to Resigned.';
  else if(preview && type==='Separation') preview.textContent='This event will set Employment Status to Separated.';
  else if(preview && type==='AWOL / Leave of Absence') preview.textContent='This event will set Employment Status to AWOL. Record any separate leave documentation in Leave Tracker.';
  else if(preview && type==='Return to Work') preview.textContent='This event will set Employment Status to Active.';
  else if(preview && type==='Rehire / Return to Agency') preview.textContent='This event will set Employment Status to Returned to Agency.';
}
function lifecycleEmployeePreview(){
  const id=document.getElementById('lc_employee')?.value; const emp=DB.employees.find(e=>e.id===id); const preview=document.getElementById('lc_preview');
  if(!preview) return;
  if(!emp){ preview.textContent='Select an employee to see the current employment state.'; return; }
  const next=lifecycleNextMilestone(emp);
  preview.innerHTML=`Current: <b>${esc(emp.status||'—')}</b> · ${esc(emp.position||'—')} · ${esc(emp.department||'—')}${next?` · Next milestone: <b>${esc(next.label)}</b>${next.date?' due '+fmtDate(next.date):''}`:''}`;
}
async function saveEmployeeLifecycleEvent(){
  if(!canEdit()) return;
  const id=document.getElementById('lc_employee').value;
  const eventType=document.getElementById('lc_eventType').value;
  const effectiveDate=document.getElementById('lc_date').value;
  const remarks=document.getElementById('lc_remarks').value.trim();
  const newPosition=document.getElementById('lc_position')?.value.trim()||'';
  const emp=DB.employees.find(e=>e.id===id);
  if(!emp||!eventType||!effectiveDate){ toast('Please complete employee, event type, and effective date.'); return; }
  if(effectiveDate<emp.dateHired){ toast('Lifecycle event date cannot be before Date Hired.'); return; }
  if(effectiveDate>todayISO()){ toast('Lifecycle event date cannot be in the future.'); return; }
  if(eventType==='Promotion / Position Change' && !newPosition){ toast('Enter the new position for a promotion or position change.'); return; }
  const original=JSON.parse(JSON.stringify(emp));
  const fromStatus=emp.status||''; const fromPosition=emp.position||''; const fromDepartment=emp.department||'';
  let toStatus=fromStatus; let toPosition=fromPosition;
  if(LIFECYCLE_EVENT_STATUS[eventType]) toStatus=LIFECYCLE_EVENT_STATUS[eventType];
  if(eventType==='Regularization'){ emp.classOverride='Regular'; }
  if(eventType==='Promotion / Position Change'){ emp.position=newPosition; toPosition=newPosition; }
  if(toStatus!==fromStatus){ emp.status=toStatus; emp.statusDate=effectiveDate; }
  if(!Array.isArray(emp.employmentHistory)) emp.employmentHistory=[];
  emp.employmentHistory.push({
    type:'Lifecycle Event',eventType,from:fromStatus,to:emp.status||fromStatus,fromPosition,toPosition,fromDepartment,toDepartment:emp.department||fromDepartment,
    effectiveDate,remarks,changedAt:new Date().toISOString(),changedBy:SESSION?.fullName||'System'
  });
  appendEmployeeRecordHistory(emp,'Lifecycle',eventType);
  if(!(await saveDB())){Object.keys(emp).forEach(key=>delete emp[key]);Object.assign(emp,original);return;}
  logAudit(`Recorded employment lifecycle event for ${employeeDisplayName(emp)}: ${eventType}`);
  await closeModal(); renderNav();
  await renderEmployeeOrigin();
  selectEmployeeDirectoryRow(id);
  await openEmployeeProfile(id);
  toast('Employment lifecycle event recorded.');
}
function renderEmployeeLifecycle(){
  setTitle('Employment Lifecycle','Track onboarding, probation, regularization, movement, and separation across the workforce.');
  const q=(STATE.lifecycleSearch||'').toLowerCase();
  const f=STATE.lifecycleFilter||'';
  const employees=(DB.employees||[]).filter(e=>{
    const hay=[e.employeeNo,e.name,e.position,e.department,e.status].map(v=>String(v||'').toLowerCase());
    const searchOk=!q||hay.some(v=>v.includes(q));
    const filterOk=!f||(f==='Probationary' ? classify(e)==='Probationary' : f==='Regular' ? classify(e)==='Regular' : e.status===f);
    return searchOk&&filterOk;
  }).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const ninetyAgo=addDaysISO(todayISO(),-90);
  const recentHires=DB.employees.filter(e=>e.dateHired>=ninetyAgo&&e.dateHired<=todayISO()).length;
  const probationary=DB.employees.filter(e=>classify(e)==='Probationary').length;
  const regular=DB.employees.filter(e=>classify(e)==='Regular').length;
  const separations=DB.employees.filter(e=>['Resigned','Separated'].includes(e.status)&&String(e.statusDate||'')>=ninetyAgo).length;
  const transfers90=DB.transfers.filter(t=>String(t.toDate||'')>=ninetyAgo&&String(t.toDate||'')<=todayISO()).length;
  const overdue=DB.employees.filter(e=>classify(e)==='Probationary'&&EVAL_MILESTONES.some(m=>evalStatusInfo(e,m).label==='Overdue')).length;
  const events=lifecycleRecentEvents(10);
  const probationRows=DB.employees.filter(e=>classify(e)==='Probationary'&&e.dateHired).slice().sort((a,b)=>{
    const an=lifecycleNextMilestone(a)?.date||'9999', bn=lifecycleNextMilestone(b)?.date||'9999'; return an.localeCompare(bn);
  }).slice(0,8);
  const filterOptions=['Probationary','Regular',...EMP_STATUS];
  document.getElementById('content').innerHTML=`
    <div class="sectionhead"><div><h2>Employment Lifecycle</h2><p>${employees.length} of ${DB.employees.length} employees shown. Record actual milestones and employment events without changing the underlying HR case history.</p></div>${canEdit()?`<button class="btn btn-brass" onclick="openEmployeeLifecycleEventForm()">${iPlus(15)} Record Lifecycle Event</button>`:''}</div>
    <div class="lifecycle-kpis">
      <div class="lifecycle-kpi" style="--accent:var(--ink)"><div class="k">Workforce</div><div class="v">${DB.employees.length}</div><div class="s">Total employees</div></div>
      <div class="lifecycle-kpi" style="--accent:var(--amber)"><div class="k">Probationary</div><div class="v">${probationary}</div><div class="s">Currently in probation</div></div>
      <div class="lifecycle-kpi" style="--accent:var(--forest)"><div class="k">Regular</div><div class="v">${regular}</div><div class="s">Regular classification</div></div>
      <div class="lifecycle-kpi" style="--accent:var(--brass)"><div class="k">New Hires · 90d</div><div class="v">${recentHires}</div><div class="s">Date Hired</div></div>
      <div class="lifecycle-kpi" style="--accent:var(--ink)"><div class="k">Transfers · 90d</div><div class="v">${transfers90}</div><div class="s">Recorded movements</div></div>
      <div class="lifecycle-kpi" style="--accent:${overdue?'var(--rust)':'var(--forest)'}"><div class="k">Overdue Reviews</div><div class="v">${overdue}</div><div class="s">Probation milestones</div></div>
    </div>
    <div class="toolbar">
      <div class="search">${iSearch(15)}<input data-search-key="lifecycleSearch" placeholder="Search employee, no., position, department…" value="${esc(STATE.lifecycleSearch)}" oninput="queueSearchRender(this,'lifecycleSearch',renderEmployeeLifecycle)"></div>
      <select onchange="STATE.lifecycleFilter=this.value; renderEmployeeLifecycle()"><option value="">All Lifecycle States</option>${filterOptions.filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option value="${esc(v)}" ${STATE.lifecycleFilter===v?'selected':''}>${esc(v)}</option>`).join('')}</select>
      <div class="spacer"></div>
    </div>
    <div class="lifecycle-grid">
      <div class="panel"><div class="dashboard-panel-head"><div><h3>Probation Pipeline</h3><div class="desc">Upcoming and overdue milestones for employees still classified as probationary.</div></div><button class="btn btn-ghost btn-sm" onclick="go('evaluations')">Open Evaluations →</button></div>
        ${probationRows.length?`<div class="lifecycle-list">${probationRows.map(e=>{const n=lifecycleNextMilestone(e);const st=EVAL_MILESTONES.find(m=>m.label===n?.label);return `<div class="lifecycle-row"><div class="avatar">${lifecycleInitials(e)}</div><div class="main"><div class="title">${esc(e.employeeNo||'—')} · ${esc(employeeDisplayName(e))}</div><div class="meta">${esc(e.position||'—')} · ${esc(e.department||'—')} · ${esc(employeeTenureText(e))}</div><div class="lifecycle-milestones" style="margin-top:7px;">${st?EVAL_MILESTONES.map(m=>{const x=lifecycleMilestoneStatus(e,m);return `<div class="lifecycle-milestone"><div class="label">${esc(m.label)}</div><div class="date">${fmtDate(x.due)}</div><div class="meta">${statusBadge(x.label,{[x.label]:x.cls})}</div></div>`}).join(''):''}</div></div><div class="right"><button class="btn btn-ghost btn-sm" onclick="openEmployeeProfile('${e.id}')">Profile</button>${canEdit()?`<div style="margin-top:5px;"><button class="btn btn-ghost btn-sm" onclick="openEmployeeLifecycleEventForm('${e.id}')">Event</button></div>`:''}<div class="date">${n?.label||''}${n?.date?' · '+fmtDate(n.date):''}</div></div></div>`;}).join('')}</div>`:'<div class="empty"><b>No probationary employees</b>There are no employees currently classified as probationary.</div>'}
      </div>
      <div class="panel"><div class="dashboard-panel-head"><div><h3>Workforce Movement · 90 Days</h3><div class="desc">Recent employee lifecycle changes and department transfers.</div></div></div>
        <div class="lifecycle-event-list">${events.length?events.slice(0,8).map(e=>`<div class="lifecycle-event"><div class="date">${fmtDate(e.date)}</div><div class="body"><div class="title">${esc(e.employeeName||e.employee||'Employee')} · ${esc(e.type)}</div><div class="meta">${esc(e.title||'')} ${e.meta?'· '+esc(e.meta):''}</div></div><div class="right">${statusBadge(e.type==='Department Transfer'?'Transfer':(e.to||''),{})}</div></div>`).join(''):'<div class="empty"><b>No recent movement</b>Lifecycle and transfer events will appear here.</div>'}</div>
        <div class="lifecycle-helper">Status-changing events are recorded in the employee employment history. Department transfers should continue to use the dedicated Transfer workflow so the transfer record and current department remain synchronized.</div>
      </div>
    </div>
    <div class="panel"><div class="dashboard-panel-head"><div><h3>Employee Lifecycle Directory</h3><div class="desc">One operational view of current employment state, tenure, and next milestone.</div></div><div class="small">${separations} recent separation(s) in the last 90 days</div></div>
      <div class="tablewrap"><table class="data-table"><thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>Classification</th><th>Date Hired</th><th>Tenure</th><th>Next Milestone</th><th style="text-align:right;">Actions</th></tr></thead><tbody>
      ${employees.length?employees.map(e=>{const n=lifecycleNextMilestone(e);return `<tr><td><b>${esc(e.employeeNo||'—')}</b><div>${esc(employeeDisplayName(e))}</div><div class="small">${esc(e.position||'—')}</div></td><td>${esc(e.department||'—')}</td><td>${statusBadge(e.status,EMP_STATUS_MAP)}</td><td>${statusBadge(classify(e),classify(e)==='Regular'?{'Regular':'b-green'}:{'Probationary':'b-amber'})}</td><td>${fmtDate(e.dateHired)}</td><td>${esc(employeeTenureText(e))}</td><td>${n?`${esc(n.label)}${n.date?`<div class="small">${fmtDate(n.date)}</div>`:''}`:'—'}</td><td><div class="rowactions"><button class="iconbtn" title="Profile" onclick="openEmployeeProfile('${e.id}')">${iUser(14)}</button>${canEdit()?`<button class="iconbtn" title="Lifecycle Event" onclick="openEmployeeLifecycleEventForm('${e.id}')">${iPlus(14)}</button>`:''}</div></td></tr>`;}).join(''):`<tr><td colspan="8"><div class="empty"><b>No employees found</b>Try a different search or lifecycle filter.</div></td></tr>`}
      </tbody></table></div>
    </div>`;
}

/* ================================================================
   EMPLOYEES (custom view — has classification logic)
   ================================================================ */
const ONBOARDING_IDENTITY_FIELDS=[
  {key:'lastName',label:'Last Name',type:'text',required:true},
  {key:'firstName',label:'First Name',type:'text',required:true},
  {key:'middleName',label:'Middle Name',type:'text'},
  {key:'suffix',label:'Suffix',type:'text'},
  {key:'birthDate',label:'Birth Date',type:'date'},
  {key:'gender',label:'Gender',type:'select',options:['','Male','Female']},
  {key:'civilStatus',label:'Civil Status',type:'select',options:['','Single','Married','Widowed','Separated','Other']},
  {key:'mobileNumber',label:'Mobile Number',type:'tel',required:true},
  {key:'personalEmail',label:'Personal Email',type:'email'},
  {key:'address',label:'Home Address',type:'text',full:true},
];
const ONBOARDING_APPLICATION_FIELDS=[
  {key:'department',label:'Department',type:'select',options:employeeDepartmentNames,placeholder:'Select department',required:true,onchange:"syncPositionSelect('f_positionApplied',this.value)",catalog:'department',catalogPositionId:'f_positionApplied'},
  {key:'positionApplied',label:'Position Applied For',type:'select',options:()=>employeePositionNames(),placeholder:'Select position',required:true,catalog:'position',catalogDepartmentId:'f_department'},
  {key:'applicationDate',label:'Application Date',type:'date',required:true},
  {key:'source',label:'Application Source',type:'select',options:['Walk-in','Referral','Online Job Board','Social Media','Job Fair','Agency','Other']},
  {key:'stage',label:'Hiring Stage',type:'select',options:ONBOARDING_STAGES,required:true},
  {key:'resume',label:'Resume / Application Form',type:'file',full:true,storagePrefix:'onboarding'},
];
const ONBOARDING_EVALUATION_FIELDS=[
  {key:'interviewDate',label:'Interview Date',type:'date'},
  {key:'interviewer',label:'Interviewer / Panel',type:'text'},
  {key:'experienceScore',label:'Experience Score (1-5)',type:'number'},
  {key:'competencyScore',label:'Competency Score (1-5)',type:'number'},
  {key:'communicationScore',label:'Communication Score (1-5)',type:'number'},
  {key:'cultureScore',label:'Values / Culture Score (1-5)',type:'number'},
  {key:'recommendation',label:'Recommendation',type:'select',options:ONBOARDING_RECOMMENDATIONS,required:true},
  {key:'evaluationNotes',label:'Evaluation Notes',type:'textarea'},
];
const ONBOARDING_OFFER_FIELDS=[
  {key:'prfNumber',label:'PRF Number (optional)',type:'text'},
  {key:'proposedStartDate',label:'Proposed Start Date',type:'date'},
  {key:'employmentType',label:'Employment Type',type:'select',options:['Probationary','Regular','Project-based','Fixed-term','Part-time']},
  {key:'offeredSalary',label:'Offered Monthly Salary',type:'number'},
  {key:'tin',label:'BIR TIN',type:'text',format:'tin'},
  {key:'sssNumber',label:'SSS Number',type:'text',format:'sss'},
  {key:'philHealthNumber',label:'PhilHealth PIN',type:'text',format:'philHealth'},
  {key:'pagIbigNumber',label:'Pag-IBIG MID',type:'text',format:'pagIbig'},
  {key:'preEmploymentDocs',label:'Combined Pre-employment Documents',type:'file',full:true,storagePrefix:'onboarding'},
  {key:'remarks',label:'HR Remarks',type:'textarea'},
];
const ONBOARDING_FIELDS=[...ONBOARDING_IDENTITY_FIELDS,...ONBOARDING_APPLICATION_FIELDS,...ONBOARDING_EVALUATION_FIELDS,...ONBOARDING_OFFER_FIELDS];
function onboardingOpenCount(){ return (DB.onboardingCandidates||[]).filter(c=>!['Hired','Rejected','Withdrawn'].includes(c.stage)).length; }
function candidateDisplayName(candidate){ return formatEmployeeName(candidate); }
function onboardingApplicantReference(candidate={}){
  if(candidate.applicantReference) return candidate.applicantReference;
  const seed=String(candidate.id||uid()).replace(/[^a-zA-Z0-9]/g,'').slice(0,10).toUpperCase();
  return `APP-${seed}`;
}
function onboardingChecklist(candidate={}){ return candidate?.checklist&&typeof candidate.checklist==='object'?candidate.checklist:{}; }
function onboardingReadiness(candidate){
  const checks=onboardingChecklist(candidate);
  const completed=ONBOARDING_CHECKLIST.filter(item=>checks[item.key]).length;
  return {completed,total:ONBOARDING_CHECKLIST.length,percent:Math.round((completed/ONBOARDING_CHECKLIST.length)*100)};
}
function onboardingAverageScore(candidate){
  const values=['experienceScore','competencyScore','communicationScore','cultureScore'].map(key=>Number(candidate[key])).filter(value=>value>=1&&value<=5);
  return values.length?Math.round((values.reduce((sum,value)=>sum+value,0)/values.length)*10)/10:null;
}
function onboardingHireBlockers(candidate){
  const checks=onboardingChecklist(candidate);
  const blockers=[];
  if(candidate.stage!=='Ready to Hire') blockers.push('stage must be Ready to Hire');
  if(candidate.recommendation!=='Hire') blockers.push('recommendation must be Hire');
  [['privacyNotice','privacy notice'],['interview','interview evaluation'],['offer','accepted offer'],['contract','signed contract'],['standards','probationary standards acknowledgment']].forEach(([key,label])=>{if(!checks[key])blockers.push(label);});
  if(!candidate.proposedStartDate) blockers.push('proposed start date');
  if(!candidate.birthDate) blockers.push('birth date');
  if(!candidate.gender) blockers.push('gender');
  return blockers;
}
function onboardingFieldValue(candidate,field){
  if(!candidate) return field.key==='applicationDate'?todayISO():field.key==='stage'?'Applicant':field.key==='recommendation'?'Pending':'';
  return candidate[field.key]??'';
}
function onboardingSection(title,description,fields,candidate){
  return `<section class="onboarding-form-section"><div class="onboarding-form-heading"><h4>${esc(title)}</h4><p>${esc(description)}</p></div><div class="formgrid">${fields.map(field=>{
    const value=onboardingFieldValue(candidate,field);
    if(field.key==='department')return fieldHTML({...field,options:()=>employeeDepartmentNames(value)},value);
    if(field.key==='positionApplied')return fieldHTML({...field,options:()=>employeePositionNames(candidate?.department||'',value)},value);
    return fieldHTML(field,value);
  }).join('')}</div></section>`;
}
function onboardingChecklistHTML(candidate={}){
  const checks=onboardingChecklist(candidate);
  return `<div class="onboarding-check-grid">${ONBOARDING_CHECKLIST.map(item=>`<label class="onboarding-check"><input type="checkbox" data-onboarding-check="${esc(item.key)}" ${checks[item.key]?'checked':''}><span><b>${esc(item.label)}</b><small>${esc(item.group)}</small></span></label>`).join('')}</div>`;
}
function openOnboardingForm(id=''){
  const candidate=id?(DB.onboardingCandidates||[]).find(row=>row.id===id):null;
  const applicantReference=onboardingApplicantReference(candidate||{});
  const record=candidate?{...candidate,...splitEmployeeName(candidate)}:null;
  const fields=ONBOARDING_FIELDS.map(field=>field.type==='file'&&candidate?{...field,existingData:candidate[field.key+'Data']||''}:field);
  const byKey=keys=>fields.filter(field=>keys.includes(field.key));
  openModal(`
    <div class="modal-head"><div><h3>${candidate?'Edit Applicant':'Add Applicant'}</h3><div class="small">Applicant record · ${candidate?esc(candidateDisplayName(record)):'pre-employment intake'}</div></div><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body onboarding-modal-body">
      <span hidden data-upload-record-id="${esc(applicantReference)}"></span>
      ${onboardingSection('Personal and contact','Use separate name fields; the system displays Last Name, First Name Middle Name.',byKey(ONBOARDING_IDENTITY_FIELDS.map(f=>f.key)),record)}
      ${onboardingSection('Application','Position, source, and current recruitment stage.',byKey(ONBOARDING_APPLICATION_FIELDS.map(f=>f.key)),record)}
      ${onboardingSection('Evaluation','Use consistent 1-5 scores and retain the hiring rationale.',byKey(ONBOARDING_EVALUATION_FIELDS.map(f=>f.key)),record)}
      ${onboardingSection('Offer and statutory details','Government identifiers are optional until available, but validated when entered.',byKey(ONBOARDING_OFFER_FIELDS.map(f=>f.key)),record)}
      <section class="onboarding-form-section"><div class="onboarding-form-heading"><h4>Onboarding readiness</h4><p>Track evidence and required handoffs before activation.</p></div>${onboardingChecklistHTML(candidate)}</section>
      <div class="computed-note">Collect only information necessary for recruitment and employment, keep access restricted, and verify current agency requirements before submission.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveOnboardingCandidate('${esc(id)}')">Save Applicant</button></div>
  `);
}
async function saveOnboardingCandidate(id=''){
  const values=readFields(ONBOARDING_FIELDS);
  values.applicantReference=document.querySelector('[data-upload-record-id]')?.dataset.uploadRecordId||onboardingApplicantReference();
  const missing=ONBOARDING_FIELDS.filter(field=>field.required&&!values[field.key]);
  if(missing.length){toast('Please complete: '+missing.map(field=>field.label).join(', '));return;}
  const existingCandidate=id?DB.onboardingCandidates.find(row=>row.id===id):null;
  const validDepartment=departmentCatalog().some(item=>item.name===values.department&&(item.active||existingCandidate?.department===values.department));
  const validPosition=positionCatalog().some(item=>item.name===values.positionApplied&&item.department===values.department&&(item.active||(existingCandidate?.department===values.department&&existingCandidate?.positionApplied===values.positionApplied)));
  if(!validDepartment||!validPosition){toast('Select an active department and a position configured for that department.',true);return;}
  values.name=formatEmployeeName(values);
  if(values.birthDate&&values.birthDate>todayISO()){toast('Birth Date cannot be in the future.',true);return;}
  if(values.personalEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.personalEmail)){toast('Enter a valid personal email address.',true);return;}
  for(const key of ['experienceScore','competencyScore','communicationScore','cultureScore']){
    if(values[key]&&(Number(values[key])<1||Number(values[key])>5)){toast('Evaluation scores must be from 1 to 5.',true);return;}
  }
  const idError=validateGovernmentIds(values); if(idError){toast(idError,true);return;}
  const checklist={}; document.querySelectorAll('[data-onboarding-check]').forEach(input=>checklist[input.dataset.onboardingCheck]=input.checked);
  const existing=existingCandidate;
  const isNew=!existing;
  const record=existing||{id:uid(),createdAt:new Date().toISOString(),createdBy:SESSION?.id||null};
  const original=existing?JSON.parse(JSON.stringify(existing)):null;
  const oldStoragePaths=recordStoragePaths(existing);
  Object.assign(record,values,{checklist,updatedAt:new Date().toISOString()});
  if(isNew) DB.onboardingCandidates.push(record);
  if(!(await saveDB())){
    if(isNew) DB.onboardingCandidates=DB.onboardingCandidates.filter(row=>row!==record);
    else {Object.keys(record).forEach(key=>delete record[key]);Object.assign(record,original);}
    return;
  }
  logAudit(`${isNew?'Added':'Updated'} applicant record: ${record.name}`);
  const newStoragePaths=recordStoragePaths(record);rememberCommittedRecordFiles(record);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  await closeModal([...newStoragePaths]);renderNav();renderOnboarding();toast(isNew?'Applicant added.':'Applicant updated.');
}
function renderOnboarding(){
  const records=DB.onboardingCandidates||[];
  const query=String(STATE.onboardingSearch||'').trim().toLowerCase();
  const stage=STATE.onboardingStage||'';
  const rows=records.filter(candidate=>(!query||[candidate.name,candidateDisplayName(candidate),candidate.positionApplied,candidate.department,candidate.mobileNumber,candidate.personalEmail,candidate.prfNumber].some(value=>String(value||'').toLowerCase().includes(query)))&&(!stage||candidate.stage===stage)).sort((a,b)=>String(b.applicationDate||b.createdAt||'').localeCompare(String(a.applicationDate||a.createdAt||'')));
  const ready=records.filter(candidate=>candidate.stage==='Ready to Hire').length;
  const inProgress=records.filter(candidate=>!['Ready to Hire','Hired','Rejected','Withdrawn'].includes(candidate.stage)).length;
  setTitle('Onboarding & Applicants',`${records.length} candidate${records.length===1?'':'s'} · ${ready} ready to hire`);
  document.getElementById('content').innerHTML=`
    <div class="onboarding-summary"><div><span>Active pipeline</span><b>${inProgress}</b></div><div><span>Ready to hire</span><b>${ready}</b></div><div><span>Hired</span><b>${records.filter(candidate=>candidate.stage==='Hired').length}</b></div><div><span>Needs documents</span><b>${records.filter(candidate=>!['Hired','Rejected','Withdrawn'].includes(candidate.stage)&&onboardingReadiness(candidate).percent<100).length}</b></div></div>
    <div class="data-toolbar onboarding-toolbar">
      <div class="searchbox">${iSearch(15)}<input data-search-key="onboardingSearch" type="search" autocomplete="off" placeholder="Search applicant, position, PRF, or contact…" value="${esc(STATE.onboardingSearch||'')}" oninput="queueSearchRender(this,'onboardingSearch',renderOnboarding)"></div>
      <select aria-label="Filter applicants by stage" onchange="STATE.onboardingStage=this.value;STATE.tablePages={};renderOnboarding()"><option value="">All stages</option>${ONBOARDING_STAGES.map(value=>`<option value="${esc(value)}" ${stage===value?'selected':''}>${esc(value)}</option>`).join('')}</select>
      ${query||stage?`<button class="btn btn-ghost btn-sm" onclick="STATE.onboardingSearch='';STATE.onboardingStage='';STATE.tablePages={};renderOnboarding()">Clear</button>`:''}
      <div class="toolbar-spacer"></div><button class="btn btn-ghost btn-sm" onclick="openEmployeeForm()">${iUser(14)} Direct Hire</button><button class="btn btn-primary btn-sm" onclick="openOnboardingForm()">${iPlus(14)} Add Applicant</button>
    </div>
    <div class="table-card"><div class="table-card-head"><div class="table-meta"><b>${rows.length}</b> candidates <span class="table-meta-muted">${rows.length===records.length?'in the pipeline':`filtered from ${records.length}`}</span></div></div><div class="tablewrap"><table class="data-table onboarding-table"><thead><tr><th>Applicant</th><th>Position</th><th>Applied</th><th>Stage</th><th>Evaluation</th><th>Readiness</th><th class="actions-head">Actions</th></tr></thead><tbody>${rows.length?rows.map(candidate=>{
      const score=onboardingAverageScore(candidate),readiness=onboardingReadiness(candidate),blockers=onboardingHireBlockers(candidate);
      return `<tr><td><b>${esc(candidateDisplayName(candidate))}</b><div class="small">${esc(candidate.mobileNumber||candidate.personalEmail||'No contact')}</div></td><td>${esc(candidate.positionApplied||'—')}<div class="small">${esc(candidate.department||'—')}</div></td><td>${fmtDate(candidate.applicationDate)}</td><td>${statusBadge(candidate.stage||'Applicant',ONBOARDING_STAGE_MAP)}</td><td><b>${score?`${score}/5`:'—'}</b><div class="small">${esc(candidate.recommendation||'Pending')}</div></td><td><div class="readiness-cell"><span><b>${readiness.percent}%</b> ${readiness.completed}/${readiness.total}</span><div><i style="width:${readiness.percent}%"></i></div></div></td><td><div class="rowactions"><button class="iconbtn" title="View applicant" onclick="openOnboardingDetails('${candidate.id}')">${iUser(14)}</button>${canEdit()?`<button class="iconbtn" title="Edit applicant" onclick="openOnboardingForm('${candidate.id}')">${iEdit(14)}</button>${candidate.stage!=='Hired'?`<button class="iconbtn" title="${blockers.length?'Review hiring requirements':'Convert to employee'}" onclick="openOnboardingHire('${candidate.id}')">${iCheck(14)}</button>`:''}`:''}</div></td></tr>`;
    }).join(''):`<tr><td colspan="7"><div class="empty"><b>No applicants found</b><span>${query||stage?'Clear the current search or stage filter.':'Add an applicant or use Direct Hire for an immediate employee record.'}</span></div></td></tr>`}</tbody></table></div></div>`;
  requestAnimationFrame(()=>enhanceDataTables());
}
function openOnboardingDetails(id){
  const candidate=DB.onboardingCandidates.find(row=>row.id===id);if(!candidate)return;
  const score=onboardingAverageScore(candidate),readiness=onboardingReadiness(candidate),checks=onboardingChecklist(candidate),blockers=onboardingHireBlockers(candidate);
  openModal(`<div class="modal-head"><div><h3>${esc(candidateDisplayName(candidate))}</h3><div class="small">${esc(candidate.positionApplied||'Applicant')} · ${esc(candidate.department||'Unassigned')}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="onboarding-detail-grid"><div><span>Stage</span>${statusBadge(candidate.stage||'Applicant',ONBOARDING_STAGE_MAP)}</div><div><span>Recommendation</span><b>${esc(candidate.recommendation||'Pending')}</b></div><div><span>Evaluation</span><b>${score?`${score}/5`:'Not scored'}</b></div><div><span>Readiness</span><b>${readiness.percent}%</b></div><div><span>PRF Number</span><b>${esc(candidate.prfNumber||'—')}</b></div><div><span>Proposed Start</span><b>${fmtDate(candidate.proposedStartDate)}</b></div></div><div class="onboarding-check-grid review">${ONBOARDING_CHECKLIST.map(item=>`<div class="onboarding-check ${checks[item.key]?'done':''}"><span class="checkmark">${checks[item.key]?'✓':'–'}</span><span><b>${esc(item.label)}</b><small>${esc(item.group)}</small></span></div>`).join('')}</div>${blockers.length&&candidate.stage!=='Hired'?`<div class="notice notice-soft"><b>Before conversion:</b> ${esc(blockers.join(', '))}.</div>`:''}</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Close</button>${canEdit()?`<button class="btn btn-ghost" onclick="openOnboardingForm('${candidate.id}')">Edit</button>${candidate.stage!=='Hired'?`<button class="btn btn-primary" onclick="openOnboardingHire('${candidate.id}')">Prepare Hire</button>`:''}`:''}</div>`);
}
function openOnboardingHire(id){
  const candidate=DB.onboardingCandidates.find(row=>row.id===id);if(!candidate)return;
  const blockers=onboardingHireBlockers(candidate);
  openEmployeeWorkspaceModal(`<div class="modal-head"><div><h3>Convert to Employee</h3><div class="small">${esc(candidateDisplayName(candidate))}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="onboarding-convert-summary"><div><span>Employee No.</span><b>${esc(nextEmployeeNumber(DB.employees))}</b></div><div><span>PRF Number</span><b>${esc(candidate.prfNumber||'—')}</b></div><div><span>Position</span><b>${esc(candidate.positionApplied||'—')}</b></div><div><span>Start Date</span><b>${fmtDate(candidate.proposedStartDate)}</b></div></div><section class="onboarding-form-section"><div class="onboarding-form-heading"><h4>Assignment &amp; Compensation</h4><p>Set the employee's reporting branch before activation.</p></div><div class="formgrid"><div class="field"><label>Branch Reporting *</label><select id="oh_branch"><option value="">Select branch</option>${employeeBranchLocations().map(branch=>`<option value="${esc(branch)}">${esc(branch)}</option>`).join('')}</select></div><div class="field"><label>Daily Rate</label><div class="money-input"><span>₱</span><input id="oh_daily_rate" type="number" min="0" step="0.01"></div></div>${employeeAllowanceFieldsHTML(null)}</div></section><div class="employee-address-stack onboarding-hire-addresses">${addressComponentHTML({prefix:'hire_home',label:'Home Address',value:candidate.homeAddress||candidate.address,required:true})}${addressComponentHTML({prefix:'hire_present',label:'Present Address',value:candidate.presentAddress||candidate.address,required:true,showCopy:true,copyFromPrefix:'hire_home'})}</div>${blockers.length?`<div class="notice"><b>Not ready to convert.</b> Complete: ${esc(blockers.join(', '))}.</div>`:`<div class="notice notice-soft"><b>Ready:</b> This creates an active employee master record and preserves this applicant history.</div>`}</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-ghost" onclick="openOnboardingForm('${candidate.id}')">Edit Applicant</button><button class="btn btn-primary" data-confirm-change="true" ${blockers.length?'disabled':''} onclick="convertOnboardingCandidate('${candidate.id}')">Create Employee</button></div>`);
}
async function convertOnboardingCandidate(id){
  const candidate=DB.onboardingCandidates.find(row=>row.id===id);if(!candidate)return;
  const blockers=onboardingHireBlockers(candidate);if(blockers.length){toast('Complete hiring requirements before conversion: '+blockers.join(', '),true);return;}
  if(candidate.employeeRecordId||DB.employees.some(employee=>employee.sourceCandidateId===candidate.id)){toast('This applicant has already been converted.',true);return;}
  const branchReporting=document.getElementById('oh_branch')?.value||'';
  const dailyRateRaw=document.getElementById('oh_daily_rate')?.value.trim()||'';
  const allowances=readEmployeeAllowances();
  if(!branchReporting){toast('Select the employee Branch Reporting location.',true);return;}
  const [homeResult,presentResult]=await Promise.all([readAddressComponent('hire_home',{required:true}),readAddressComponent('hire_present',{required:true})]);
  if(!homeResult.valid||!presentResult.valid){toast(homeResult.message||presentResult.message||'Complete both addresses using valid location suggestions.',true);return;}
  if(dailyRateRaw!==''&&(!Number.isFinite(Number(dailyRateRaw))||Number(dailyRateRaw)<0)){toast('Daily Rate must be a non-negative amount.',true);return;}
  if(Object.values(allowances).some(amount=>!Number.isFinite(amount)||amount<0)){toast('Allowance amounts must be non-negative numbers.',true);return;}
  const createdAt=new Date().toISOString();
  const createdByName=SESSION?.fullName||'System';
  const employee={id:uid(),employeeNo:nextEmployeeNumber(DB.employees),prfNumber:candidate.prfNumber,lastName:candidate.lastName,firstName:candidate.firstName,middleName:candidate.middleName,name:formatEmployeeName(candidate),position:candidate.positionApplied,department:candidate.department,branchReporting,dailyRate:dailyRateRaw===''?'':Math.round(Number(dailyRateRaw)*100)/100,allowances,dateHired:candidate.proposedStartDate,birthDate:candidate.birthDate,gender:candidate.gender,civilStatus:candidate.civilStatus||'',status:'Newly Hired',statusDate:candidate.proposedStartDate,mobileNumber:candidate.mobileNumber||'',personalEmail:candidate.personalEmail||'',homeAddress:homeResult.address,presentAddress:presentResult.address,address:formatPhilippineAddress(homeResult.address),presentAddressText:formatPhilippineAddress(presentResult.address),tin:candidate.tin||'',sssNumber:candidate.sssNumber||'',philHealthNumber:candidate.philHealthNumber||'',pagIbigNumber:candidate.pagIbigNumber||'',emergencyContactName:'',emergencyContactRelationship:'',emergencyContactPhone:'',classOverride:'Auto',sourceCandidateId:candidate.id,createdAt,createdBy:SESSION?.id||null,createdByName,updatedAt:createdAt,updatedBy:SESSION?.id||null,updatedByName:createdByName,recordHistory:[{action:'Created',at:createdAt,by:createdByName,byId:SESSION?.id||null,detail:'Converted from Onboarding & Applicants'}],employmentHistory:[{type:'Employment Status',from:'Applicant',to:'Newly Hired',effectiveDate:candidate.proposedStartDate,remarks:'Converted from Onboarding & Applicants',changedAt:createdAt,changedBy:createdByName}]};
  const original=JSON.parse(JSON.stringify(candidate));
  DB.employees.push(employee);Object.assign(candidate,{stage:'Hired',employeeRecordId:employee.id,hiredAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  if(!(await saveDB())){DB.employees=DB.employees.filter(row=>row!==employee);Object.keys(candidate).forEach(key=>delete candidate[key]);Object.assign(candidate,original);return;}
  logAudit(`Converted applicant to employee: ${employeeDisplayName(employee)}`);await closeModal();renderNav();renderOnboarding();toast(`${employeeDisplayName(employee)} is now in Employee Information.`);
}

function employeeSearchInput(value){
  const input=document.getElementById('employee-directory-search');
  if(input) queueSearchRender(input,'employeeSearch',renderEmployees);
  else STATE.employeeSearch=value;
}
function resetEmployeeDirectoryFilters(){
  cancelSearchRender('employeeSearch');
  STATE.employeeSearch='';
  STATE.employeeDepartmentFilter='';
  STATE.employeeBranchFilter='';
  STATE.employeeStatusFilter='';
  STATE.employeeClassFilter='';
  renderEmployees();
  requestAnimationFrame(()=>document.getElementById('employee-directory-search')?.focus());
}
const EMPLOYEE_COLUMN_DEFS = [
  {key:'employeeNo',label:'Employee No.',locked:true,default:true,width:104,cell:e=>`<span class="mono">${esc(e.employeeNo||'—')}</span>`},
  {key:'prfNumber',label:'PRF Number',locked:true,default:true,width:118,cell:e=>`<span class="mono">${esc(e.prfNumber||'—')}</span>`},
  {key:'name',label:'Name',locked:true,default:true,width:184,cell:e=>`<b>${esc(employeeDisplayName(e)||'—')}</b>`},
  {key:'position',label:'Position',default:true,width:172,cell:e=>esc(e.position||'—')},
  {key:'department',label:'Department',default:true,width:124,cell:e=>esc(e.department||'—')},
  {key:'branchReporting',label:'Branch Reporting',default:true,width:150,cell:e=>esc(e.branchReporting||'—')},
  {key:'dateHired',label:'Date Hired',default:true,width:112,cell:e=>fmtDate(e.dateHired)},
  {key:'gender',label:'Gender',default:false,width:86,cell:e=>esc(e.gender||'—')},
  {key:'status',label:'Status',default:true,width:142,cell:e=>statusBadge(e.status,EMP_STATUS_MAP)},
  {key:'classification',label:'Classification',default:true,width:124,cell:e=>statusBadge(classify(e),classify(e)==='Regular'?{'Regular':'b-green'}:{'Probationary':'b-amber'})},
  {key:'mobileNumber',label:'Mobile Number',default:false,width:132,cell:e=>esc(e.mobileNumber||'—')},
  {key:'personalEmail',label:'Contact Email',default:false,width:210,cell:e=>esc(e.personalEmail||'—')},
  {key:'address',label:'Home Address',default:false,width:250,cell:e=>esc(formatPhilippineAddress(e.homeAddress)||e.address||'—')},
  {key:'presentAddress',label:'Present Address',default:false,width:250,cell:e=>esc(formatPhilippineAddress(e.presentAddress)||e.presentAddressText||'—')},
  {key:'remarks',label:'Remarks',default:false,width:260,cell:e=>esc(e.remarks||'—')},
  {key:'dailyRate',label:'Daily Rate',default:false,width:112,cell:e=>e.dailyRate!==''&&e.dailyRate!=null?peso(Number(e.dailyRate)||0):'—'},
  {key:'allowances',label:'Allowances',default:false,width:210,cell:e=>employeeAllowanceSummary(e)},
  {key:'birthDate',label:'Birth Date',default:false,width:112,cell:e=>fmtDate(e.birthDate)},
  {key:'civilStatus',label:'Civil Status',default:false,width:104,cell:e=>esc(e.civilStatus||'—')},
  {key:'tin',label:'BIR TIN',default:false,width:150,cell:e=>`<span class="mono">${esc(formatGovernmentId('tin',e.tin)||'—')}</span>`},
  {key:'sssNumber',label:'SSS Number',default:false,width:144,cell:e=>`<span class="mono">${esc(formatGovernmentId('sss',e.sssNumber)||'—')}</span>`},
  {key:'philHealthNumber',label:'PhilHealth PIN',default:false,width:160,cell:e=>`<span class="mono">${esc(formatGovernmentId('philHealth',e.philHealthNumber)||'—')}</span>`},
  {key:'pagIbigNumber',label:'Pag-IBIG MID',default:false,width:154,cell:e=>`<span class="mono">${esc(formatGovernmentId('pagIbig',e.pagIbigNumber)||'—')}</span>`},
  {key:'emergencyContactName',label:'Emergency Contact',default:false,width:174,cell:e=>esc(e.emergencyContactName||'—')},
  {key:'emergencyContactRelationship',label:'Relationship',default:false,width:124,cell:e=>esc(e.emergencyContactRelationship||'—')},
  {key:'emergencyContactPhone',label:'Emergency Phone',default:false,width:142,cell:e=>esc(e.emergencyContactPhone||'—')},
];
function employeeColumnDefinitions(){
  const allowanceNames=uniqueSettingNames([...employeeAllowanceTypes(),...DB.employees.flatMap(employee=>Object.keys(employee.allowances||{}))]);
  return [...EMPLOYEE_COLUMN_DEFS,...allowanceNames.map(name=>({key:employeeAllowanceFieldKey(name),label:name,default:false,width:144,cell:employee=>employee.allowances?.[name]!==''&&employee.allowances?.[name]!=null?peso(employee.allowances[name]):'—'}))];
}
function defaultEmployeeColumns(){ return employeeColumnDefinitions().filter(c=>c.default||c.locked).map(c=>c.key); }
function sanitizeEmployeeColumns(keys){
  const definitions=employeeColumnDefinitions();
  const selected=new Set(Array.isArray(keys)?keys:defaultEmployeeColumns());
  definitions.filter(c=>c.locked).forEach(c=>selected.add(c.key));
  return definitions.filter(c=>selected.has(c.key)).map(c=>c.key);
}
function employeeVisibleColumns(){
  const keys=sanitizeEmployeeColumns(USER_PREFERENCES.employeeColumns?.length?USER_PREFERENCES.employeeColumns:defaultEmployeeColumns());
  return employeeColumnDefinitions().filter(c=>keys.includes(c.key));
}
function openEmployeeColumnManager(){
  const definitions=employeeColumnDefinitions();
  const selected=new Set(employeeVisibleColumns().map(c=>c.key));
  openModal(`
    <div class="modal-head"><div><h3>Customize employee columns</h3><div class="small">Choose the employee data shown in your directory.</div></div><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body column-manager-body">
      <div class="column-manager-list">${definitions.map(c=>`<label class="column-manager-option ${c.locked?'locked':''}"><input type="checkbox" data-employee-column value="${esc(c.key)}" ${selected.has(c.key)?'checked':''} ${c.locked?'disabled':''}><span><b>${esc(c.label)}</b>${c.locked?'<small>Required column</small>':c.key.startsWith('allowance:')?'<small>Configured allowance</small>':'<small>Optional employee data</small>'}</span></label>`).join('')}</div>
      <div class="computed-note">Your view is saved per user. Required identity columns always remain visible.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-confirm-change="false" onclick="resetEmployeeColumnPreferences()">Reset default</button><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveEmployeeColumnPreferences()">Save view</button></div>
  `);
}
async function saveEmployeeColumnPreferences(){
  const checked=[...document.querySelectorAll('[data-employee-column]:checked')].map(el=>el.value);
  USER_PREFERENCES.employeeColumns=sanitizeEmployeeColumns(checked);
  const synced=await persistUserPreferences();
  await closeModal();
  renderEmployees();
  toast(synced?'Column view saved to your account.':'Column view saved on this browser. Run the Phase 12 SQL migration to enable account sync.');
}
async function resetEmployeeColumnPreferences(){
  USER_PREFERENCES.employeeColumns=defaultEmployeeColumns();
  const synced=await persistUserPreferences();
  await closeModal();
  renderEmployees();
  toast(synced?'Default employee columns restored.':'Default columns restored on this browser.');
}
async function renderEmployees(){
  const q=(STATE.employeeSearch||'').trim().toLowerCase();
  const deptFilter = STATE.employeeDepartmentFilter||'';
  const branchFilter = STATE.employeeBranchFilter||'';
  const statusFilter = STATE.employeeStatusFilter||'';
  const classFilter = STATE.employeeClassFilter||'';
  const hasFilters=Boolean(q||deptFilter||branchFilter||statusFilter||classFilter);
  let filteredRows = DB.employees.filter(e=>{
    const hay=[e.employeeNo,e.prfNumber,e.name,employeeDisplayName(e),e.position,e.department,e.branchReporting,e.mobileNumber,e.personalEmail,formatPhilippineAddress(e.homeAddress)||e.address,formatPhilippineAddress(e.presentAddress)||e.presentAddressText,e.remarks,...Object.keys(e.allowances||{})].map(v=>String(v||'').toLowerCase());
    const matches = !q || hay.some(v=>v.includes(q));
    const deptOk = !deptFilter || e.department===deptFilter;
    const branchOk = !branchFilter || e.branchReporting===branchFilter;
    const statusOk = !statusFilter || e.status===statusFilter;
    const classOk = !classFilter || classify(e)===classFilter;
    return matches && deptOk && branchOk && statusOk && classOk;
  });
  const pageScope='records:employees';
  let pageResult;
  try{
    pageResult=await queryRecordPage({module:'employees',scope:pageScope,search:STATE.employeeSearch,searchFields:['employeeNo','prfNumber','name','lastName','firstName','middleName','position','department','branchReporting','mobileNumber','personalEmail','address','presentAddressText','remarks','homeAddress','presentAddress','allowances'],filters:{department:deptFilter,branchReporting:branchFilter,status:statusFilter},classification:classFilter,sortKey:'employeeNo',defaultSize:10});
  }catch(error){toast('Server employee search failed; showing locally cached records: '+error.message,true);pageResult=null;}
  if(!pageResult){const local=paginateRows(filteredRows,STATE,pageScope,10);pageResult={...local,server:false};}
  const rows=pageResult.rows;
  const filteredTotal=pageResult.meta.total;
  const depts = [...new Set(DB.employees.map(e=>e.department).filter(Boolean))];
  const branches = uniqueSettingNames([...employeeBranchLocations(),...DB.employees.map(e=>e.branchReporting)]);
  const statusOptions=[...new Set(DB.employees.map(e=>e.status).filter(Boolean))];
  const columns=employeeVisibleColumns();
  const tableMinWidth=columns.reduce((sum,c)=>sum+c.width,0)+92;
  setTitle('Employee Information', `${filteredTotal} of ${DB.employees.length} employees · ${depts.length} departments`);
  document.getElementById('content')?.classList.add('employee-directory-content');

  const html = `
  <div class="employee-directory-workspace">
    <section class="employee-directory-surface" aria-label="Employee directory">
      <div class="toolbar employee-directory-toolbar" aria-label="Employee directory search and filters">
        <div class="search employee-directory-search">${iSearch(14)}<input id="employee-directory-search" data-search-key="employeeSearch" type="search" autocomplete="off" spellcheck="false" aria-label="Search employees" placeholder="Search employees…" value="${esc(STATE.employeeSearch)}" oninput="employeeSearchInput(this.value)"></div>
        <select aria-label="Filter employees by department" onchange="STATE.employeeDepartmentFilter=this.value; renderEmployees()">
          <option value="">Department</option>
          ${depts.map(d=>`<option value="${esc(d)}" ${deptFilter===d?'selected':''}>${esc(d)}</option>`).join('')}
        </select>
        <select aria-label="Filter employees by reporting branch" onchange="STATE.employeeBranchFilter=this.value; renderEmployees()">
          <option value="">Branch</option>
          ${branches.map(branch=>`<option value="${esc(branch)}" ${branchFilter===branch?'selected':''}>${esc(branch)}</option>`).join('')}
        </select>
        <select aria-label="Filter employees by employment status" onchange="STATE.employeeStatusFilter=this.value; renderEmployees()">
          <option value="">Status</option>
          ${statusOptions.map(v=>`<option value="${esc(v)}" ${statusFilter===v?'selected':''}>${esc(v)}</option>`).join('')}
        </select>
        <select aria-label="Filter employees by classification" onchange="STATE.employeeClassFilter=this.value; renderEmployees()">
          <option value="">Classification</option>
          <option value="Probationary" ${classFilter==='Probationary'?'selected':''}>Probationary</option>
          <option value="Regular" ${classFilter==='Regular'?'selected':''}>Regular</option>
        </select>
        <div class="employee-toolbar-actions">
          ${hasFilters?`<button class="btn btn-ghost btn-sm employee-reset" onclick="resetEmployeeDirectoryFilters()">Reset</button>`:''}
          <button class="btn btn-ghost btn-sm" onclick="openEmployeeColumnManager()" title="Customize visible employee columns">${iColumns(13)} <span>Columns</span></button>
          ${SESSION?.role==='Administrator'?`<button class="btn btn-ghost btn-sm" onclick="downloadEmployeeImportTemplate()" title="Download employee import template">${iDownload(13)} <span>Template</span></button><button class="btn btn-ghost btn-sm" onclick="openEmployeeImport()" title="Import employee records">${iUpload(13)} <span>Import</span></button>`:''}
          ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportEmployeesCSV()" title="Export complete employee records">${iDownload(13)} <span>Export</span></button>`:''}
          ${canEdit()? `<button class="btn btn-primary btn-sm" onclick="openEmployeeForm()">${iPlus(13)} <span>Add Employee</span></button>`:''}
        </div>
      </div>
      <div class="tablewrap employee-directory-tablewrap">
        <table class="data-table employee-directory-table" data-server-paginated="true" style="min-width:${tableMinWidth}px!important">
          <colgroup>${columns.map(c=>`<col style="width:${c.width}px">`).join('')}<col style="width:92px"></colgroup>
          <thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}<th class="actions-head">Actions</th></tr></thead>
          <tbody>
            ${rows.length? rows.map(e=>`<tr class="employee-directory-row ${String(STATE.employeeSelectedId||'')===String(e.id)?'selected':''}" data-employee-id="${esc(e.id)}" tabindex="0" aria-label="Open ${esc(employeeDisplayName(e))}" onclick="selectEmployeeDirectoryRow('${e.id}');openEmployeeProfile('${e.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectEmployeeDirectoryRow('${e.id}');openEmployeeProfile('${e.id}')}">
              ${columns.map(c=>`<td data-column="${esc(c.key)}">${c.cell(e)}</td>`).join('')}
              <td onclick="event.stopPropagation()" onkeydown="event.stopPropagation()"><div class="rowactions">
                <button class="iconbtn" onclick="selectEmployeeDirectoryRow('${e.id}');openEmployeeProfile('${e.id}')" title="View employee profile">${iUser(14)}</button>
                ${canEdit()? `<button class="iconbtn" onclick="selectEmployeeDirectoryRow('${e.id}');openEmployeeForm('${e.id}')" title="Edit">${iEdit(14)}</button>
                <button class="iconbtn" onclick="selectEmployeeDirectoryRow('${e.id}');openTransferForEmployee('${e.id}')" title="Record Department Transfer">${iSwap(14)}</button>
                <button class="iconbtn" onclick="selectEmployeeDirectoryRow('${e.id}');openEmployeeStatusForm('${e.id}')" title="Update Employment Status">${iShield(14)}</button>
                <button class="iconbtn" onclick="deleteEmployee('${e.id}')" title="Delete">${iTrash(14)}</button>`:''}
              </div></td>
            </tr>`).join('') : `<tr><td colspan="${columns.length+1}"><div class="empty"><b>No employees found</b><span>${hasFilters?'Try adjusting the search or filters.':'Add an employee to begin building the directory.'}</span>${hasFilters?`<button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="resetEmployeeDirectoryFilters()">Reset search and filters</button>`:''}</div></td></tr>`}
          </tbody>
        </table>
      </div>
      ${filteredTotal?`<div class="table-pagination-wrap"><div class="table-pagination-meta">${pageResult.meta.start}–${pageResult.meta.end} <span>of ${filteredTotal} employees</span></div>${paginationHTML(pageResult.meta,pageScope,{go:'serverTablePageGo',size:'serverTablePageSize'})}</div>`:''}
    </section>
  </div>`;
  document.getElementById('content').innerHTML = html;
}
function openEmployeeWorkspaceModal(html){
  openModal(html);
  document.getElementById('modal')?.classList.add('employee-workspace-modal');
}
function selectEmployeeDirectoryRow(id){
  STATE.employeeSelectedId=id;
  document.querySelectorAll('.employee-directory-row').forEach(row=>{
    row.classList.toggle('selected',String(row.dataset.employeeId)===String(id));
  });
}
async function renderEmployeeOrigin(){
  if(STATE.view==='operations') return renderOperationsWorkspace();
  if(STATE.view==='employeeLifecycle') return renderEmployeeLifecycle();
  return renderEmployees();
}
function employeeWorkspaceHeader(emp,section='Overview'){
  const isOverview=section==='Overview';
  return `<div class="modal-head employee-workspace-head"><div class="employee-workspace-heading">${!isOverview?`<button type="button" class="employee-workspace-back" title="Back to employee" aria-label="Back to ${esc(employeeDisplayName(emp))}" onclick="closeModal();openEmployeeProfile('${emp.id}')">${iArrowLeft(17)}</button>`:''}<div><div class="employee-workspace-breadcrumb"><span>Employee Information</span><span>›</span><span>${esc(employeeDisplayName(emp))}</span>${!isOverview?`<span>›</span><b>${esc(section)}</b>`:''}</div><h3>${esc(section==='Overview'?employeeDisplayName(emp):section)}</h3><div class="small">${esc(emp.employeeNo||'—')} · ${esc(emp.position||'—')} · ${esc(emp.department||'Unassigned')}</div></div></div><button type="button" onclick="closeModal()" aria-label="Close employee workspace">&times;</button></div>`;
}
function employeeWorkspaceNav(emp,active='overview'){
  if(!canEdit()) return '';
  const actions=[
    ['overview','Overview',iUser(14),`openEmployeeProfile('${emp.id}')`],
    ['edit','Edit',iEdit(14),`openEmployeeForm('${emp.id}')`],
    ['status','Status',iShield(14),`openEmployeeStatusForm('${emp.id}')`],
    ['lifecycle','Lifecycle',iPlus(14),`openEmployeeLifecycleEventForm('${emp.id}')`],
    ['transfer','Transfer',iSwap(14),`openTransferForEmployee('${emp.id}')`],
  ];
  return `<nav class="employee-workspace-nav" aria-label="Employee transactions">${actions.map(([key,label,icon,handler])=>`<button type="button" class="${key===active?'active':''}" ${key===active?'disabled aria-current="page"':`onclick="closeModal();${handler}"`}>${icon}<span>${label}</span></button>`).join('')}</nav>`;
}
function employeeWorkspaceFooter(emp,saveLabel,saveHandler){
  return `<div class="modal-foot employee-workspace-foot"><button class="btn btn-ghost" onclick="closeModal();openEmployeeProfile('${emp.id}')">Back to Employee</button><div class="toolbar-spacer"></div><button class="btn btn-primary" onclick="${saveHandler}">${esc(saveLabel)}</button></div>`;
}

const EMP_FIELDS = [
  {key:'employeeNo', label:'Employee No.', type:'text', readonly:true},
  {key:'prfNumber', label:'PRF Number (optional)', type:'text'},
  {key:'lastName', label:'Last Name', type:'text', required:true},
  {key:'firstName', label:'First Name', type:'text', required:true},
  {key:'middleName', label:'Middle Name', type:'text'},
  {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, placeholder:'Select department', required:true, onchange:"syncPositionSelect('f_position',this.value)", catalog:'department', catalogPositionId:'f_position'},
  {key:'position', label:'Position', type:'select', options:()=>employeePositionNames(), placeholder:'Select position', required:true, catalog:'position', catalogDepartmentId:'f_department'},
  {key:'branchReporting', label:'Branch Reporting', type:'select', options:[], required:true},
  {key:'dailyRate', label:'Daily Rate', type:'number', min:0, step:'0.01'},
  {key:'dateHired', label:'Date Hired', type:'date', required:true},
  {key:'birthDate', label:'Birth Date', type:'date'},
  {key:'gender', label:'Gender', type:'select', options:['Male','Female'], required:true},
  {key:'civilStatus', label:'Civil Status', type:'select', options:['Single','Married','Widowed','Separated','Other',''], required:false},
  {key:'status', label:'Employment Status', type:'select', options:EMP_STATUS, required:true},
  {key:'statusDate', label:'Status Effective Date (resignation/AWOL/separation/etc.)', type:'date'},
  {key:'mobileNumber', label:'Mobile Number', type:'tel'},
  {key:'personalEmail', label:'Personal / Contact Email', type:'email'},
  {key:'tin', label:'BIR TIN', type:'text', format:'tin'},
  {key:'sssNumber', label:'SSS Number', type:'text', format:'sss'},
  {key:'philHealthNumber', label:'PhilHealth PIN', type:'text', format:'philHealth'},
  {key:'pagIbigNumber', label:'Pag-IBIG MID', type:'text', format:'pagIbig'},
  {key:'remarks', label:'Remarks', type:'textarea', maxLength:1000},
  {key:'emergencyContactName', label:'Emergency Contact Name', type:'text'},
  {key:'emergencyContactRelationship', label:'Emergency Contact Relationship', type:'text'},
  {key:'emergencyContactPhone', label:'Emergency Contact Phone', type:'tel'},
  {key:'classOverride', label:'Classification', type:'select', options:['Auto','Probationary','Regular'], required:true},
];
const EMPLOYEE_IMPORT_COLUMNS = [
  {header:'Employee No.',key:'employeeNo',note:'Optional. Leave blank to generate the next employee number.'},
  {header:'PRF Number',key:'prfNumber',note:'Optional and may be shared by employees hired under the same PRF.'},
  {header:'Last Name',key:'lastName',required:true},
  {header:'First Name',key:'firstName',required:true},
  {header:'Middle Name',key:'middleName'},
  {header:'Position',key:'position',required:true},
  {header:'Department',key:'department',required:true,dynamicOptions:'departments'},
  {header:'Branch Reporting',key:'branchReporting',required:true,dynamicOptions:'branches'},
  {header:'Daily Rate',key:'dailyRate',type:'money'},
  {header:'Date Hired',key:'dateHired',required:true,type:'date'},
  {header:'Birth Date',key:'birthDate',type:'date'},
  {header:'Gender',key:'gender',required:true,options:['Male','Female']},
  {header:'Civil Status',key:'civilStatus',options:['Single','Married','Widowed','Separated','Other']},
  {header:'Employment Status',key:'status',required:true,options:EMP_STATUS},
  {header:'Status Effective Date',key:'statusDate',type:'date'},
  {header:'Mobile Number',key:'mobileNumber'},
  {header:'Personal Email',key:'personalEmail'},
  {header:'Home Address',key:'address',note:'Complete free-text address. Imported as Street / House / Unit details for later PSGC validation.'},
  {header:'Remarks',key:'remarks',note:'Optional HR context or note for this employee record.'},
  {header:'Emergency Contact Name',key:'emergencyContactName'},
  {header:'Emergency Contact Relationship',key:'emergencyContactRelationship'},
  {header:'Emergency Contact Phone',key:'emergencyContactPhone'},
  {header:'Classification Override',key:'classOverride',options:['Auto','Probationary','Regular'],default:'Auto'},
  {header:'BIR TIN',key:'tin'},
  {header:'SSS Number',key:'sssNumber'},
  {header:'PhilHealth PIN',key:'philHealthNumber'},
  {header:'Pag-IBIG MID',key:'pagIbigNumber'},
];
function employeeAllowanceFieldKey(name){return `allowance:${name}`;}
function employeeImportColumns(){
  const base=EMPLOYEE_IMPORT_COLUMNS.map(column=>column.dynamicOptions==='branches'?{...column,options:employeeBranchLocations()}:column.dynamicOptions==='departments'?{...column,options:employeeDepartmentNames()}:column);
  return [...base,...employeeAllowanceTypes().map(name=>({header:`Allowance - ${name}`,key:employeeAllowanceFieldKey(name),type:'money',note:'Optional amount; enter zero or leave blank when not applicable.'}))];
}
function employeeAllowanceEntries(employee){
  const allowances=employee?.allowances&&typeof employee.allowances==='object'?employee.allowances:{};
  const names=uniqueSettingNames([...employeeAllowanceTypes(),...Object.keys(allowances)]);
  return names.map(name=>({name,amount:Number(allowances[name])||0})).filter(item=>item.amount!==0);
}
function employeeAllowanceTotal(employee){return employeeAllowanceEntries(employee).reduce((sum,item)=>sum+item.amount,0);}
function employeeAllowanceSummary(employee){
  const entries=employeeAllowanceEntries(employee);
  return entries.length?`${peso(employeeAllowanceTotal(employee))} · ${entries.length} ${entries.length===1?'type':'types'}`:'—';
}
const EMPLOYEE_IMPORT_HEADER_ALIASES = {
  employeenumber:'employeeNo',employeeno:'employeeNo',prf:'prfNumber',prfnumber:'prfNumber',
  lastname:'lastName',firstname:'firstName',middlename:'middleName',datehired:'dateHired',birthdate:'birthDate',
  employmentstatus:'status',statuseffectivedate:'statusDate',mobilenumber:'mobileNumber',mobile:'mobileNumber',
  personalemail:'personalEmail',email:'personalEmail',homeaddress:'address',address:'address',
  emergencycontact:'emergencyContactName',emergencycontactname:'emergencyContactName',
  emergencycontactrelationship:'emergencyContactRelationship',relationship:'emergencyContactRelationship',
  emergencycontactphone:'emergencyContactPhone',classification:'classOverride',classificationoverride:'classOverride',
  birtin:'tin',tin:'tin',sss:'sssNumber',sssnumber:'sssNumber',philhealth:'philHealthNumber',philhealthpin:'philHealthNumber',
  pagibig:'pagIbigNumber',pagibigmid:'pagIbigNumber'
};
let EMPLOYEE_IMPORT_PREVIEW=null;

function employeeSpreadsheetReady(){
  if(window.XLSX) return true;
  toast('Excel tools could not load. Refresh the page or contact the System Administrator.',true);
  return false;
}
function requireEmployeeImportAdmin(){
  if(SESSION?.role==='Administrator') return true;
  toast('Only a System Administrator can import employees or download the template.',true);
  return false;
}
function normalizeSpreadsheetHeader(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function employeeImportKey(value){
  const normalized=normalizeSpreadsheetHeader(value);
  return EMPLOYEE_IMPORT_HEADER_ALIASES[normalized]||employeeImportColumns().find(column=>normalizeSpreadsheetHeader(column.header)===normalized)?.key||'';
}
function spreadsheetISODate(value){
  if(value==null||value==='') return '';
  const validDateParts=(year,month,day)=>{
    const candidate=new Date(year,month-1,day);
    return candidate.getFullYear()===year&&candidate.getMonth()===month-1&&candidate.getDate()===day;
  };
  let date=value;
  if(typeof value==='number'&&window.XLSX?.SSF){
    const parsed=window.XLSX.SSF.parse_date_code(value);
    if(parsed&&validDateParts(parsed.y,parsed.m,parsed.d)) return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
    return null;
  }
  if(typeof value==='string'){
    const text=value.trim();
    if(!text) return '';
    const iso=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(iso) return validDateParts(Number(iso[1]),Number(iso[2]),Number(iso[3]))?text:null;
    const match=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if(match){
      const year=Number(match[3]),month=Number(match[1]),day=Number(match[2]);
      if(!validDateParts(year,month,day)) return null;
      date=new Date(year,month-1,day);
    }
    else date=new Date(text);
  }
  if(!(date instanceof Date)||Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function importAllowedValue(value,options){
  const text=String(value||'').trim();
  if(!text) return '';
  return options.find(option=>String(option).toLowerCase()===text.toLowerCase())||null;
}
function employeeImportPhoneError(value,label){
  if(!String(value||'').trim()) return '';
  const digits=String(value).replace(/\D/g,'');
  return digits.length>=10&&digits.length<=13?'':`${label} must contain 10 to 13 digits.`;
}
function validateEmployeeImportRow(values,rowNumber,accepted){
  const errors=[];const warnings=[];const vals={};
  const columns=employeeImportColumns();
  columns.forEach(column=>{
    let value=values[column.key];
    if(column.type==='date'){
      const parsed=spreadsheetISODate(value);
      if(parsed===null) errors.push(`${column.header} is not a valid date`);
      value=parsed||'';
    } else if(column.type==='money'){
      const text=String(value??'').trim();
      if(!text)value='';
      else {
        const amount=Number(text.replace(/[₱,\s]/g,''));
        if(!Number.isFinite(amount)||amount<0)errors.push(`${column.header} must be a non-negative amount`);
        value=Number.isFinite(amount)&&amount>=0?Math.round(amount*100)/100:'';
      }
    } else value=String(value??'').trim();
    if(!value&&column.default) value=column.default;
    if(value&&column.options){
      const allowed=importAllowedValue(value,column.options);
      if(allowed===null) errors.push(`${column.header} must be one of: ${column.options.join(', ')}`);
      else value=allowed;
    }
    vals[column.key]=value;
  });
  columns.filter(column=>column.required).forEach(column=>{if(!vals[column.key])errors.push(`${column.header} is required`);});
  if(vals.position&&vals.department){
    const configuredPositions=positionCatalog();
    const positionMatch=configuredPositions.find(item=>item.active&&item.name.toLowerCase()===vals.position.toLowerCase()&&item.department.toLowerCase()===vals.department.toLowerCase());
    if(!configuredPositions.length)errors.push('No positions are configured in Settings > Organization Structure');
    else if(!positionMatch)errors.push(`Position must be an active position configured for ${vals.department}`);
    else vals.position=positionMatch.name;
  }
  if(vals.dateHired&&vals.dateHired>todayISO()) errors.push('Date Hired cannot be in the future');
  if(vals.birthDate&&vals.birthDate>todayISO()) errors.push('Birth Date cannot be in the future');
  if(vals.statusDate&&vals.dateHired&&vals.statusDate<vals.dateHired) errors.push('Status Effective Date cannot be before Date Hired');
  if(vals.personalEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.personalEmail)) errors.push('Personal Email is invalid');
  if(vals.remarks.length>1000) errors.push('Remarks cannot exceed 1,000 characters');
  [employeeImportPhoneError(vals.mobileNumber,'Mobile Number'),employeeImportPhoneError(vals.emergencyContactPhone,'Emergency Contact Phone'),validateGovernmentIds(vals)].filter(Boolean).forEach(error=>errors.push(error));
  if(!vals.employeeNo) vals.employeeNo=nextEmployeeNumber([...DB.employees,...accepted]);
  const duplicateNumber=[...DB.employees,...accepted].find(employee=>String(employee.employeeNo||'').toUpperCase()===String(vals.employeeNo).toUpperCase());
  if(duplicateNumber) errors.push(`Employee No. ${vals.employeeNo} already exists`);
  vals.name=formatEmployeeName(vals);
  vals.allowances={};
  employeeAllowanceTypes().forEach(name=>{
    const key=employeeAllowanceFieldKey(name);
    if(vals[key]!==''&&vals[key]!=null)vals.allowances[name]=Number(vals[key])||0;
    delete vals[key];
  });
  if(vals.name){
    const matches=[...DB.employees,...accepted].map(employee=>({employee,score:employeeNameSimilarity(vals,employee)})).filter(match=>match.score>=0.86).sort((a,b)=>b.score-a.score);
    if(matches.length) warnings.push(`Possible duplicate: ${employeeDisplayName(matches[0].employee)} (${Math.round(matches[0].score*100)}% name match)`);
  }
  return {rowNumber,values:vals,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}
function parseEmployeeImportWorksheet(workbook,fileName){
  const sheetName=workbook.SheetNames.find(name=>name.toLowerCase()==='employees')||workbook.SheetNames[0];
  if(!sheetName) return {fileName,rows:[],fileErrors:['The workbook does not contain a worksheet.']};
  const matrix=window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true});
  if(!matrix.length) return {fileName,rows:[],fileErrors:['The Employees worksheet is empty.']};
  const keys=matrix[0].map(employeeImportKey);
  const fileErrors=[];
  const duplicateHeaders=keys.filter((key,index)=>key&&keys.indexOf(key)!==index);
  const columns=employeeImportColumns();
  if(duplicateHeaders.length) fileErrors.push(`Duplicate column${new Set(duplicateHeaders).size===1?'':'s'}: ${[...new Set(duplicateHeaders)].map(key=>columns.find(column=>column.key===key)?.header||key).join(', ')}`);
  columns.filter(column=>column.required).forEach(column=>{if(!keys.includes(column.key))fileErrors.push(`Missing required column: ${column.header}`);});
  const accepted=[];const rows=[];
  matrix.slice(1).forEach((cells,index)=>{
    if(!cells.some(cell=>String(cell??'').trim())) return;
    const values={};keys.forEach((key,columnIndex)=>{if(key)values[key]=cells[columnIndex];});
    const result=validateEmployeeImportRow(values,index+2,accepted);
    rows.push(result);if(!result.errors.length)accepted.push(result.values);
  });
  if(!rows.length) fileErrors.push('No populated employee rows were found.');
  return {fileName,sheetName,rows,fileErrors};
}
function employeeImportSummary(preview){
  const errors=preview.fileErrors.length+preview.rows.reduce((sum,row)=>sum+row.errors.length,0);
  const warnings=preview.rows.reduce((sum,row)=>sum+row.warnings.length,0);
  const valid=preview.rows.filter(row=>!row.errors.length).length;
  return {errors,warnings,valid,total:preview.rows.length};
}
function openEmployeeImport(){
  if(SESSION?.role!=='Administrator'){toast('Only a System Administrator can import employee records.',true);return;}
  if(!requireEmployeeImportAdmin()||!employeeSpreadsheetReady()) return;
  EMPLOYEE_IMPORT_PREVIEW=null;
  openEmployeeWorkspaceModal(`<div class="modal-head"><div><h3>Import Employees</h3><div class="small">Validate a completed Excel template before adding records.</div></div><button type="button" onclick="closeModal()" aria-label="Close import">&times;</button></div><div class="modal-body employee-import-body"><div class="employee-import-drop"><span>${iUpload(22)}</span><div><b>Select an employee workbook</b><p>Accepted formats: .xlsx, .xls, and .csv. No records are saved until validation succeeds and you confirm the import.</p></div><label class="btn btn-primary btn-sm" for="employee-import-file">Choose File</label><input id="employee-import-file" type="file" accept=".xlsx,.xls,.csv" hidden onchange="handleEmployeeImportFile(this)"></div><div class="employee-import-rules"><b>Before importing</b><span>Use separate Last Name, First Name, and Middle Name columns. Required values, dates, contact details, government IDs, employee numbers, and allowed options are checked for every row. Similar names are highlighted for review.</span></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><div class="toolbar-spacer"></div><button class="btn btn-ghost" onclick="downloadEmployeeImportTemplate()">${iDownload(13)} Download Template</button></div>`);
}
async function handleEmployeeImportFile(input){
  if(SESSION?.role!=='Administrator'){toast('Only a System Administrator can import employee records.',true);return;}
  if(!requireEmployeeImportAdmin()||!employeeSpreadsheetReady()) return;
  const file=input.files?.[0];if(!file)return;
  try{
    const workbook=window.XLSX.read(await file.arrayBuffer(),{cellDates:true});
    EMPLOYEE_IMPORT_PREVIEW=parseEmployeeImportWorksheet(workbook,file.name);
    renderEmployeeImportPreview();
  }catch(error){toast('The workbook could not be read: '+error.message,true);input.value='';}
}
function renderEmployeeImportPreview(){
  if(!EMPLOYEE_IMPORT_PREVIEW)return;
  const summary=employeeImportSummary(EMPLOYEE_IMPORT_PREVIEW);
  const issues=[...EMPLOYEE_IMPORT_PREVIEW.fileErrors];
  openEmployeeWorkspaceModal(`<div class="modal-head"><div><h3>Review Employee Import</h3><div class="small">${esc(EMPLOYEE_IMPORT_PREVIEW.fileName)} · ${summary.total} populated rows</div></div><button type="button" onclick="closeModal()" aria-label="Close import preview">&times;</button></div><div class="modal-body employee-import-body"><div class="employee-import-summary"><div><span>Ready</span><b>${summary.valid}</b></div><div class="${summary.errors?'has-error':''}"><span>Errors</span><b>${summary.errors}</b></div><div class="${summary.warnings?'has-warning':''}"><span>Warnings</span><b>${summary.warnings}</b></div></div>${issues.length?`<div class="employee-import-file-errors"><b>Workbook errors</b>${issues.map(issue=>`<span>${esc(issue)}</span>`).join('')}</div>`:''}<div class="tablewrap employee-import-preview"><table class="data-table"><thead><tr><th>Row</th><th>Employee No.</th><th>Employee</th><th>Department</th><th>Branch Reporting</th><th>Validation</th></tr></thead><tbody>${EMPLOYEE_IMPORT_PREVIEW.rows.map(row=>`<tr><td class="mono">${row.rowNumber}</td><td class="mono">${esc(row.values.employeeNo||'—')}</td><td><b>${esc(row.values.name||'Incomplete name')}</b><div class="small">${esc(row.values.position||'—')}</div></td><td>${esc(row.values.department||'—')}</td><td>${esc(row.values.branchReporting||'—')}</td><td>${row.errors.length?`<div class="import-issues error">${row.errors.map(issue=>`<span>${esc(issue)}</span>`).join('')}</div>`:row.warnings.length?`<div class="import-issues warning">${row.warnings.map(issue=>`<span>${esc(issue)}</span>`).join('')}</div>`:'<span class="badge b-green"><span class="dot"></span>Ready</span>'}</td></tr>`).join('')}</tbody></table></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="openEmployeeImport()">Choose Another File</button><div class="toolbar-spacer"></div><button class="btn btn-primary" ${summary.errors||!summary.valid?'disabled':''} onclick="commitEmployeeImport()">Import ${summary.valid} Employee${summary.valid===1?'':'s'}</button></div>`);
}
async function commitEmployeeImport(){
  if(SESSION?.role!=='Administrator'){toast('Only a System Administrator can import employee records.',true);return;}
  if(!requireEmployeeImportAdmin()||!EMPLOYEE_IMPORT_PREVIEW)return;
  const summary=employeeImportSummary(EMPLOYEE_IMPORT_PREVIEW);
  if(summary.errors||!summary.valid){toast('Resolve every import error before continuing.',true);return;}
  const confirmed=await confirmDataChange({title:'Import employee records',message:`Add ${summary.valid} employees to the live directory${summary.warnings?` with ${summary.warnings} possible duplicate-name warning${summary.warnings===1?'':'s'}`:''}? This change will be recorded under your account.`,confirmLabel:'Import employees',cancelLabel:'Cancel',warning:Boolean(summary.warnings)});
  if(!confirmed)return;
  const now=new Date().toISOString();const actorName=SESSION?.fullName||'System';const added=[];
  EMPLOYEE_IMPORT_PREVIEW.rows.forEach(row=>{
    const employee={id:uid(),...row.values,employmentHistory:[],recordHistory:[],createdAt:now,createdBy:SESSION?.id||null,createdByName:actorName,updatedAt:now,updatedBy:SESSION?.id||null,updatedByName:actorName};
    employee.homeAddress=normalizeAddress(null,employee.address||'');
    employee.presentAddress=normalizeAddress(null,employee.address||'');
    employee.presentAddressText=employee.address||'';
    employee.recordHistory.push({action:'Imported',at:now,by:actorName,byId:SESSION?.id||null,detail:`Employee record imported from ${EMPLOYEE_IMPORT_PREVIEW.fileName}`});
    employee.employmentHistory.push({type:'Employment Status',from:'',to:employee.status,effectiveDate:employee.statusDate||employee.dateHired,remarks:'Initial employee record imported from Excel',changedAt:now,changedBy:actorName});
    DB.employees.push(employee);added.push(employee);
  });
  if(!(await saveDB())){DB.employees=DB.employees.filter(employee=>!added.includes(employee));return;}
  logAudit(`Imported ${added.length} employee records from ${EMPLOYEE_IMPORT_PREVIEW.fileName}`);
  EMPLOYEE_IMPORT_PREVIEW=null;await closeModal();renderNav();renderEmployees();toast(`Imported ${added.length} employee records.`);
}
function downloadEmployeeImportTemplate(){
  if(SESSION?.role!=='Administrator'){toast('Only a System Administrator can download the employee import template.',true);return;}
  if(!requireEmployeeImportAdmin()||!employeeSpreadsheetReady())return;
  const columns=employeeImportColumns();
  const headers=columns.map(column=>column.header);
  const employeeSheet=window.XLSX.utils.aoa_to_sheet([headers]);
  employeeSheet['!cols']=columns.map(column=>({wch:Math.max(15,column.header.length+3)}));
  employeeSheet['!autofilter']={ref:`A1:${window.XLSX.utils.encode_col(headers.length-1)}1`};
  const instructions=[['SLSC Employee Import Template'],['Instructions'],['1. Enter one employee per row in the Employees sheet.'],['2. Do not rename or remove required columns.'],['3. Leave Employee No. blank to generate the next available number.'],['4. Dates may use YYYY-MM-DD or MM/DD/YYYY.'],['5. PRF Number and government IDs are optional.'],['6. Branch Reporting must match an Administrator-configured branch.'],['7. Home Address accepts a complete free-text address and is imported into Street / House / Unit details. Select its official Region through Barangay when the employee is next edited.'],['8. Import validates the entire workbook before saving any employee.'],[],['Column','Required','Allowed values / guidance'],...columns.map(column=>[column.header,column.required?'Yes':'No',column.options?.join(' | ')||column.note||''])];
  const instructionSheet=window.XLSX.utils.aoa_to_sheet(instructions);instructionSheet['!cols']=[{wch:34},{wch:12},{wch:95}];
  const reference=[['Field','Allowed values'],['Department',employeeDepartmentNames().join(' | ')],['Position',positionCatalog().filter(item=>item.active).map(item=>`${item.name} (${item.department})`).join(' | ')||'Configure positions in Settings'],['Branch Reporting',employeeBranchLocations().join(' | ')],['Allowance Types',employeeAllowanceTypes().join(' | ')||'No allowance types configured'],['Gender','Male | Female'],['Civil Status','Single | Married | Widowed | Separated | Other'],['Employment Status',EMP_STATUS.join(' | ')],['Classification Override','Auto | Probationary | Regular'],['SSS Number','10 digits; example 09-5421455-9'],['PhilHealth PIN','12 digits; 2-9-1 format'],['Pag-IBIG MID','12 digits; 4-4-4 format'],['BIR TIN','9 digits plus optional 3-digit branch code']];
  const referenceSheet=window.XLSX.utils.aoa_to_sheet(reference);referenceSheet['!cols']=[{wch:30},{wch:95}];
  const workbook=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook,employeeSheet,'Employees');window.XLSX.utils.book_append_sheet(workbook,instructionSheet,'Instructions');window.XLSX.utils.book_append_sheet(workbook,referenceSheet,'Reference');
  window.XLSX.writeFile(workbook,'SLSC_Employee_Import_Template.xlsx');toast('Employee import template downloaded.');
}
const EMP_FORM_SECTIONS = [
  {title:'Employee Record',description:'Core identifiers and approved hiring reference.',keys:['employeeNo','prfNumber']},
  {title:'Personal & Employment',description:'Legal name, assignment, and current employment details.',keys:['lastName','firstName','middleName','department','position','dateHired','birthDate','gender','civilStatus','status','statusDate','classOverride','remarks']},
  {title:'Assignment & Compensation',description:'Required reporting location and current employee rate or allowances.',keys:['branchReporting','dailyRate'],allowances:true},
  {title:'Contact & Emergency',description:'Private contact information used by HR when needed.',keys:['mobileNumber','personalEmail','emergencyContactName','emergencyContactRelationship','emergencyContactPhone']},
  {title:'Government IDs',description:'Optional statutory identifiers with format validation.',keys:['tin','sssNumber','philHealthNumber','pagIbigNumber']},
];
function employeeFormFieldValue(field,record){
  if(record) return record[field.key];
  if(field.key==='employeeNo') return nextEmployeeNumber(DB.employees);
  if(field.key==='status') return 'Newly Hired';
  if(field.key==='classOverride') return 'Auto';
  return '';
}
function employeeFormSectionsHTML(record){
  const fieldSections=EMP_FORM_SECTIONS.map((section,index)=>`<section class="employee-form-section">
    <div class="employee-form-section-head"><span>${String(index+1).padStart(2,'0')}</span><div><h4>${esc(section.title)}</h4><p>${esc(section.description)}</p></div></div>
    <div class="employee-form-grid">${section.keys.map(key=>{
      const field=EMP_FIELDS.find(item=>item.key===key);
      if(!field)return '';
      let resolved=field;
      if(key==='branchReporting')resolved={...field,options:['',...uniqueSettingNames([...employeeBranchLocations(),record?.branchReporting||''])]};
      if(key==='department')resolved={...field,options:()=>employeeDepartmentNames(record?.department||'')};
      if(key==='position')resolved={...field,options:()=>employeePositionNames(record?.department||'',record?.position||'')};
      return fieldHTML(resolved,employeeFormFieldValue(resolved,record));
    }).join('')}${section.allowances?employeeAllowanceFieldsHTML(record):''}</div>
  </section>`).join('');
  const homeAddress=normalizeAddress(record?.homeAddress,record?.address||'');
  const presentAddress=normalizeAddress(record?.presentAddress,record?.presentAddressText||record?.address||'');
  return `${fieldSections}<section class="employee-form-section employee-address-section">
    <div class="employee-form-section-head"><span>${String(EMP_FORM_SECTIONS.length+1).padStart(2,'0')}</span><div><h4>Addresses</h4><p>Validated Philippine home and present addresses with PSGC location codes.</p></div></div>
    <div class="employee-address-stack">${addressComponentHTML({prefix:'emp_home',label:'Home Address',value:homeAddress,required:true})}${addressComponentHTML({prefix:'emp_present',label:'Present Address',value:presentAddress,required:true,showCopy:true,copyFromPrefix:'emp_home'})}</div>
  </section>`;
}
function syncPositionSelect(id,department){
  const select=document.getElementById(id);if(!select)return;
  const current=select.value;
  const options=employeePositionNames(department);
  select.innerHTML=`<option value="">Select position</option>${options.map(name=>`<option value="${esc(name)}" ${name===current?'selected':''}>${esc(name)}</option>`).join('')}`;
  if(!options.includes(current))select.value='';
}
async function persistOrganizationStructure(){
  const departments=normalizeDepartmentCatalog(DB.settings?.departments);
  const positions=normalizePositionCatalog(DB.settings?.positions);
  const {data,error}=await supabase.rpc('save_organization_structure',{p_departments:departments,p_positions:positions});
  if(error){
    const setup=/save_organization_structure|schema cache|could not find/i.test(error.message||'');
    toast(setup?'Organization Structure setup is not installed. Run phase15-organization-structure.sql in Supabase.':'Could not save Organization Structure: '+error.message,true);
    return false;
  }
  if(data&&typeof data==='object')DB.settings={...DB.settings,...data};
  return true;
}
function toggleCatalogQuickAdd(type,selectId,departmentId='',positionId=''){
  if(!isHRRole())return;
  const editor=document.getElementById(`${selectId}_catalog_editor`);if(!editor)return;
  if(!editor.hidden){editor.hidden=true;return;}
  if(type==='position'&&!document.getElementById(departmentId)?.value){toast('Select a department before adding a position.',true);return;}
  document.querySelectorAll('.catalog-quick-add').forEach(item=>item.hidden=true);
  editor.hidden=false;
  if(departmentId)editor.dataset.departmentId=departmentId;
  if(positionId)editor.dataset.positionId=positionId;
  requestAnimationFrame(()=>document.getElementById(`${selectId}_catalog_name`)?.focus());
}
function catalogQuickAddKeydown(event,selectId){
  if(event.key==='Enter'){event.preventDefault();saveCatalogQuickAdd(selectId);}
  if(event.key==='Escape'){event.preventDefault();const editor=document.getElementById(`${selectId}_catalog_editor`);if(editor)editor.hidden=true;}
}
async function saveCatalogQuickAdd(selectId){
  if(!isHRRole())return;
  const editor=document.getElementById(`${selectId}_catalog_editor`);
  const input=document.getElementById(`${selectId}_catalog_name`);
  const type=editor?.dataset.catalogType;
  let name=input?.value.trim()||'';
  if(type==='department')name=name.toUpperCase();
  if(!name){toast(`Enter a ${type||'catalog'} name.`,true);input?.focus();return;}
  const department=type==='position'?document.getElementById(editor.dataset.departmentId)?.value||'':'';
  if(type==='position'&&!department){toast('Select a department before adding a position.',true);return;}
  const departments=departmentCatalog();
  const positions=positionCatalog();
  const duplicate=type==='department'
    ?departments.some(item=>item.name.toLowerCase()===name.toLowerCase())
    :positions.some(item=>item.department.toLowerCase()===department.toLowerCase()&&item.name.toLowerCase()===name.toLowerCase());
  if(duplicate){toast(`That ${type} already exists${department?` in ${department}`:''}.`,true);return;}
  if(!(await confirmDataChange({title:`Add ${type}`,message:`Add ${name}${department?` under ${department}`:''} to Organization Structure? It will become available across employee and applicant forms.`,confirmLabel:`Add ${type}`})))return;
  const previous=JSON.parse(JSON.stringify(DB.settings));
  if(type==='department')DB.settings.departments=[...departments,{name,active:true}];
  else DB.settings.positions=[...positions,{name,department,active:true}];
  if(!(await persistOrganizationStructure())){DB.settings=previous;return;}
  const select=document.getElementById(selectId);
  if(type==='department'){
    const options=employeeDepartmentNames(name);
    select.innerHTML=`<option value="">Select department</option>${options.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
    select.value=name;
    if(editor.dataset.positionId)syncPositionSelect(editor.dataset.positionId,name);
  }else{
    syncPositionSelect(selectId,department);
    select.value=name;
  }
  input.value='';editor.hidden=true;
  logAudit(`Added ${type} from employee workflow: ${name}${department?` · ${department}`:''}`);
  toast(`${type==='department'?'Department':'Position'} added and selected.`);
}
function employeeAllowanceFieldsHTML(record){
  const types=employeeAllowanceTypes();
  if(!types.length)return '<div class="employee-allowance-empty">No allowance types configured. A System Administrator can add them in Settings.</div>';
  return types.map((name,index)=>`<div class="field"><label>${esc(name)}</label><div class="money-input"><span>₱</span><input id="f_allowance_${index}" data-employee-allowance data-allowance-name="${esc(name)}" type="number" min="0" step="0.01" value="${esc(record?.allowances?.[name]??'')}"></div></div>`).join('');
}
function readEmployeeAllowances(existingEmployee=null){
  const activeNames=new Set(employeeAllowanceTypes().map(name=>name.toLowerCase()));
  const allowances=Object.fromEntries(Object.entries(existingEmployee?.allowances||{}).filter(([name])=>!activeNames.has(name.toLowerCase())));
  document.querySelectorAll('[data-employee-allowance]').forEach(input=>{
    const name=input.dataset.allowanceName;const raw=input.value.trim();
    if(name&&raw!=='')allowances[name]=Math.round(Number(raw)*100)/100;
  });
  return allowances;
}
function openEmployeeForm(id){
  const existing = id? DB.employees.find(e=>e.id===id): null;
  const formRecord=existing?{...existing,...splitEmployeeName(existing)}:null;
  if(id&&!existing){toast('Employee record could not be found.',true);return;}
  if(existing) selectEmployeeDirectoryRow(existing.id);
  openEmployeeWorkspaceModal(`
    ${existing?employeeWorkspaceHeader(existing,'Edit Employee'):`<div class="modal-head employee-workspace-head"><div><div class="employee-workspace-breadcrumb"><span>Employee Information</span><span>›</span><b>Add Employee</b></div><h3>Add Employee</h3><div class="small">Create a complete employee master record.</div></div><button type="button" onclick="closeModal()" aria-label="Close employee form">&times;</button></div>`}
    <div class="modal-body employee-form-body">
      ${existing?employeeWorkspaceNav(existing,'edit'):''}
      ${employeeFormSectionsHTML(formRecord)}
      <div class="employee-form-guidance"><b>Automatic classification</b><span>Date Hired is evaluated against the ${DB.settings.probationDays}-day regularization threshold in Settings. Keep Classification on Auto unless HR needs to correct the record.</span></div>
    </div>
    ${existing?employeeWorkspaceFooter(existing,'Save Employee',`saveEmployee('${id}')`):`<div class="modal-foot employee-workspace-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><div class="toolbar-spacer"></div><button class="btn btn-primary" onclick="saveEmployee('')">Save Employee</button></div>`}
  `);
}
function normalizeEmployeeName(v){ return String(v||'').toLowerCase().replace(/\s+/g,' ').trim(); }
function splitEmployeeName(employee={}){
  if(employee.lastName||employee.firstName||employee.middleName) return {lastName:employee.lastName||'',firstName:employee.firstName||'',middleName:employee.middleName||''};
  const raw=String(employee.name||'').trim();
  if(!raw) return {lastName:'',firstName:'',middleName:''};
  if(raw.includes(',')){
    const [last,...rest]=raw.split(',');
    const given=rest.join(',').trim().split(/\s+/).filter(Boolean);
    return {lastName:last.trim(),firstName:given.shift()||'',middleName:given.join(' ')};
  }
  const parts=raw.split(/\s+/).filter(Boolean);
  const lastName=parts.length>1?parts.pop():'';
  return {lastName,firstName:parts.join(' '),middleName:''};
}
function formatEmployeeName({lastName='',firstName='',middleName=''}){
  const family=String(lastName).trim();
  const given=[String(firstName).trim(),String(middleName).trim()].filter(Boolean).join(' ');
  return family&&given?`${family}, ${given}`:family||given;
}
function employeeDisplayName(employee){
  const parts=splitEmployeeName(employee);
  return parts.lastName&&parts.firstName?formatEmployeeName(parts):String(employee?.name||'').trim();
}
function duplicateNameKey(value){
  const raw=typeof value==='string'?value:employeeDisplayName(value);
  return String(raw||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
function levenshteinDistance(a,b){
  const left=String(a||''),right=String(b||'');
  const row=Array.from({length:right.length+1},(_,index)=>index);
  for(let i=1;i<=left.length;i++){
    let previous=row[0];row[0]=i;
    for(let j=1;j<=right.length;j++){
      const saved=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(left[i-1]===right[j-1]?0:1));
      previous=saved;
    }
  }
  return row[right.length];
}
function employeeNameSimilarity(a,b){
  const left=duplicateNameKey(a),right=duplicateNameKey(b);
  if(!left||!right) return 0;
  if(left===right) return 1;
  return 1-(levenshteinDistance(left,right)/Math.max(left.length,right.length));
}
function findEmployeeDuplicates(vals,id){
  return DB.employees.filter(employee=>employee.id!==id).map(employee=>{
    const score=employeeNameSimilarity(vals,employee);
    const sameDate=!!vals.dateHired&&String(employee.dateHired||'')===String(vals.dateHired);
    const sameDepartment=!!vals.department&&String(employee.department||'')===String(vals.department);
    return {employee,score,sameDate,sameDepartment};
  }).filter(match=>match.score>=0.86||(match.score>=0.78&&(match.sameDate||match.sameDepartment))).sort((a,b)=>b.score-a.score);
}
function updateEmployeeNameReferences(oldName,newName){
  if(!oldName||!newName||normalizeEmployeeName(oldName)===normalizeEmployeeName(newName)) return [];
  const changes=[];
  RECORD_MODULES.filter(module=>module!=='employees').forEach(module=>(DB[module]||[]).forEach(record=>{
    ['employeeName','employeeReplaced','changedBy'].forEach(key=>{
      if(normalizeEmployeeName(record[key])===normalizeEmployeeName(oldName)){changes.push({record,key,value:record[key]});record[key]=newName;}
    });
  }));
  return changes;
}
function restoreEmployeeNameReferences(changes){ (changes||[]).forEach(change=>change.record[change.key]=change.value); }
function appendEmployeeRecordHistory(employee,action,detail,at=new Date().toISOString()){
  const actorName=SESSION?.fullName||'System';
  if(!Array.isArray(employee.recordHistory)) employee.recordHistory=[];
  Object.assign(employee,{updatedAt:at,updatedBy:SESSION?.id||null,updatedByName:actorName});
  employee.recordHistory.push({action,at,by:actorName,byId:SESSION?.id||null,detail});
}

async function saveEmployee(id){
  const vals = readFields(EMP_FIELDS);
  vals.allowances=readEmployeeAllowances(id?DB.employees.find(employee=>employee.id===id):null);
  const missing = EMP_FIELDS.filter(f=>f.required && !vals[f.key]);
  if(missing.length){ toast('Please complete: '+missing.map(f=>f.label).join(', ')); return; }
  const existingEmployee=id?DB.employees.find(employee=>employee.id===id):null;
  const [homeResult,presentResult]=await Promise.all([
    readAddressComponent('emp_home',{required:true}),
    readAddressComponent('emp_present',{required:true}),
  ]);
  if(!homeResult.valid||!presentResult.valid){toast(homeResult.message||presentResult.message||'Complete both addresses using valid location suggestions.',true);return;}
  vals.homeAddress=homeResult.address;
  vals.presentAddress=presentResult.address;
  vals.address=formatPhilippineAddress(homeResult.address);
  vals.presentAddressText=formatPhilippineAddress(presentResult.address);
  const validDepartment=departmentCatalog().some(item=>item.name===vals.department&&(item.active||existingEmployee?.department===vals.department));
  const validPosition=positionCatalog().some(item=>item.name===vals.position&&item.department===vals.department&&(item.active||(existingEmployee?.department===vals.department&&existingEmployee?.position===vals.position)));
  if(!validDepartment||!validPosition){toast('Select an active department and a position configured for that department.',true);return;}
  if(vals.dailyRate!==''&&(!Number.isFinite(Number(vals.dailyRate))||Number(vals.dailyRate)<0)){toast('Daily Rate must be a non-negative amount.',true);return;}
  if(Object.values(vals.allowances).some(amount=>!Number.isFinite(amount)||amount<0)){toast('Allowance amounts must be non-negative numbers.',true);return;}
  vals.dailyRate=vals.dailyRate===''?'':Math.round(Number(vals.dailyRate)*100)/100;
  if(vals.dateHired>todayISO()){ toast('Date Hired cannot be in the future.'); return; }
  if(vals.birthDate && vals.birthDate>todayISO()){ toast('Birth Date cannot be in the future.'); return; }
  if(vals.statusDate && vals.statusDate<vals.dateHired){ toast('Status Effective Date cannot be before Date Hired.'); return; }
  const governmentIdValidation=validateGovernmentIds(vals); if(governmentIdValidation){toast(governmentIdValidation,true);return;}
  if(vals.employeeNo && DB.employees.some(e=>e.id!==id && String(e.employeeNo||'').toUpperCase()===String(vals.employeeNo).toUpperCase())){ vals.employeeNo=nextEmployeeNumber(DB.employees); }
  vals.name=formatEmployeeName(vals);
  const duplicateCandidates=findEmployeeDuplicates(vals,id);
  if(duplicateCandidates.length){
    const sample=duplicateCandidates.slice(0,4).map(match=>`${employeeDisplayName(match.employee)} · ${match.employee.employeeNo||'No employee number'} · ${match.employee.department||'Unassigned'} (${Math.round(match.score*100)}% name match)`).join('; ');
    if(!(await confirmDataChange({title:'Possible duplicate employee',message:`Similar employee record${duplicateCandidates.length===1?' was':'s were'} found: ${sample}. Review these matches before creating another employee.`,confirmLabel:'Continue and save',cancelLabel:'Go back',warning:true}))) return;
  }
  const isNew=!id;
  const rec=id?DB.employees.find(e=>e.id===id):{id:uid(), employmentHistory:[]};
  if(!rec){ toast('Employee record could not be found.',true); return; }
  const original=isNew?null:JSON.parse(JSON.stringify(rec));
  const originalName=rec.name||'';
  const oldStoragePaths=recordStoragePaths(id?rec:null);
  const previousStatus=id?rec.status:'';
  const previousStatusDate=id?rec.statusDate:'';
  const now=new Date().toISOString();
  const actorName=SESSION?.fullName||'System';
  const changedFields=isNew?[]:EMP_FIELDS.filter(field=>String(original?.[field.key]??'')!==String(vals[field.key]??'')).map(field=>field.label);
  if(!isNew&&JSON.stringify(original?.homeAddress||{})!==JSON.stringify(vals.homeAddress||{}))changedFields.push('Home Address');
  if(!isNew&&JSON.stringify(original?.presentAddress||{})!==JSON.stringify(vals.presentAddress||{}))changedFields.push('Present Address');
  if(!isNew&&JSON.stringify(original?.allowances||{})!==JSON.stringify(vals.allowances||{}))changedFields.push('Allowances');
  Object.assign(rec, vals);
  if(!Array.isArray(rec.employmentHistory)) rec.employmentHistory=[];
  if(!Array.isArray(rec.recordHistory)) rec.recordHistory=[];
  if(isNew){
    Object.assign(rec,{createdAt:now,createdBy:SESSION?.id||null,createdByName:actorName,updatedAt:now,updatedBy:SESSION?.id||null,updatedByName:actorName});
    appendEmployeeRecordHistory(rec,'Created','Employee record created',now);
    rec.employmentHistory.push({type:'Employment Status',from:'',to:rec.status,effectiveDate:rec.statusDate||rec.dateHired,remarks:'Initial employee record',changedAt:now,changedBy:actorName});
  } else if(previousStatus!==rec.status || previousStatusDate!==rec.statusDate){
    rec.employmentHistory.push({type:'Employment Status',from:previousStatus||'',to:rec.status||'',effectiveDate:rec.statusDate||todayISO(),remarks:'Updated from Employee Information',changedAt:now,changedBy:actorName});
  }
  if(!isNew&&changedFields.length){
    const visible=changedFields.slice(0,4).join(', ');
    const remaining=changedFields.length-4;
    appendEmployeeRecordHistory(rec,'Updated',`Changed ${visible}${remaining>0?` and ${remaining} more`:''}`,now);
  }
  if(isNew) DB.employees.push(rec);
  const renamedReferences=isNew?[]:updateEmployeeNameReferences(originalName,rec.name);
  if(!(await saveDB())){
    if(isNew) DB.employees=DB.employees.filter(e=>e!==rec);
    else { restoreEmployeeNameReferences(renamedReferences); Object.keys(rec).forEach(key=>delete rec[key]); Object.assign(rec,original); }
    return;
  }
  if(!isNew&&normalizeEmployeeName(originalName)!==normalizeEmployeeName(rec.name)){
    const {error}=await supabase.from('hr_cases').update({employee_name:rec.name,updated_by:SESSION?.id||null}).ilike('employee_name',originalName);
    if(error) toast('Employee saved, but linked HR case names could not be updated: '+error.message,true);
  }
  logAudit((id?'Updated':'Added new')+' employee record: '+vals.name);
  const newStoragePaths=recordStoragePaths(rec); rememberCommittedRecordFiles(rec);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  await closeModal([...newStoragePaths]); renderNav(); await renderEmployeeOrigin();
  selectEmployeeDirectoryRow(rec.id);
  await openEmployeeProfile(rec.id);
  toast('Employee '+(id?'updated.':'added.'));
}
async function deleteEmployee(id){
  const emp = DB.employees.find(e=>e.id===id);
  if(!emp) return;
  const storagePaths=recordStoragePaths(emp);
  const originalIndex=DB.employees.indexOf(emp);
  DB.employees = DB.employees.filter(e=>e.id!==id);
  if(!(await saveDB())){ DB.employees.splice(originalIndex,0,emp); renderEmployees(); return; }
  logAudit('Deleted employee record: '+emp.name);
  await deleteStorageObjects(storagePaths); renderNav(); renderEmployees(); toast('Employee deleted.');
}
function openTransferForEmployee(id){
  const emp = DB.employees.find(e=>e.id===id);
  if(!emp) return;
  selectEmployeeDirectoryRow(emp.id);
  openEmployeeWorkspaceModal(`
    ${employeeWorkspaceHeader(emp,'Department Transfer')}
    <div class="modal-body">
      ${employeeWorkspaceNav(emp,'transfer')}
      <div class="formgrid">
        <div class="field full"><label>Employee</label><input value="${esc(employeeDisplayName(emp))}" disabled style="background:var(--paper);"></div>
        <div class="field"><label>Transferred From *</label><select id="tf_from">${employeeDepartmentNames(emp.department).map(d=>`<option ${d===emp.department?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label>From Date *</label><input type="date" id="tf_fromDate" value="${todayISO()}"></div>
        <div class="field"><label>Transferred To *</label><select id="tf_to" onchange="syncPositionSelect('tf_position',this.value)">${employeeDepartmentNames().map(d=>`<option ${d===emp.department?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label>To Date *</label><input type="date" id="tf_toDate" value="${todayISO()}"></div>
        <div class="field"><label>Position After Transfer *</label><select id="tf_position"><option value="">Select position</option>${employeePositionNames(emp.department,emp.position).map(position=>`<option value="${esc(position)}" ${position===emp.position?'selected':''}>${esc(position)}</option>`).join('')}</select></div>
        <div class="field full"><label>Remarks</label><textarea id="tf_remarks" rows="2"></textarea></div>
      </div>
      <div class="computed-note">This logs the move in Department Transfers and updates the employee's current department and status to "Transferred to Another Department".</div>
    </div>
    ${employeeWorkspaceFooter(emp,'Save Transfer',`saveEmployeeTransfer('${id}')`)}
  `);
}
async function saveEmployeeTransfer(id){
  const emp = DB.employees.find(e=>e.id===id);
  if(!emp) return;
  const fromDepartment = document.getElementById('tf_from').value;
  const fromDate = document.getElementById('tf_fromDate').value;
  const toDepartment = document.getElementById('tf_to').value;
  const toPosition = document.getElementById('tf_position').value;
  const toDate = document.getElementById('tf_toDate').value;
  const remarks = document.getElementById('tf_remarks').value.trim();
  if(!fromDate || !toDate || !toPosition){ toast('Set both transfer dates and the employee position after transfer.'); return; }
  if(fromDepartment===toDepartment){ toast('Transferred From and Transferred To must be different departments.'); return; }
  if(toDate < fromDate){ toast('The "To Date" cannot be before the "From Date".'); return; }
  if(!positionCatalog().some(item=>item.active&&item.department===toDepartment&&item.name===toPosition)){toast('Select an active position configured for the destination department.',true);return;}
  const transfer={id:uid(), employeeName:emp.name, fromDepartment, fromDate, toDepartment, toDate, position:toPosition, remarks};
  const original=JSON.parse(JSON.stringify(emp));
  DB.transfers.push(transfer);
  emp.department = toDepartment;
  emp.position = toPosition;
  emp.status = 'Transferred to Another Department';
  appendEmployeeRecordHistory(emp,'Transferred',`${fromDepartment} to ${toDepartment} · ${toPosition}`);
  if(!(await saveDB())){DB.transfers=DB.transfers.filter(row=>row!==transfer);Object.keys(emp).forEach(key=>delete emp[key]);Object.assign(emp,original);return;}
  logAudit(`Transferred ${employeeDisplayName(emp)} from ${fromDepartment} to ${toDepartment}`);
  await closeModal(); renderNav(); await renderEmployeeOrigin(); await openEmployeeProfile(id);
  toast('Transfer recorded.');
}
function employeeCompleteness(emp){
  const keys=['employeeNo','prfNumber','lastName','firstName','position','department','branchReporting','dateHired','birthDate','gender','civilStatus','mobileNumber','personalEmail','address','emergencyContactName','emergencyContactRelationship','emergencyContactPhone'];
  const normalized={...emp,...splitEmployeeName(emp)};
  const filled=keys.filter(k=>String(normalized?.[k]??'').trim()!=='').length;
  return Math.round((filled/keys.length)*100);
}
function employeeTenureText(emp){
  if(!emp?.dateHired) return 'Tenure unavailable';
  const start=new Date(emp.dateHired+'T00:00:00');
  const end=new Date();
  if(isNaN(start)) return 'Tenure unavailable';
  let months=(end.getFullYear()-start.getFullYear())*12+(end.getMonth()-start.getMonth());
  if(end.getDate()<start.getDate()) months--;
  if(months<1){ const days=Math.max(0,Math.floor((end-start)/86400000)); return `${days} day${days===1?'':'s'} in service`; }
  const years=Math.floor(months/12), rem=months%12;
  return years? `${years} yr${years===1?'':'s'}${rem?` ${rem} mo${rem===1?'':'s'}`:''} in service` : `${rem} mo${rem===1?'':'s'} in service`;
}
function openEmployeeStatusForm(id){
  if(!canEdit()) return;
  const emp=DB.employees.find(e=>e.id===id); if(!emp) return;
  selectEmployeeDirectoryRow(emp.id);
  openEmployeeWorkspaceModal(`
    ${employeeWorkspaceHeader(emp,'Employment Status')}
    <div class="modal-body">
      ${employeeWorkspaceNav(emp,'status')}
      <div class="formgrid">
        <div class="field"><label>Current Status</label><input value="${esc(emp.status||'—')}" disabled style="background:var(--paper);"></div>
        <div class="field"><label>New Status *</label><select id="es_status">${EMP_STATUS.map(s=>`<option value="${esc(s)}" ${s===emp.status?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Effective Date *</label><input type="date" id="es_date" value="${esc(emp.statusDate||todayISO())}"></div>
        <div class="field full"><label>Remarks</label><textarea id="es_remarks" rows="3" placeholder="Reason, supporting note, or HR reference…"></textarea></div>
      </div>
      <div class="computed-note">This update becomes part of the employee's employment history. Department transfers should continue to be recorded through the Transfer workflow.</div>
    </div>
    ${employeeWorkspaceFooter(emp,'Save Status',`saveEmployeeStatus('${id}')`)}
  `);
}
async function saveEmployeeStatus(id){
  if(!canEdit()) return;
  const emp=DB.employees.find(e=>e.id===id); if(!emp) return;
  const status=document.getElementById('es_status').value;
  const effectiveDate=document.getElementById('es_date').value;
  const remarks=document.getElementById('es_remarks').value.trim();
  if(!effectiveDate){ toast('Please set an effective date.'); return; }
  if(effectiveDate<emp.dateHired){ toast('Status Effective Date cannot be before Date Hired.'); return; }
  if(status===emp.status && effectiveDate===(emp.statusDate||'')){ toast('No status change was made.'); return; }
  const from=emp.status||'';
  const original=JSON.parse(JSON.stringify(emp));
  emp.status=status;
  emp.statusDate=effectiveDate;
  if(!Array.isArray(emp.employmentHistory)) emp.employmentHistory=[];
  emp.employmentHistory.push({type:'Employment Status',from,to:status,effectiveDate,remarks,changedAt:new Date().toISOString(),changedBy:SESSION?.fullName||'System'});
  appendEmployeeRecordHistory(emp,'Status',`${from||'Unspecified'} to ${status}`);
  if(!(await saveDB())){Object.keys(emp).forEach(key=>delete emp[key]);Object.assign(emp,original);return;}
  logAudit(`Updated employment status for ${employeeDisplayName(emp)}: ${from||'—'} → ${status}`);
  await closeModal();
  renderNav();
  await renderEmployeeOrigin();
  await openEmployeeProfile(id);
  toast('Employment status updated.');
}

function exportEmployeesCSV(){
  if(!requireExportAccess())return;
  const allowanceNames=uniqueSettingNames([...employeeAllowanceTypes(),...DB.employees.flatMap(employee=>Object.keys(employee.allowances||{}))]);
  const columns=[
    {header:'Employee No.',get:r=>r.employeeNo},{header:'PRF Number',get:r=>r.prfNumber},{header:'Last Name',get:r=>splitEmployeeName(r).lastName},{header:'First Name',get:r=>splitEmployeeName(r).firstName},{header:'Middle Name',get:r=>splitEmployeeName(r).middleName},{header:'Formatted Name',get:r=>employeeDisplayName(r)},
    {header:'Position',get:r=>r.position},{header:'Department',get:r=>r.department},{header:'Branch Reporting',get:r=>r.branchReporting},{header:'Daily Rate',get:r=>r.dailyRate},{header:'Total Allowances',get:r=>employeeAllowanceTotal(r)},
    ...allowanceNames.map(name=>({header:`Allowance - ${name}`,get:r=>r.allowances?.[name]??''})),
    {header:'Date Hired',get:r=>r.dateHired},{header:'Birth Date',get:r=>r.birthDate},{header:'Gender',get:r=>r.gender},{header:'Civil Status',get:r=>r.civilStatus},
    {header:'Employment Status',get:r=>r.status},{header:'Status Effective Date',get:r=>r.statusDate},{header:'Classification Override',get:r=>r.classOverride||'Auto'},{header:'Computed Classification',get:r=>classify(r)},
    {header:'Mobile Number',get:r=>r.mobileNumber},{header:'Personal Email',get:r=>r.personalEmail},
    {header:'Home Address',get:r=>formatPhilippineAddress(r.homeAddress)||r.address},{header:'Home Region Code',get:r=>r.homeAddress?.regionCode},{header:'Home Province Code',get:r=>r.homeAddress?.provinceCode},{header:'Home City/Municipality Code',get:r=>r.homeAddress?.cityCode},{header:'Home Barangay Code',get:r=>r.homeAddress?.barangayCode},
    {header:'Present Address',get:r=>formatPhilippineAddress(r.presentAddress)||r.presentAddressText},{header:'Present Region Code',get:r=>r.presentAddress?.regionCode},{header:'Present Province Code',get:r=>r.presentAddress?.provinceCode},{header:'Present City/Municipality Code',get:r=>r.presentAddress?.cityCode},{header:'Present Barangay Code',get:r=>r.presentAddress?.barangayCode},
    {header:'Remarks',get:r=>r.remarks},{header:'Emergency Contact Name',get:r=>r.emergencyContactName},{header:'Emergency Contact Relationship',get:r=>r.emergencyContactRelationship},{header:'Emergency Contact Phone',get:r=>r.emergencyContactPhone},
    {header:'BIR TIN',get:r=>formatGovernmentId('tin',r.tin)},{header:'SSS Number',get:r=>formatGovernmentId('sss',r.sssNumber)},{header:'PhilHealth PIN',get:r=>formatGovernmentId('philHealth',r.philHealthNumber)},{header:'Pag-IBIG MID',get:r=>formatGovernmentId('pagIbig',r.pagIbigNumber)},
    {header:'Created At',get:r=>r.createdAt},{header:'Created By',get:r=>r.createdByName},{header:'Updated At',get:r=>r.updatedAt},{header:'Updated By',get:r=>r.updatedByName},
  ];
  if(!employeeSpreadsheetReady()){
    downloadCSV('employees_complete_export.csv',toCSV(DB.employees,columns.map(column=>({label:column.header,get:column.get}))));
    return;
  }
  const rows=DB.employees.map(employee=>Object.fromEntries(columns.map(column=>[column.header,column.get(employee)??''])));
  const employeeSheet=window.XLSX.utils.json_to_sheet(rows,{header:columns.map(column=>column.header)});
  employeeSheet['!cols']=columns.map(column=>({wch:Math.min(48,Math.max(14,column.header.length+2))}));
  employeeSheet['!autofilter']={ref:`A1:${window.XLSX.utils.encode_col(columns.length-1)}${Math.max(1,rows.length+1)}`};
  const employmentHistory=[];const recordHistory=[];
  DB.employees.forEach(employee=>{
    (employee.employmentHistory||[]).forEach(item=>employmentHistory.push({'Employee No.':employee.employeeNo||'','Employee':employeeDisplayName(employee),'Event Type':item.type||'','From':item.from||'','To':item.to||'','Effective Date':item.effectiveDate||'','Remarks':item.remarks||'','Changed At':item.changedAt||'','Changed By':item.changedBy||''}));
    (employee.recordHistory||[]).forEach(item=>recordHistory.push({'Employee No.':employee.employeeNo||'','Employee':employeeDisplayName(employee),'Action':item.action||'','Detail':item.detail||'','Date/Time':item.at||'','User':item.by||''}));
  });
  const workbook=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(workbook,employeeSheet,'Employees');
  const employmentSheet=window.XLSX.utils.json_to_sheet(employmentHistory);employmentSheet['!cols']=[{wch:16},{wch:30},{wch:26},{wch:22},{wch:22},{wch:18},{wch:48},{wch:24},{wch:28}];window.XLSX.utils.book_append_sheet(workbook,employmentSheet,'Employment History');
  const recordSheet=window.XLSX.utils.json_to_sheet(recordHistory);recordSheet['!cols']=[{wch:16},{wch:30},{wch:18},{wch:55},{wch:24},{wch:28}];window.XLSX.utils.book_append_sheet(workbook,recordSheet,'Record History');
  window.XLSX.writeFile(workbook,`SLSC_Employees_${todayISO()}.xlsx`);toast(`Exported ${DB.employees.length} complete employee records.`);
}

async function openEmployeeProfile(id){
  const emp=DB.employees.find(e=>e.id===id);
  if(!emp){ toast('Employee record could not be found.',true); return; }
  selectEmployeeDirectoryRow(emp.id);
  const nameKey=normalizeEmployeeName(emp.name);
  const sameName=(rows)=>rows.filter(r=>normalizeEmployeeName(r.employeeName||r.name)===nameKey);
  const leaves=sameName(DB.leaves), discipline=sameName(DB.disciplinary), cvr=sameName(DB.cvr), incidents=sameName(DB.incidents), nte=sameName(DB.nte), memos=sameName(DB.memos), nod=sameName(DB.nod), atd=sameName(DB.atd), transfers=sameName(DB.transfers);
  const evaluations=DB.evaluations.filter(r=>String(r.employeeId)===String(emp.id));
  const atdBalance=atd.reduce((sum,r)=>sum+Math.max(0,(Number(r.totalAmount)||0)-atdTotalPaid(r)),0);
  let cases=[];
  try{
    const {data,error}=await supabase.from('hr_cases').select('id,case_number,status,subject,opened_at,updated_at').ilike('employee_name',emp.name).order('updated_at',{ascending:false}).limit(20);
    if(!error) cases=data||[];
  }catch(e){}
  const initials=opsInitials(employeeDisplayName(emp));
  const activities=[
    ...leaves.map(r=>({date:r.startDate,type:'Leave',title:r.leaveType||'Leave Record',meta:r.status||''})),
    ...discipline.map(r=>({date:r.dateOfIncident,type:'Disciplinary',title:r.violation||'Disciplinary Action',meta:r.action||''})),
    ...cvr.map(r=>({date:r.dateOfCVR,type:'CVR',title:[...(r.offenses||[]),...(r.otherOffense?[r.otherOffense]:[])].join(', ')||'CVR / Violation Report',meta:r.status||''})),
    ...incidents.map(r=>({date:r.dateOfIncident,type:'Incident',title:[...(r.incidentTypes||[]),...(r.otherType?[r.otherType]:[])].join(', ')||'Incident Report',meta:r.status||''})),
    ...nte.map(r=>({date:r.dateReceived,type:'NTE',title:r.subject||r.violation||'Notice to Explain',meta:r.status||''})),
    ...memos.map(r=>({date:r.dateOfMemorandum||r.dateOfMemo||r.dateReceived,type:'Memo',title:r.subject||r.title||'Memorandum of Offense',meta:r.status||''})),
    ...nod.map(r=>({date:r.dateOfNod,type:'NOD',title:r.subject||r.finalAction||'Notice of Decision',meta:r.finalAction||''})),
    ...atd.map(r=>({date:r.atdDate,type:'ATD',title:r.deductionType||'ATD Record',meta:r.status||''})),
    ...transfers.map(r=>({date:r.toDate||r.fromDate,type:'Transfer',title:(r.fromDepartment||'')+' → '+(r.toDepartment||''),meta:'Department Transfer'})),
    ...cases.map(r=>({date:r.opened_at,type:'HR Case',title:r.case_number+' · '+(r.subject||'HR Case'),meta:r.status||''}))
  ].filter(x=>x.date).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,14);
  const statusMap=EMP_STATUS_MAP;
  const recordHistory=Array.isArray(emp.recordHistory)?emp.recordHistory.slice().reverse().slice(0,20):[];
  const allowanceEntries=employeeAllowanceEntries(emp);
  openEmployeeWorkspaceModal(`${employeeWorkspaceHeader(emp,'Overview')}<div class="modal-body">
    ${employeeWorkspaceNav(emp,'overview')}
    <div class="profile-hero"><div class="profile-avatar">${esc(initials)}</div><div><div class="profile-title">${esc(employeeDisplayName(emp))}</div><div class="profile-sub">${esc(emp.employeeNo||'—')} · ${esc(emp.position||'—')} · ${esc(emp.department||'Unassigned')}</div><div class="profile-chips">${statusBadge(emp.status,statusMap)} ${statusBadge(classify(emp),classify(emp)==='Regular'?{'Regular':'b-green'}:{'Probationary':'b-amber'})}</div><div class="small" style="margin-top:6px;">${esc(employeeTenureText(emp))}</div></div><div class="profile-actions">${canEdit()?`<button class="btn btn-ghost btn-sm" onclick="openEmployeeOperation('cases','${emp.id}')">${iShield(13)} New HR Case</button>`:''}</div></div>
    <div class="employee-completeness"><div style="min-width:0;"><div style="font-size:11px;font-weight:700;color:var(--ink);">Master Data Completion</div><div style="font-size:10px;color:var(--slate);">${employeeCompleteness(emp)}% of standard employee fields completed</div></div><div class="bar"><div class="fill" style="width:${employeeCompleteness(emp)}%;"></div></div><div class="pct">${employeeCompleteness(emp)}%</div></div>
    <div class="profile-kpis">
      <div class="profile-kpi"><div class="k">HR Cases</div><div class="v">${cases.length}</div><div class="s">Case history</div></div>
      <div class="profile-kpi"><div class="k">Leave Records</div><div class="v">${leaves.length}</div><div class="s">Requests on file</div></div>
      <div class="profile-kpi"><div class="k">Discipline / Incidents</div><div class="v">${discipline.length+cvr.length+incidents.length}</div><div class="s">Recorded activity</div></div>
      <div class="profile-kpi"><div class="k">ATD Balance</div><div class="v">${peso(atdBalance)}</div><div class="s">Outstanding balance</div></div>
    </div>
    <div class="profile-grid">
      <div class="panel"><h3>Employment Information</h3><div class="desc">Current employee master record.</div><div class="profile-detail">
        <div class="item"><div class="label">Employee No.</div><div class="value mono">${esc(emp.employeeNo||'—')}</div></div>
        <div class="item"><div class="label">Employee Name</div><div class="value">${esc(employeeDisplayName(emp))}</div></div>
        <div class="item"><div class="label">Position</div><div class="value">${esc(emp.position||'—')}</div></div>
        <div class="item"><div class="label">Department</div><div class="value">${esc(emp.department||'—')}</div></div>
        <div class="item"><div class="label">Branch Reporting</div><div class="value">${esc(emp.branchReporting||'Not assigned')}</div></div>
        <div class="item"><div class="label">Date Hired</div><div class="value">${fmtDate(emp.dateHired)}</div></div>
        <div class="item"><div class="label">Gender</div><div class="value">${esc(emp.gender||'—')}</div></div>
        <div class="item"><div class="label">Employment Status</div><div class="value">${esc(emp.status||'—')}</div></div>
        <div class="item"><div class="label">Status Effective Date</div><div class="value">${fmtDate(emp.statusDate)}</div></div>
        <div class="item"><div class="label">PRF Number</div><div class="value">${esc(emp.prfNumber||'—')}</div></div>
        <div class="item" style="grid-column:1/-1;"><div class="label">Remarks</div><div class="value">${esc(emp.remarks||'—')}</div></div>
      </div></div>
      <div class="panel"><h3>Compensation</h3><div class="desc">Current daily rate and configured employee allowances.</div><div class="profile-detail">
        <div class="item"><div class="label">Daily Rate</div><div class="value">${emp.dailyRate!==''&&emp.dailyRate!=null?peso(emp.dailyRate):'—'}</div></div>
        ${allowanceEntries.map(item=>`<div class="item"><div class="label">${esc(item.name)}</div><div class="value">${peso(item.amount)}</div></div>`).join('')||'<div class="item"><div class="label">Allowances</div><div class="value">None recorded</div></div>'}
        <div class="item"><div class="label">Total Allowances</div><div class="value">${peso(employeeAllowanceTotal(emp))}</div></div>
      </div></div>
      <div class="panel"><h3>Contact &amp; Emergency Information</h3><div class="desc">Personal contact details recorded for HR operations.</div><div class="profile-detail">
        <div class="item"><div class="label">Birth Date</div><div class="value">${fmtDate(emp.birthDate)}</div></div>
        <div class="item"><div class="label">Civil Status</div><div class="value">${esc(emp.civilStatus||'—')}</div></div>
        <div class="item"><div class="label">Mobile</div><div class="value">${esc(emp.mobileNumber||'—')}</div></div>
        <div class="item"><div class="label">Email</div><div class="value">${esc(emp.personalEmail||'—')}</div></div>
        <div class="item" style="grid-column:1/-1;"><div class="label">Home Address</div><div class="value">${esc(formatPhilippineAddress(emp.homeAddress)||emp.address||'—')}</div></div>
        <div class="item" style="grid-column:1/-1;"><div class="label">Present Address</div><div class="value">${esc(formatPhilippineAddress(emp.presentAddress)||emp.presentAddressText||'—')}</div></div>
        <div class="item"><div class="label">Emergency Contact</div><div class="value">${esc(emp.emergencyContactName||'—')}</div></div>
        <div class="item"><div class="label">Relationship</div><div class="value">${esc(emp.emergencyContactRelationship||'—')}</div></div>
        <div class="item"><div class="label">Emergency Phone</div><div class="value">${esc(emp.emergencyContactPhone||'—')}</div></div>
      </div></div>
      <div class="panel"><h3>Government Identifiers</h3><div class="desc">Optional statutory identifiers validated at entry.</div><div class="profile-detail">
        <div class="item"><div class="label">BIR TIN</div><div class="value mono">${esc(formatGovernmentId('tin',emp.tin)||'—')}</div></div>
        <div class="item"><div class="label">SSS Number</div><div class="value mono">${esc(formatGovernmentId('sss',emp.sssNumber)||'—')}</div></div>
        <div class="item"><div class="label">PhilHealth PIN</div><div class="value mono">${esc(formatGovernmentId('philHealth',emp.philHealthNumber)||'—')}</div></div>
        <div class="item"><div class="label">Pag-IBIG MID</div><div class="value mono">${esc(formatGovernmentId('pagIbig',emp.pagIbigNumber)||'—')}</div></div>
      </div></div>
      <div class="panel"><h3>Record Summary</h3><div class="desc">Activity across connected HR modules.</div><div class="profile-statline">
        <div class="profile-detail"><div class="item"><div class="label">NTE</div><div class="value">${nte.length}</div></div><div class="item"><div class="label">Memoranda</div><div class="value">${memos.length}</div></div></div>
        <div class="profile-detail"><div class="item"><div class="label">NOD</div><div class="value">${nod.length}</div></div><div class="item"><div class="label">Evaluations</div><div class="value">${evaluations.length}</div></div></div>
        <div class="profile-detail"><div class="item"><div class="label">Transfers</div><div class="value">${transfers.length}</div></div><div class="item"><div class="label">On-File CVR</div><div class="value">${cvr.length}</div></div></div>
        <div class="profile-detail"><div class="item"><div class="label">Incidents</div><div class="value">${incidents.length}</div></div><div class="item"><div class="label">ATD Records</div><div class="value">${atd.length}</div></div></div>
      </div></div>
    </div>
    <div class="panel" style="margin-top:14px;"><div class="dashboard-panel-head"><div><h3>Employment History</h3><div class="desc">Status changes recorded from the employee master record.</div></div></div>
      ${Array.isArray(emp.employmentHistory)&&emp.employmentHistory.length?`<div class="employee-history">${emp.employmentHistory.slice().reverse().slice(0,12).map(h=>`<div class="employee-history-row"><div class="dot"></div><div class="date">${fmtDate(h.effectiveDate||String(h.changedAt||'').slice(0,10))}</div><div><div class="title">${esc(h.from||'Initial')} ${h.from?'→ ':''}${esc(h.to||'—')}</div><div class="meta">${esc(h.remarks||'No remarks')} · ${esc(h.changedBy||'System')}</div></div><div class="right">${statusBadge(h.to||'—',EMP_STATUS_MAP)}</div></div>`).join('')}</div>`:'<div class="empty"><b>No employment history</b>Status changes will appear here as they are recorded.</div>'}
    </div>
    <div class="panel" style="margin-top:14px;"><div class="dashboard-panel-head"><div><h3>Record History</h3><div class="desc">Who created or updated this employee master record.</div></div></div>
      ${recordHistory.length?`<div class="employee-record-history">${recordHistory.map(entry=>`<div><span class="record-history-action">${esc(entry.action||'Updated')}</span><span><b>${esc(entry.by||'System')}</b><small>${esc(entry.detail||'Employee record updated')}</small></span><time>${new Date(entry.at).toLocaleString()}</time></div>`).join('')}</div>`:`<div class="empty"><b>No record audit available</b>Creation and update history will be captured from the next saved change.</div>`}
    </div>
    <div class="panel" style="margin-top:14px;"><div class="dashboard-panel-head"><div><h3>Recent HR Activity</h3><div class="desc">Latest records across the employee's HR history.</div></div></div>
      ${activities.length?`<div class="profile-list">${activities.map(a=>`<div class="profile-list-row"><div class="main"><div class="title">${esc(a.type)} · ${esc(a.title)}</div><div class="meta">${esc(a.meta||'')}</div></div><div class="right">${fmtDate(String(a.date).slice(0,10))}</div></div>`).join('')}</div>`:'<div class="empty"><b>No HR activity yet</b>This employee does not have additional records across the tracked modules.</div>'}
    </div>
    <div class="panel" style="margin-top:14px;"><div class="dashboard-panel-head"><div><h3>HR Case History</h3><div class="desc">Cases currently associated with this employee.</div></div></div>
      ${cases.length?`<div class="profile-list">${cases.slice(0,8).map(c=>`<div class="profile-list-row"><div class="main"><div class="title">${esc(c.case_number)} · ${esc(c.subject||'HR Case')}</div><div class="meta">Opened ${fmtDate(c.opened_at)} · Updated ${fmtDate(String(c.updated_at).slice(0,10))}</div></div><div class="right">${statusBadge(c.status,CASE_STATUS_MAP)}<div style="margin-top:5px;"><button class="btn btn-ghost btn-sm" onclick="openCaseDetails('${c.id}')">Open</button></div></div></div>`).join('')}</div>`:'<div class="empty"><b>No HR cases</b>No central case file is currently associated with this employee.</div>'}
    </div>
  </div><div class="modal-foot employee-workspace-foot"><span class="small">Selected employee: ${esc(employeeDisplayName(emp))}</span><div class="toolbar-spacer"></div><button class="btn btn-ghost" onclick="closeModal()">Back to Directory</button></div>`);
}

/* ================================================================
   LEAVE TRACKER (custom — has tabs: Records / Calendar)
   ================================================================ */
function renderLeaves(){
  setTitle('Leave Tracker', 'Upload, monitor, and manage employee leave records.');
  const tab = STATE.leaveTab||'records';
  const html = `
  <div class="sectionhead">
    <div><h2>Leave Tracker</h2><p>${DB.leaves.length} leave requests on record.</p></div>
    <div class="page-header-actions">${informationNoteButton('leaveUploads')}${canEdit()? `<button class="btn btn-brass" onclick="openRecordForm('leaves')">${iPlus(15)} Add Leave Record</button>`:''}</div>
  </div>
  <div class="tabs">
    <button class="tabbtn ${tab==='records'?'active':''}" onclick="STATE.leaveTab='records'; renderLeaves()">Leave Records</button>
    <button class="tabbtn ${tab==='calendar'?'active':''}" onclick="STATE.leaveTab='calendar'; renderLeaves()">Leave Calendar</button>
    <button class="tabbtn ${tab==='summary'?'active':''}" onclick="STATE.leaveTab='summary'; renderLeaves()">Summary</button>
  </div>
  <div id="leave-sub"></div>
  `;
  document.getElementById('content').innerHTML = html;
  if(tab==='records') renderLeaveRecords();
  else if(tab==='calendar') renderLeaveCalendar();
  else renderLeaveSummary();
}
function renderLeaveRecords(){
  const q=(STATE.search||'').toLowerCase();
  let rows = DB.leaves.filter(l=> !q || l.employeeName.toLowerCase().includes(q) || (l.department||'').toLowerCase().includes(q));
  if(STATE.filter) rows = rows.filter(l=>l.status===STATE.filter);
  rows = rows.slice().sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||''));
  document.getElementById('leave-sub').innerHTML = `
    <div class="toolbar">
      <div class="search">${iSearch(15)}<input data-search-key="search" placeholder="Search by employee or department…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderLeaveRecords)"></div>
      <select onchange="STATE.filter=this.value; renderLeaveRecords()">
        <option value="">All Status</option>${LEAVE_STATUS.map(s=>`<option ${STATE.filter===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <div class="spacer"></div>
      ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportModuleCSV('leaves')">${iDownload(14)} Export CSV</button>`:''}
    </div>
    <div class="tablewrap"><table class="data-table">
      <thead><tr><th>Employee</th><th>Department</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Attachment</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
      <tbody>
      ${rows.length? rows.map(l=>`<tr>
        <td><b>${esc(l.employeeName)}</b></td><td>${esc(l.department||'—')}</td><td>${esc(l.leaveType)}</td>
        <td>${fmtDate(l.startDate)}</td><td>${fmtDate(l.endDate)}</td><td>${daysBetweenInclusive(l.startDate,l.endDate)||'—'}</td>
        <td>${attachCellHTML('leaves',l,'attachment')}</td>
        <td>${statusBadge(l.status, LEAVE_STATUS_MAP)}</td>
        <td><div class="rowactions">${canEdit()?`<button class="iconbtn" onclick="openRecordForm('leaves','${l.id}')">${iEdit(14)}</button><button class="iconbtn" onclick="deleteRecord('leaves','${l.id}')">${iTrash(14)}</button>`:'<span class="small">View only</span>'}</div></td>
      </tr>`).join('') : `<tr><td colspan="9"><div class="empty"><b>No leave records</b>Add a leave record to begin tracking.</div></td></tr>`}
      </tbody></table></div>`;
}
function renderLeaveSummary(){
  const byDept={}, byEmp={};
  DB.leaves.forEach(l=>{ const d=l.department||'Unassigned'; byDept[d]=(byDept[d]||0)+1; byEmp[l.employeeName]=(byEmp[l.employeeName]||0)+1; });
  const onLeave = DB.leaves.filter(l=>l.startDate<=todayISO()&&l.endDate>=todayISO());
  const upcoming = DB.leaves.filter(l=>l.startDate>todayISO());
  const completed = DB.leaves.filter(l=>l.endDate<todayISO());
  document.getElementById('leave-sub').innerHTML = `
    <div class="grid cols-4" style="margin-bottom:16px;">
      <div class="stat" style="--accent:var(--forest)"><div class="lbl">Currently on Leave</div><div class="val">${onLeave.length}</div></div>
      <div class="stat" style="--accent:var(--ink)"><div class="lbl">Upcoming Leaves</div><div class="val">${upcoming.length}</div></div>
      <div class="stat" style="--accent:var(--slate)"><div class="lbl">Completed Leaves</div><div class="val">${completed.length}</div></div>
      <div class="stat" style="--accent:var(--brass)"><div class="lbl">Total Requests</div><div class="val">${DB.leaves.length}</div></div>
    </div>
    <div class="grid cols-2">
      <div class="panel"><h3>Leave Summary by Department</h3>${Object.keys(byDept).length? Object.entries(byDept).map(([d,c])=>`<div class="barrow"><div class="name">${esc(d)}</div><div class="bartrack"><div class="barfill" style="width:${Math.round(c/DB.leaves.length*100)}%"></div></div><div class="amt">${c}</div></div>`).join(''):'<div class="small">No data yet.</div>'}</div>
      <div class="panel"><h3>Leave Summary by Employee</h3>${Object.keys(byEmp).length? Object.entries(byEmp).map(([n,c])=>`<div class="barrow"><div class="name">${esc(n)}</div><div class="bartrack"><div class="barfill" style="width:${Math.round(c/DB.leaves.length*100)}%"></div></div><div class="amt">${c}</div></div>`).join(''):'<div class="small">No data yet.</div>'}</div>
    </div>`;
}
function renderLeaveCalendar(){
  const y=STATE.calYear, m=STATE.calMonth;
  const first=new Date(y,m,1); const startDow=first.getDay();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const monthName=first.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const cells=[]; for(let i=0;i<startDow;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(d);
  const dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayStr = todayISO();
  function leavesOn(dateStr){ return DB.leaves.filter(l=> l.startDate<=dateStr && l.endDate>=dateStr); }

  let grid = `<div class="calgrid">` + dow.map(d=>`<div class="caldow">${d}</div>`).join('');
  cells.forEach(d=>{
    if(d===null){ grid+=`<div class="calday out"></div>`; return; }
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const onLeave = leavesOn(dateStr);
    const isToday = dateStr===todayStr;
    const isSel = STATE.calSel===dateStr;
    grid += `<div class="calday ${isToday?'today':''} ${isSel?'sel':''}" onclick="STATE.calSel='${dateStr}'; renderLeaveCalendar()">
      <div class="dn">${d}</div>
      <div class="dots">${onLeave.slice(0,5).map(()=>'<span></span>').join('')}</div>
    </div>`;
  });
  grid += `</div>`;

  const selList = STATE.calSel? leavesOn(STATE.calSel) : [];
  document.getElementById('leave-sub').innerHTML = `
    <div class="panel">
      <div class="cal-head">
        <div class="mo">${monthName}</div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="calShift(-1)">&larr; Prev</button>
          <button class="btn btn-ghost btn-sm" onclick="calShift(1)">Next &rarr;</button>
        </div>
      </div>
      ${grid}
      <div class="cal-panel">
        <b style="font-size:13px;">${STATE.calSel? 'On leave — '+fmtDate(STATE.calSel) : 'Select a date to see who is on leave'}</b>
        ${selList.length? selList.map(l=>`<div class="cal-list-item"><span>${esc(l.employeeName)} <span class="small">(${esc(l.leaveType)})</span></span><span>${statusBadge(l.status,LEAVE_STATUS_MAP)}</span></div>`).join('') : (STATE.calSel?'<div class="small" style="padding-top:8px;">No one is on leave this day.</div>':'')}
      </div>
    </div>`;
}
function calShift(dir){
  STATE.calMonth += dir;
  if(STATE.calMonth<0){STATE.calMonth=11; STATE.calYear--;}
  if(STATE.calMonth>11){STATE.calMonth=0; STATE.calYear++;}
  renderLeaveCalendar();
}

/* ================================================================
   DISCIPLINARY (custom — offense counting)
   ================================================================ */
function offenseLevelFor(emp, violation, beforeId){
  const prior = DB.disciplinary.filter(d=> d.employeeName===emp && d.violation===violation && d.id!==beforeId);
  const n = prior.length; // this record will be n+1'th
  return OFFENSE_LEVELS[Math.min(n, OFFENSE_LEVELS.length-1)];
}
function renderDisciplinary(){
  setTitle('Disciplinary Action', "Monitor violations, offense levels, and actions taken per employee.");
  const q=(STATE.search||'').toLowerCase();
  let rows = DB.disciplinary.filter(d=> !q || String(d.employeeName||'').toLowerCase().includes(q) || (d.violation||'').toLowerCase().includes(q));
  if(STATE.disciplinaryFilter) rows=rows.filter(d=>offenseLevelFor(d.employeeName,d.violation,d.id)===STATE.disciplinaryFilter || d.department===STATE.disciplinaryFilter);
  rows = rows.slice().sort((a,b)=>(b.dateOfIncident||'').localeCompare(a.dateOfIncident||''));
  const html = `
  <div class="sectionhead">
    <div><h2>Disciplinary Action</h2><p>${DB.disciplinary.length} records across ${new Set(DB.disciplinary.map(d=>d.employeeName)).size} employees.</p></div>
    <div class="page-header-actions">${informationNoteButton('disciplinaryLevels')}${canEdit()? `<button class="btn btn-brass" onclick="openRecordForm('disciplinary')">${iPlus(15)} Add Disciplinary Record</button>`:''}</div>
  </div>
  <div class="toolbar">
    <div class="search">${iSearch(15)}<input data-search-key="search" placeholder="Search by employee or violation…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderDisciplinary)"></div>
    <select onchange="STATE.disciplinaryFilter=this.value;STATE.tablePages={};renderDisciplinary()"><option value="">All Levels / Departments</option>${OFFENSE_LEVELS.map(v=>`<option value="${esc(v)}" ${STATE.disciplinaryFilter===v?'selected':''}>${esc(v)}</option>`).join('')}${employeeDepartmentNames().map(v=>`<option value="${esc(v)}" ${STATE.disciplinaryFilter===v?'selected':''}>${esc(v)}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" onclick="STATE.disciplinaryFilter='';STATE.search='';STATE.tablePages={};renderDisciplinary()">Clear</button>
    <div class="spacer"></div>
    ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportModuleCSV('disciplinary')">${iDownload(14)} Export CSV</button>`:''}
  </div>
  <div class="tablewrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Department</th><th>Violation</th><th>Offense Level</th><th>Date</th><th>Action Taken</th><th style="text-align:right;">Actions</th></tr></thead>
    <tbody>
    ${rows.length? rows.map(d=>`<tr>
      <td><b>${esc(d.employeeName)}</b></td><td>${esc(d.department||'—')}</td><td>${esc(d.violation)}</td>
      <td>${statusBadge(offenseLevelFor(d.employeeName,d.violation,d.id), {}) }</td>
      <td>${fmtDate(d.dateOfIncident)}</td><td>${esc(d.action||'—')}</td>
      <td><div class="rowactions">${canEdit()?`<button class="iconbtn" title="HR Case" onclick="openRecordCaseDialog('disciplinary','${d.id}')">${iShield(14)}</button><button class="iconbtn" onclick="openRecordForm('disciplinary','${d.id}')">${iEdit(14)}</button><button class="iconbtn" onclick="deleteRecord('disciplinary','${d.id}')">${iTrash(14)}</button>`:'<span class="small">View only</span>'}</div></td>
    </tr>`).join('') : `<tr><td colspan="8"><div class="empty"><b>No disciplinary records</b>Add a record to begin tracking violations.</div></td></tr>`}
    </tbody></table></div>
  <div class="panel" style="margin-top:16px;">
    <h3>Offense Count by Employee</h3>
    <div class="desc">Total disciplinary entries per employee, across all violation types.</div>
    ${(()=>{ const c={}; DB.disciplinary.forEach(d=>c[d.employeeName]=(c[d.employeeName]||0)+1);
      const entries = Object.entries(c).sort((a,b)=>b[1]-a[1]);
      return entries.length? entries.map(([n,v])=>`<div class="barrow"><div class="name">${esc(n)}</div><div class="bartrack"><div class="barfill" style="width:${Math.round(v/Math.max(...entries.map(e=>e[1]))*100)}%"></div></div><div class="amt">${v}</div></div>`).join('') : '<div class="small">No data yet.</div>'; })()}
  </div>`;
  document.getElementById('content').innerHTML = html;
}

/* ================================================================
   CVR / VIOLATION REPORTS (custom — checklist offenses, auto level
   + consequence lookup from the Offense Catalog, file attachment)
   ================================================================ */
function cvrOffenseLevel(employeeName, offenseName, beforeId){
  const prior = DB.cvr.filter(c=> c.id!==beforeId && c.employeeName===employeeName && (c.offenses||[]).includes(offenseName));
  const idx = Math.min(prior.length, OFFENSE_LEVELS.length-1);
  return {label: OFFENSE_LEVELS[idx], index: idx};
}
function consequenceFor(offenseName, levelIndex){
  const cat = DB.offenseCatalog.find(o=> o.offense.trim().toLowerCase()===offenseName.trim().toLowerCase());
  if(!cat) return `Not in Offense Catalog — add "${offenseName}" there to define its consequence.`;
  const c = [cat.consequence1,cat.consequence2,cat.consequence3,cat.consequence4][levelIndex];
  return c || cat.consequence4 || '—';
}
function cvrOffenseSummaryHTML(rec){
  const list = [...(rec.offenses||[]), ...(rec.otherOffense? [rec.otherOffense]:[])];
  if(!list.length) return '<span class="small">—</span>';
  return list.map(o=>{
    const lvl = cvrOffenseLevel(rec.employeeName, o, rec.id);
    const cons = consequenceFor(o, lvl.index);
    return `<div style="margin-bottom:6px;"><b>${esc(o)}</b> ${statusBadge(lvl.label,{})}<div class="small" style="margin-top:2px;">${esc(cons)}</div></div>`;
  }).join('');
}
function renderCVR(){
  setTitle('CVR / Violation Reports', "Check or write the offense from an employee's CVR — level and consequence are computed automatically.");
  const q=(STATE.search||'').toLowerCase();
  let rows = DB.cvr.filter(c=> !q || String(c.employeeName||'').toLowerCase().includes(q) || (c.offenses||[]).join(' ').toLowerCase().includes(q) || (c.otherOffense||'').toLowerCase().includes(q));
  if(STATE.cvrFilter) rows=rows.filter(c=>c.status===STATE.cvrFilter);
  rows = rows.slice().sort((a,b)=>(b.dateOfCVR||'').localeCompare(a.dateOfCVR||''));
  const html = `
  <div class="sectionhead">
    <div><h2>CVR / Violation Reports</h2><p>${DB.cvr.length} CVRs on record across ${new Set(DB.cvr.map(c=>c.employeeName)).size} employees.</p></div>
    <div class="page-header-actions">${informationNoteButton('cvrOcr')}${canEdit()? `<button class="btn btn-brass" onclick="openCVRForm()">${iPlus(15)} Add CVR</button>`:''}</div>
  </div>
  <div class="toolbar">
    <div class="search">${iSearch(15)}<input data-search-key="search" placeholder="Search by employee or offense…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderCVR)"></div>
    <select onchange="STATE.cvrFilter=this.value;STATE.tablePages={};renderCVR()"><option value="">All CVR Statuses</option>${CVR_STATUS.map(v=>`<option value="${esc(v)}" ${STATE.cvrFilter===v?'selected':''}>${esc(v)}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" onclick="STATE.cvrFilter='';STATE.search='';STATE.tablePages={};renderCVR()">Clear</button>
    <div class="spacer"></div>
    ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportCVRCSV()">${iDownload(14)} Export CSV</button>`:''}
  </div>
  <div class="tablewrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Department</th><th>Date</th><th>Offense(s) &amp; Level</th><th>Attachment</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
    <tbody>
    ${rows.length? rows.map(c=>`<tr>
      <td><b>${esc(c.employeeName)}</b></td><td>${esc(c.department||'—')}</td><td>${fmtDate(c.dateOfCVR)}</td>
      <td style="min-width:220px;">${cvrOffenseSummaryHTML(c)}</td>
      <td>${attachCellHTML('cvr',c,'attachment')}</td>
      <td>${statusBadge(c.status, CVR_STATUS_MAP)}</td>
      <td><div class="rowactions">${canEdit()?`<button class="iconbtn" title="HR Case" onclick="openRecordCaseDialog('cvr','${c.id}')">${iShield(14)}</button><button class="iconbtn" onclick="openCVRForm('${c.id}')">${iEdit(14)}</button><button class="iconbtn" onclick="deleteCVR('${c.id}')">${iTrash(14)}</button>`:'<span class="small">View only</span>'}</div></td>
    </tr>`).join('') : `<tr><td colspan="8"><div class="empty"><b>No CVRs yet</b>Add a CVR to begin tracking checked or written offenses.</div></td></tr>`}
    </tbody></table></div>
  <div class="panel" style="margin-top:16px;">
    <h3>Repeated Offenses by Employee</h3>
    <div class="desc">Total CVRs per employee — highlights who has recurring violations.</div>
    ${(()=>{ const c={}; DB.cvr.forEach(r=>c[r.employeeName]=(c[r.employeeName]||0)+1);
      const entries = Object.entries(c).sort((a,b)=>b[1]-a[1]);
      return entries.length? entries.map(([n,v])=>`<div class="barrow"><div class="name">${esc(n)}</div><div class="bartrack"><div class="barfill" style="width:${Math.round(v/Math.max(...entries.map(e=>e[1]))*100)}%"></div></div><div class="amt">${v}</div></div>`).join('') : '<div class="small">No data yet.</div>'; })()}
  </div>`;
  document.getElementById('content').innerHTML = html;
}
function openCVRForm(id){
  const existing = id? DB.cvr.find(c=>c.id===id): null;
  const checked = existing? (existing.offenses||[]) : [];
  openModal(`
    <div class="modal-head"><h3>${existing?'Edit':'Add'} CVR</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="formgrid">
        ${employeePickerHTML({id:'cv_employeeName',label:'Employee Name',selectedId:existing?.employeeId||'',selectedName:existing?.employeeName||'',mode:'name',required:true})}
        <div class="field"><label>Department *</label><select id="cv_department">${employeeDepartmentNames(existing?.department||'').map(d=>`<option ${existing&&existing.department===d?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label>Date of CVR *</label><input type="date" id="cv_date" value="${existing?existing.dateOfCVR:todayISO()}"></div>
        <div class="field"><label>Status</label><select id="cv_status">${CVR_STATUS.map(s=>`<option ${(existing?existing.status:CVR_STATUS[0])===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
        <div class="field full">
          <label>Offense(s) Checked</label>
          <div class="checklist">
            ${DB.offenseCatalog.length? DB.offenseCatalog.map(o=>`<label class="checkrow"><input type="checkbox" value="${esc(o.offense)}" ${checked.includes(o.offense)?'checked':''}> ${esc(o.offense)}</label>`).join('') : '<div class="small">No offenses in the catalog yet — add them under Offense Catalog, or write one in below.</div>'}
          </div>
        </div>
        <div class="field full"><label>Other / Additional Offense (write-in, not in catalog)</label><input id="cv_other" value="${esc((existing&&existing.otherOffense)||'')}"></div>
        ${fieldHTML({key:'attachment', label:'Uploaded CVR Document', type:'file', full:true, storagePrefix:'cvr', existingData:(existing&&existing.attachmentData)||''}, existing?existing.attachment:'')}
        <div class="field full"><label>Remarks</label><textarea id="cv_remarks" rows="2">${esc((existing&&existing.remarks)||'')}</textarea></div>
      </div>
      <div class="computed-note">Offense level (1st/2nd/3rd/4th+) and consequence are computed automatically per offense from this employee's CVR history and the Offense Catalog — no need to set them manually.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveCVR('${id||''}')">Save CVR</button></div>
  `);
}
async function saveCVR(id){
  const employeeName = document.getElementById('cv_employeeName').value.trim();
  const employeeId = employeePickerSelected('cv_employeeName')?.id||'';
  const department = document.getElementById('cv_department').value;
  const dateOfCVR = document.getElementById('cv_date').value;
  const status = document.getElementById('cv_status').value;
  const otherOffense = document.getElementById('cv_other').value.trim();
  const remarks = document.getElementById('cv_remarks').value.trim();
  const offenses = Array.from(document.querySelectorAll('#modal input[type=checkbox]:checked')).map(el=>el.value);
  const attachment = document.getElementById('f_attachment').value;
  const attachmentData = document.getElementById('f_attachment_data').value;
  if(!employeeName || !department || !dateOfCVR){ toast('Please complete employee, department, and date.'); return; }
  if(!offenses.length && !otherOffense){ toast('Check at least one offense, or write one in.'); return; }
  const rec=id?DB.cvr.find(c=>c.id===id):{id:uid()};
  const oldStoragePaths=recordStoragePaths(id?rec:null);
  Object.assign(rec,{employeeId,employeeName, department, dateOfCVR, status, offenses, otherOffense, attachment, attachmentData, remarks});
  if(!id) DB.cvr.push(rec);
  logAudit(`${id?'Updated':'Added'} CVR for ${employeeName}`); toast(`CVR ${id?'updated.':'added.'}`);
  await saveDB();
  const newStoragePaths=recordStoragePaths(rec); rememberCommittedRecordFiles(rec);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  await closeModal([...newStoragePaths]); renderNav(); renderCVR();
}
function deleteCVR(id){
  DB.cvr = DB.cvr.filter(c=>c.id!==id);
  logAudit('Deleted a CVR record');
  saveDB(); renderNav(); renderCVR(); toast('CVR deleted.');
}
function exportCVRCSV(){
  if(!requireExportAccess())return;
  const csv = toCSV(DB.cvr, [
    {label:'Employee', get:r=>r.employeeName},{label:'Department', get:r=>r.department},
    {label:'Date', get:r=>r.dateOfCVR},
    {label:'Offenses', get:r=>[...(r.offenses||[]),...(r.otherOffense?[r.otherOffense]:[])].join('; ')},
    {label:'Status', get:r=>r.status},{label:'Remarks', get:r=>r.remarks},
  ]);
  downloadCSV('cvr_export.csv', csv);
  toast('CSV exported.');
}

/* ================================================================
   INCIDENT REPORTS (custom — checklist incident types, auto repeat
   count per employee/type, file attachment; mirrors CVR)
   ================================================================ */
function incidentTypeOccurrence(employeeName, typeName, beforeId){
  const prior = DB.incidents.filter(i=> i.id!==beforeId && i.employeeName===employeeName && (i.incidentTypes||[]).includes(typeName));
  return prior.length+1;
}
function nthLabel(n){ return n===1?'1st time':n===2?'2nd time':n===3?'3rd time':n+'th time'; }
function incidentTypeSummaryHTML(rec){
  const list = [...(rec.incidentTypes||[]), ...(rec.otherType? [rec.otherType]:[])];
  if(!list.length) return '<span class="small">—</span>';
  return list.map(t=>{
    const n = incidentTypeOccurrence(rec.employeeName, t, rec.id);
    return `<div style="margin-bottom:4px;"><b>${esc(t)}</b> ${statusBadge(nthLabel(n),{})}</div>`;
  }).join('');
}
function renderIncidents(){
  setTitle('Incident Reports', "Check or write the incident type from a printed report — repeat occurrences per employee are counted automatically.");
  const q=(STATE.search||'').toLowerCase();
  let rows = DB.incidents.filter(i=> !q || String(i.employeeName||'').toLowerCase().includes(q) || (i.incidentTypes||[]).join(' ').toLowerCase().includes(q) || (i.otherType||'').toLowerCase().includes(q) || (i.description||'').toLowerCase().includes(q));
  if(STATE.incidentFilter) rows=rows.filter(i=>i.status===STATE.incidentFilter || i.severity===STATE.incidentFilter);
  rows = rows.slice().sort((a,b)=>(b.dateOfIncident||'').localeCompare(a.dateOfIncident||''));
  const html = `
  <div class="sectionhead">
    <div><h2>Incident Reports</h2><p>${DB.incidents.length} incident reports on record across ${new Set(DB.incidents.map(i=>i.employeeName)).size} employees.</p></div>
    <div class="page-header-actions">${informationNoteButton('incidentOcr')}${canEdit()? `<button class="btn btn-brass" onclick="openIncidentForm()">${iPlus(15)} Add Incident Report</button>`:''}</div>
  </div>
  <div class="toolbar">
    <div class="search">${iSearch(15)}<input data-search-key="search" placeholder="Search by employee, type, or description…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderIncidents)"></div>
    <select onchange="STATE.incidentFilter=this.value;STATE.tablePages={};renderIncidents()"><option value="">All Severity / Status</option>${INCIDENT_SEVERITY.map(v=>`<option value="${esc(v)}" ${STATE.incidentFilter===v?'selected':''}>${esc(v)}</option>`).join('')}${INCIDENT_STATUS.map(v=>`<option value="${esc(v)}" ${STATE.incidentFilter===v?'selected':''}>${esc(v)}</option>`).join('')}</select>
    <button class="btn btn-ghost btn-sm" onclick="STATE.incidentFilter='';STATE.search='';STATE.tablePages={};renderIncidents()">Clear</button>
    <div class="spacer"></div>
    ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportIncidentsCSV()">${iDownload(14)} Export CSV</button>`:''}
  </div>
  <div class="tablewrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Department</th><th>Date</th><th>Incident Type(s)</th><th>Severity</th><th>Attachment</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
    <tbody>
    ${rows.length? rows.map(i=>`<tr>
      <td><b>${esc(i.employeeName)}</b></td><td>${esc(i.department||'—')}</td><td>${fmtDate(i.dateOfIncident)}</td>
      <td style="min-width:180px;">${incidentTypeSummaryHTML(i)}</td>
      <td>${statusBadge(i.severity, INCIDENT_SEVERITY_MAP)}</td>
      <td>${attachCellHTML('incidents',i,'attachment')}</td>
      <td>${statusBadge(i.status, INCIDENT_STATUS_MAP)}</td>
      <td><div class="rowactions">${canEdit()?`<button class="iconbtn" title="HR Case" onclick="openRecordCaseDialog('incidents','${i.id}')">${iShield(14)}</button><button class="iconbtn" onclick="openIncidentForm('${i.id}')">${iEdit(14)}</button><button class="iconbtn" onclick="deleteIncident('${i.id}')">${iTrash(14)}</button>`:'<span class="small">View only</span>'}</div></td>
    </tr>`).join('') : `<tr><td colspan="8"><div class="empty"><b>No incident reports yet</b>Add a report to begin tracking.</div></td></tr>`}
    </tbody></table></div>
  <div class="panel" style="margin-top:16px;">
    <h3>Repeated Incidents by Employee</h3>
    <div class="desc">Total incident reports per employee — highlights recurring involvement.</div>
    ${(()=>{ const c={}; DB.incidents.forEach(r=>c[r.employeeName]=(c[r.employeeName]||0)+1);
      const entries = Object.entries(c).sort((a,b)=>b[1]-a[1]);
      return entries.length? entries.map(([n,v])=>`<div class="barrow"><div class="name">${esc(n)}</div><div class="bartrack"><div class="barfill" style="width:${Math.round(v/Math.max(...entries.map(e=>e[1]))*100)}%"></div></div><div class="amt">${v}</div></div>`).join('') : '<div class="small">No data yet.</div>'; })()}
  </div>`;
  document.getElementById('content').innerHTML = html;
}
function openIncidentForm(id){
  const existing = id? DB.incidents.find(i=>i.id===id): null;
  const checked = existing? (existing.incidentTypes||[]) : [];
  openModal(`
    <div class="modal-head"><h3>${existing?'Edit':'Add'} Incident Report</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="formgrid">
        ${employeePickerHTML({id:'in_employeeName',label:'Employee Name',selectedId:existing?.employeeId||'',selectedName:existing?.employeeName||'',mode:'name',required:true})}
        <div class="field"><label>Department *</label><select id="in_department">${employeeDepartmentNames(existing?.department||'').map(d=>`<option ${existing&&existing.department===d?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label>Date of Incident *</label><input type="date" id="in_date" value="${existing?existing.dateOfIncident:todayISO()}"></div>
        <div class="field"><label>Severity</label><select id="in_severity">${INCIDENT_SEVERITY.map(s=>`<option ${(existing?existing.severity:INCIDENT_SEVERITY[0])===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
        <div class="field full">
          <label>Incident Type(s) Checked</label>
          <div class="checklist">
            ${INCIDENT_TYPES.map(t=>`<label class="checkrow"><input type="checkbox" value="${esc(t)}" ${checked.includes(t)?'checked':''}> ${esc(t)}</label>`).join('')}
          </div>
        </div>
        <div class="field full"><label>Other / Additional Type (write-in)</label><input id="in_other" value="${esc((existing&&existing.otherType)||'')}"></div>
        <div class="field full"><label>Description *</label><textarea id="in_description" rows="3">${esc((existing&&existing.description)||'')}</textarea></div>
        <div class="field"><label>Status</label><select id="in_status">${INCIDENT_STATUS.map(s=>`<option ${(existing?existing.status:INCIDENT_STATUS[0])===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
        ${fieldHTML({key:'attachment', label:'Uploaded Incident Report Document', type:'file', full:true, storagePrefix:'incident', existingData:(existing&&existing.attachmentData)||''}, existing?existing.attachment:'')}
        <div class="field full"><label>Remarks</label><textarea id="in_remarks" rows="2">${esc((existing&&existing.remarks)||'')}</textarea></div>
      </div>
      <div class="computed-note">Repeat-occurrence count per incident type is computed automatically from this employee's incident history — no need to set it manually.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveIncident('${id||''}')">Save Incident Report</button></div>
  `);
}
async function saveIncident(id){
  const employeeName = document.getElementById('in_employeeName').value.trim();
  const employeeId = employeePickerSelected('in_employeeName')?.id||'';
  const department = document.getElementById('in_department').value;
  const dateOfIncident = document.getElementById('in_date').value;
  const severity = document.getElementById('in_severity').value;
  const otherType = document.getElementById('in_other').value.trim();
  const description = document.getElementById('in_description').value.trim();
  const status = document.getElementById('in_status').value;
  const remarks = document.getElementById('in_remarks').value.trim();
  const incidentTypes = Array.from(document.querySelectorAll('#modal input[type=checkbox]:checked')).map(el=>el.value);
  const attachment = document.getElementById('f_attachment').value;
  const attachmentData = document.getElementById('f_attachment_data').value;
  if(!employeeName || !department || !dateOfIncident || !description){ toast('Please complete employee, department, date, and description.'); return; }
  if(!incidentTypes.length && !otherType){ toast('Check at least one incident type, or write one in.'); return; }
  const rec=id?DB.incidents.find(i=>i.id===id):{id:uid()};
  const oldStoragePaths=recordStoragePaths(id?rec:null);
  Object.assign(rec,{employeeId,employeeName, department, dateOfIncident, severity, incidentTypes, otherType, description, status, attachment, attachmentData, remarks});
  if(!id) DB.incidents.push(rec);
  logAudit(`${id?'Updated':'Added'} Incident Report for ${employeeName}`); toast(`Incident report ${id?'updated.':'added.'}`);
  await saveDB();
  const newStoragePaths=recordStoragePaths(rec); rememberCommittedRecordFiles(rec);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  await closeModal([...newStoragePaths]); renderNav(); renderIncidents();
}
function deleteIncident(id){
  DB.incidents = DB.incidents.filter(i=>i.id!==id);
  logAudit('Deleted an incident report');
  saveDB(); renderNav(); renderIncidents(); toast('Incident report deleted.');
}
function exportIncidentsCSV(){
  if(!requireExportAccess())return;
  const csv = toCSV(DB.incidents, [
    {label:'Employee', get:r=>r.employeeName},{label:'Department', get:r=>r.department},
    {label:'Date', get:r=>r.dateOfIncident},
    {label:'Types', get:r=>[...(r.incidentTypes||[]),...(r.otherType?[r.otherType]:[])].join('; ')},
    {label:'Severity', get:r=>r.severity},{label:'Description', get:r=>r.description},
    {label:'Status', get:r=>r.status},{label:'Remarks', get:r=>r.remarks},
  ]);
  downloadCSV('incidents_export.csv', csv);
  toast('CSV exported.');
}

/* ================================================================
   WEEKLY REPORT (headcount + disciplinary + leave, by date range)
   ================================================================ */
function mondayOf(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day===0? -6 : 1-day);
  d.setDate(d.getDate()+diff);
  return d.toISOString().slice(0,10);
}
function addDaysISO(dateStr, n){ const d=new Date(dateStr+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function inRange(dateStr, start, end){ return dateStr && dateStr>=start && dateStr<=end; }
function overlapsRange(startA, endA, start, end){ if(!startA) return false; const e = endA||startA; return startA<=end && e>=start; }
function weeklyShiftWeek(days){
  STATE.weekStart = addDaysISO(STATE.weekStart || mondayOf(todayISO()), days);
  renderWeeklyReport();
}
function toggleWeeklyCat(cat){
  STATE.weeklyOpenCat = STATE.weeklyOpenCat===cat? null : cat;
  renderWeeklyReport();
}
function renderWeeklyReport(){
  if(!STATE.weekStart) STATE.weekStart = mondayOf(todayISO());
  const start = STATE.weekStart, end = addDaysISO(start,6);
  setTitle('Weekly Report', 'Employee movements, disciplinary activity, and leave for the selected week.');

  const newlyHired = DB.employees.filter(e=>inRange(e.dateHired, start, end));
  const resigned = DB.employees.filter(e=>e.status==='Resigned' && inRange(e.statusDate, start, end));
  const awol = DB.employees.filter(e=>e.status==='AWOL' && inRange(e.statusDate, start, end));
  const separated = DB.employees.filter(e=>e.status==='Separated' && inRange(e.statusDate, start, end));
  const transferred = DB.transfers.filter(t=>inRange(t.toDate, start, end));

  const cats = [
    {key:'hired', label:'Newly Hired', rows:newlyHired, color:'b-blue'},
    {key:'resigned', label:'Resigned', rows:resigned, color:'b-grey'},
    {key:'awol', label:'AWOL', rows:awol, color:'b-red'},
    {key:'transferred', label:'Transferred', rows:transferred, color:'b-blue'},
    {key:'separated', label:'Separated', rows:separated, color:'b-red'},
  ];

  const cvrWeek = DB.cvr.filter(c=>inRange(c.dateOfCVR, start, end));
  const nteWeek = DB.nte.filter(n=>inRange(n.dateReceived, start, end));
  const nodWeek = DB.nod.filter(n=>inRange(n.dateOfNod, start, end));
  const disciplinaryRows = [
    ...cvrWeek.map(c=>({employeeName:c.employeeName, department:c.department, type:'CVR', detail:[...(c.offenses||[]),...(c.otherOffense?[c.otherOffense]:[])].join(', '), date:c.dateOfCVR, status:c.status})),
    ...nteWeek.map(n=>({employeeName:n.employeeName, department:n.department, type:'NTE', detail:n.violation||'', date:n.dateReceived, status:n.status})),
    ...nodWeek.map(n=>({employeeName:n.employeeName, department:n.department, type:'NOD', detail:n.finalAction||'', date:n.dateOfNod, status:n.finalAction? 'Decided':'—'})),
  ].sort((a,b)=>(a.date||'').localeCompare(b.date||''));

  const leaveWeek = DB.leaves.filter(l=>overlapsRange(l.startDate, l.endDate, start, end));
  const oncallWeek = DB.oncall.filter(o=>overlapsRange(o.startDate, o.endDate, start, end));

  const html = `
  <div class="sectionhead">
    <div><h2>Weekly Report</h2><p>${fmtDate(start)} – ${fmtDate(end)}</p></div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-ghost btn-sm" onclick="weeklyShiftWeek(-7)">&lsaquo; Prev Week</button>
      <button class="btn btn-ghost btn-sm" onclick="STATE.weekStart=mondayOf(todayISO()); renderWeeklyReport();">This Week</button>
      <button class="btn btn-ghost btn-sm" onclick="weeklyShiftWeek(7)">Next Week &rsaquo;</button>
      ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportWeeklyCSV()">${iDownload(14)} Export CSV</button>`:''}
    </div>
  </div>

  <div class="grid cols-5" style="gap:10px;">
    ${cats.map(c=>`
      <div class="stat" style="--accent:var(--brass);cursor:pointer;${STATE.weeklyOpenCat===c.key?'outline:2px solid var(--brass);':''}" onclick="toggleWeeklyCat('${c.key}')">
        <div class="lbl">${c.label}</div><div class="val">${c.rows.length}</div><div class="sub">Click to view</div>
      </div>`).join('')}
  </div>

  ${(()=>{ const open = cats.find(c=>c.key===STATE.weeklyOpenCat); if(!open) return '';
    return `<div class="tablewrap" style="margin-top:14px;"><table class="data-table">
      <thead><tr><th>Employee</th><th>Department</th>${open.key==='transferred'?'<th>From</th><th>To</th><th>Date</th>':'<th>Status</th><th>Date</th>'}</tr></thead>
      <tbody>${open.rows.length? open.rows.map(r=> open.key==='transferred'? `<tr><td><b>${esc(r.employeeName)}</b></td><td>${esc(r.department||'—')}</td><td>${esc(r.fromDepartment)}</td><td>${esc(r.toDepartment)}</td><td>${fmtDate(r.toDate)}</td></tr>` : `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.department||'—')}</td><td>${statusBadge(r.status, EMP_STATUS_MAP)}</td><td>${fmtDate(r.statusDate||r.dateHired)}</td></tr>` ).join('') : `<tr><td colspan="5"><div class="empty"><b>None this week</b></div></td></tr>`}</tbody>
    </table></div>`; })()}

  <div class="panel" style="margin-top:18px;">
    <h3>Weekly Disciplinary Activity</h3>
    <div class="desc">${disciplinaryRows.length} CVR / NTE / NOD record(s) dated this week.</div>
    ${disciplinaryRows.length? `<div class="tablewrap"><table class="data-table">
      <thead><tr><th>Employee</th><th>Department</th><th>Type</th><th>Detail</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>${disciplinaryRows.map(r=>`<tr><td><b>${esc(r.employeeName)}</b></td><td>${esc(r.department||'—')}</td><td>${esc(r.type)}</td><td>${esc(r.detail||'—')}</td><td>${fmtDate(r.date)}</td><td>${esc(r.status||'—')}</td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="small">No disciplinary activity dated within this week.</div>'}
  </div>

  <div class="panel" style="margin-top:14px;">
    <h3>Weekly Leave</h3>
    <div class="desc">${leaveWeek.length} leave record(s) overlapping this week.</div>
    ${leaveWeek.length? `<div class="tablewrap"><table class="data-table">
      <thead><tr><th>Employee</th><th>Department</th><th>Type</th><th>Start</th><th>End</th><th>Status</th><th>On-Call Replacement</th></tr></thead>
      <tbody>${leaveWeek.map(l=>{ const rep = DB.oncall.find(o=>o.employeeReplaced && o.employeeReplaced.toLowerCase()===l.employeeName.toLowerCase() && overlapsRange(o.startDate,o.endDate,start,end)); return `<tr><td><b>${esc(l.employeeName)}</b></td><td>${esc(l.department||'—')}</td><td>${esc(l.leaveType)}</td><td>${fmtDate(l.startDate)}</td><td>${fmtDate(l.endDate)}</td><td>${statusBadge(l.status, LEAVE_STATUS_MAP)}</td><td>${rep? esc(rep.employeeName) : '<span class="small">—</span>'}</td></tr>`; }).join('')}</tbody>
    </table></div>` : '<div class="small">No leave overlapping this week.</div>'}
  </div>

  <div class="panel" style="margin-top:14px;">
    <h3>Weekly On-Call</h3>
    <div class="desc">${oncallWeek.length} on-call / replacement personnel active during this week.</div>
    ${oncallWeek.length? `<div class="tablewrap"><table class="data-table">
      <thead><tr><th>Employee</th><th>Department</th><th>PRF No.</th><th>Replacing</th><th>Reason</th><th>Start</th><th>End</th><th>Attachment</th><th>Status</th></tr></thead>
      <tbody>${oncallWeek.map(o=>`<tr><td><b>${esc(o.employeeName)}</b></td><td>${esc(o.department||'—')}</td><td>${esc(o.prfNumber||'—')}</td><td>${esc(o.employeeReplaced||'—')}</td><td>${esc(o.reason||'—')}</td><td>${fmtDate(o.startDate)}</td><td>${fmtDate(o.endDate)}</td><td>${attachCellHTML('oncall',o,'attachment')}</td><td>${statusBadge(o.status, ONCALL_STATUS_MAP)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="small">No on-call assignments active during this week.</div>'}
  </div>

  <div class="panel" style="margin-top:14px;">
    <h3>ATD Monitoring</h3>
    <div class="desc">All ${DB.atd.length} Authority to Deduct record(s) — deductions completed or still outstanding. <a href="#" onclick="go('atd'); return false;" style="color:var(--brass);">Open full ATD module →</a></div>
    ${DB.atd.length? `<div class="tablewrap"><table class="data-table">
      <thead><tr><th>Employee</th><th>Department</th><th>Category</th><th>Total Due</th><th>Paid</th><th>Remaining</th><th>Status</th><th>Payment Schedule</th><th>Latest Update</th></tr></thead>
      <tbody>${DB.atd.map(r=>{ const pays=(r.payments||[]).slice().sort((a,b)=>(a.dateRecorded||'').localeCompare(b.dateRecorded||'')); const latest=pays[pays.length-1];
        return `<tr><td><b>${esc(r.employeeName)}</b></td><td>${esc(r.department||'—')}</td><td>${esc(r.category)}</td><td>${peso(r.totalAmount)}</td><td>${peso(atdTotalPaid(r))}</td><td>${peso(atdRemaining(r))}</td><td>${statusBadge(atdComputeStatus(r), ATD_STATUS_MAP)}</td><td>${esc(r.paymentTerms||'—')}</td><td>${latest? esc(latest.month)+' '+esc(latest.cutoff)+' · '+fmtDate(latest.dateRecorded) : '<span class="small">No payments yet</span>'}</td></tr>`; }).join('')}</tbody>
    </table></div>` : '<div class="small">No ATD records on file.</div>'}
  </div>`;
  document.getElementById('content').innerHTML = html;
}
function exportWeeklyCSV(){
  if(!requireExportAccess())return;
  const start = STATE.weekStart || mondayOf(todayISO()), end = addDaysISO(start,6);
  const rows = [];
  DB.employees.forEach(e=>{
    if(inRange(e.dateHired,start,end)) rows.push({employeeName:e.name, department:e.department, category:'Newly Hired', date:e.dateHired});
    if(e.status==='Resigned' && inRange(e.statusDate,start,end)) rows.push({employeeName:e.name, department:e.department, category:'Resigned', date:e.statusDate});
    if(e.status==='AWOL' && inRange(e.statusDate,start,end)) rows.push({employeeName:e.name, department:e.department, category:'AWOL', date:e.statusDate});
    if(e.status==='Separated' && inRange(e.statusDate,start,end)) rows.push({employeeName:e.name, department:e.department, category:'Separated', date:e.statusDate});
  });
  DB.transfers.filter(t=>inRange(t.toDate,start,end)).forEach(t=>rows.push({employeeName:t.employeeName, department:t.toDepartment, category:`Transferred (${t.fromDepartment} → ${t.toDepartment})`, date:t.toDate}));
  DB.oncall.filter(o=>overlapsRange(o.startDate,o.endDate,start,end)).forEach(o=>rows.push({employeeName:o.employeeName, department:o.department, category:`On-Call (replacing ${o.employeeReplaced||'—'})`, date:o.startDate}));
  const csv = toCSV(rows, [
    {label:'Employee', get:r=>r.employeeName},{label:'Department', get:r=>r.department},
    {label:'Category', get:r=>r.category},{label:'Date', get:r=>r.date},
  ]);
  downloadCSV(`weekly_report_${start}_to_${end}.csv`, csv);
  toast('Weekly CSV exported.');
}

/* ================================================================
   ATD MONITORING (Authority to Deduct — payment tracking)
   ================================================================ */
function atdTotalPaid(r){ return (r.payments||[]).reduce((s,p)=>s+(parseFloat(p.amountPaid)||0),0); }
function atdRemaining(r){ return Math.max(0, (parseFloat(r.totalAmount)||0) - atdTotalPaid(r)); }
function atdComputeStatus(r){ const paid=atdTotalPaid(r); if(paid<=0) return 'Pending'; return atdRemaining(r)<=0 ? 'Paid' : 'Ongoing'; }
function peso(n){ return '₱'+(parseFloat(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function renderATD(){
  setTitle('ATD Monitoring', 'Authority to Deduct — uniforms/expenses and charges, payment tracking by month and cut-off.');
  const q=(STATE.search||'').toLowerCase();
  let rows = DB.atd.filter(r=>{
    if(!q) return true;
    return (r.employeeName||'').toLowerCase().includes(q) || (r.department||'').toLowerCase().includes(q) || (r.deductionType||'').toLowerCase().includes(q);
  });
  if(STATE.filter) rows = rows.filter(r=>r.category===STATE.filter || r.status===STATE.filter);
  rows = rows.slice().sort((a,b)=>(b.atdDate||'').localeCompare(a.atdDate||''));

  const totalRecords = DB.atd.length;
  const totalOutstanding = DB.atd.reduce((s,r)=>s+(parseFloat(r.totalAmount)||0),0);
  const totalCollected = DB.atd.reduce((s,r)=>s+atdTotalPaid(r),0);
  const totalRemaining = DB.atd.reduce((s,r)=>s+atdRemaining(r),0);
  const byStatus = {Pending:0,Ongoing:0,Paid:0}; DB.atd.forEach(r=>byStatus[atdComputeStatus(r)]++);
  const byDept = {}; DB.atd.forEach(r=>{ const d=r.department||'Unassigned'; byDept[d]=(byDept[d]||0)+1; });
  const byCat = {}; ATD_CATEGORIES.forEach(c=>byCat[c]=DB.atd.filter(r=>r.category===c).length);

  const html = `
  <div class="sectionhead">
    <div><h2>ATD Monitoring</h2><p>${totalRecords} record(s) — uniform/expense and charge deductions.</p></div>
    <div class="page-header-actions">${informationNoteButton('atdUploads')}${canEdit()? `<button class="btn btn-brass" onclick="openATDForm()">${iPlus(15)} New ATD Record</button>`:''}</div>
  </div>
  <div class="grid cols-4" style="margin-bottom:16px;">
    <div class="stat" style="--accent:var(--brass)"><div class="lbl">Total ATD Records</div><div class="val">${totalRecords}</div><div class="sub">${byCat['Uniforms/Expenses']} Uniforms/Expenses · ${byCat['Charges']} Charges</div></div>
    <div class="stat" style="--accent:var(--ink)"><div class="lbl">Total Amount Due</div><div class="val" style="font-size:20px;">${peso(totalOutstanding)}</div></div>
    <div class="stat" style="--accent:var(--forest)"><div class="lbl">Total Collected</div><div class="val" style="font-size:20px;">${peso(totalCollected)}</div></div>
    <div class="stat" style="--accent:var(--rust)"><div class="lbl">Remaining Balance</div><div class="val" style="font-size:20px;">${peso(totalRemaining)}</div><div class="sub">${byStatus.Pending} Pending · ${byStatus.Ongoing} Ongoing · ${byStatus.Paid} Paid</div></div>
  </div>
  <div class="toolbar">
    <div class="search">${iSearch(15)}<input data-search-key="search" placeholder="Search employee, department, deduction type…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderATD)"></div>
    <select onchange="STATE.filter=this.value; renderATD()">
      <option value="">All Categories / Status</option>
      <optgroup label="Category">${ATD_CATEGORIES.map(c=>`<option value="${esc(c)}" ${STATE.filter===c?'selected':''}>${esc(c)}</option>`).join('')}</optgroup>
      <optgroup label="Status">${Object.keys(ATD_STATUS_MAP).map(s=>`<option value="${esc(s)}" ${STATE.filter===s?'selected':''}>${esc(s)}</option>`).join('')}</optgroup>
    </select>
    <div class="spacer"></div>
    ${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportATDCSV()">${iDownload(14)} Export CSV</button>`:''}
  </div>
  <div class="tablewrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Department</th><th>Category</th><th>Deduction</th><th>Total</th><th>Paid</th><th>Remaining</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
    <tbody>
    ${rows.length? rows.map(r=>`<tr>
      <td><b>${esc(r.employeeName)}</b><div class="small">${fmtDate(r.atdDate)}</div></td>
      <td>${esc(r.department||'—')}</td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.deductionType||'—')}</td>
      <td>${peso(r.totalAmount)}</td>
      <td>${peso(atdTotalPaid(r))}</td>
      <td>${peso(atdRemaining(r))}</td>
      <td>${statusBadge(atdComputeStatus(r), ATD_STATUS_MAP)}</td>
      <td><div class="rowactions">
        <button class="btn btn-ghost btn-sm" onclick="openATDPayments('${r.id}')">Payments (${(r.payments||[]).length})</button>
        ${canEdit()? `<button class="iconbtn" onclick="openATDForm('${r.id}')" title="Edit">${iEdit(14)}</button>
        <button class="iconbtn" onclick="deleteATDRecord('${r.id}')" title="Delete">${iTrash(14)}</button>`:''}
      </div></td>
    </tr>`).join('') : `<tr><td colspan="9"><div class="empty"><b>No ATD records yet</b>Create a new ATD record to get started.</div></td></tr>`}
    </tbody></table></div>

  <div class="grid cols-2" style="margin-top:16px;">
    <div class="panel"><h3>By Department</h3>
      ${Object.keys(byDept).length? Object.entries(byDept).sort((a,b)=>b[1]-a[1]).map(([d,c])=>`<div class="barrow"><div class="name">${esc(d)}</div><div class="bartrack"><div class="barfill" style="width:${Math.round(c/totalRecords*100)||0}%"></div></div><div class="amt">${c}</div></div>`).join('') : '<div class="small">No records yet.</div>'}
    </div>
    <div class="panel"><h3>By Category</h3>
      ${ATD_CATEGORIES.map(c=>{ const n=byCat[c]; return `<div class="barrow"><div class="name">${esc(c)}</div><div class="bartrack"><div class="barfill" style="width:${totalRecords?Math.round(n/totalRecords*100):0}%"></div></div><div class="amt">${n}</div></div>`; }).join('')}
    </div>
  </div>`;
  document.getElementById('content').innerHTML = html;
}

function openATDForm(id){
  const existing = id? DB.atd.find(r=>r.id===id) : null;
  const cat = existing? existing.category : 'Uniforms/Expenses';
  openModal(`
    <div class="modal-head"><h3>${existing?'Edit':'New'} ATD Record</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="formgrid" id="atd-form">
        ${employeePickerHTML({id:'f_employeeName',label:'Employee',selectedId:existing?.employeeId||'',selectedName:existing?.employeeName||'',mode:'name',required:true,onSelect:'atdFillEmployee'})}
        <div class="field"><label>Department</label><input id="f_department" value="${esc(existing?existing.department:'')}"></div>
        <div class="field"><label>Position</label><input id="f_position" value="${esc(existing?existing.position:'')}"></div>
        <div class="field"><label>ATD Category *</label><select id="f_category" onchange="atdToggleCategory()">
          ${ATD_CATEGORIES.map(c=>`<option value="${esc(c)}" ${cat===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select></div>
        <div class="field"><label>ATD Date *</label><input type="date" id="f_atdDate" value="${existing?existing.atdDate:todayISO()}"></div>
        <div class="field"><label>Deduction Type / Reason *</label><input id="f_deductionType" value="${esc(existing?existing.deductionType:'')}" placeholder="e.g. Uniform cost, Negligence — damaged equipment"></div>
        <div class="field"><label>Total ATD Amount (₱) *</label><input type="number" step="0.01" id="f_totalAmount" value="${existing?existing.totalAmount:''}"></div>
        <div class="field"><label>Payment Terms / Installment</label><input id="f_paymentTerms" value="${esc(existing?existing.paymentTerms:'')}" placeholder="e.g. 3 cut-offs"></div>
        ${fieldHTML({key:'atdForm', label:'ATD Form', type:'file', full:true, storagePrefix:'atd', existingData:existing?existing.atdFormData:''}, existing?existing.atdForm:'')}
        <div id="atd-charges-fields" style="display:${cat==='Charges'?'contents':'none'}">
          ${fieldHTML({key:'incidentReport', label:'Incident Report (IR)', type:'file', storagePrefix:'atd', existingData:existing?existing.incidentReportData:''}, existing?existing.incidentReport:'')}
          ${fieldHTML({key:'quotation', label:'Quotation / SOA Basis', type:'file', storagePrefix:'atd', existingData:existing?existing.quotationData:''}, existing?existing.quotation:'')}
          <div class="field"><label>Statement of Account (SOA) Amount (₱)</label><input type="number" step="0.01" id="f_soaAmount" value="${existing?existing.soaAmount||'':''}"></div>
        </div>
        <div class="field full"><label>Remarks</label><textarea id="f_remarks" rows="2">${esc(existing?existing.remarks:'')}</textarea></div>
      </div>
      <div class="computed-note">Charges (negligence, incidents, damages) require the linked Incident Report and quotation/SOA. Uniform/expense deductions only need the ATD form.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveATDRecord('${id||''}')">Save ATD Record</button></div>
  `);
}
function atdToggleCategory(){
  const box=document.getElementById('atd-charges-fields');
  box.style.display = document.getElementById('f_category').value==='Charges' ? 'contents' : 'none';
}
function atdFillEmployee(){
  const name=document.getElementById('f_employeeName').value;
  const emp=DB.employees.find(e=>e.name===name);
  if(emp){ document.getElementById('f_department').value=emp.department||''; document.getElementById('f_position').value=emp.position||''; }
}
async function saveATDRecord(id){
  const employeeName=document.getElementById('f_employeeName').value;
  const employeeId=employeePickerSelected('f_employeeName')?.id||'';
  const category=document.getElementById('f_category').value;
  const totalAmount=document.getElementById('f_totalAmount').value;
  const atdDate=document.getElementById('f_atdDate').value;
  const deductionType=document.getElementById('f_deductionType').value.trim();
  if(!employeeName||!category||!totalAmount||!atdDate||!deductionType){ toast('Please complete all required fields.'); return; }
  const vals = {
    employeeId,employeeName, department:document.getElementById('f_department').value.trim(), position:document.getElementById('f_position').value.trim(),
    category, atdDate, deductionType, totalAmount:parseFloat(totalAmount)||0,
    paymentTerms:document.getElementById('f_paymentTerms').value.trim(),
    atdForm:document.getElementById('f_atdForm').value, atdFormData:document.getElementById('f_atdForm_data').value,
    incidentReport:document.getElementById('f_incidentReport').value, incidentReportData:document.getElementById('f_incidentReport_data').value,
    quotation:document.getElementById('f_quotation').value, quotationData:document.getElementById('f_quotation_data').value,
    soaAmount:parseFloat(document.getElementById('f_soaAmount').value)||0,
    remarks:document.getElementById('f_remarks').value.trim(),
  };
  let rec;
  let oldStoragePaths=new Set();
  const workflowCaseId = CASE_WORKFLOW_CONTEXT?.module==='atd' ? CASE_WORKFLOW_CONTEXT.caseId : null;
  if(id){
    rec=DB.atd.find(r=>r.id===id); oldStoragePaths=recordStoragePaths(rec); Object.assign(rec, vals); rec.status=atdComputeStatus(rec);
    logAudit('Updated ATD record for '+employeeName); toast('ATD record updated.');
  } else {
    rec={id:uid(), ...vals, payments:[]}; rec.status=atdComputeStatus(rec);
    DB.atd.push(rec); logAudit('Created ATD record for '+employeeName); toast('ATD record created.');
  }
  await saveDB();
  const newStoragePaths=recordStoragePaths(rec); rememberCommittedRecordFiles(rec);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  await closeModal([...newStoragePaths]); renderNav();
  CASE_WORKFLOW_CONTEXT=null;
  if(workflowCaseId && !id){
    await linkNewRecordToCase(workflowCaseId,'atd',rec);
    await openCaseDetails(workflowCaseId);
  } else {
    renderATD();
  }
}
async function deleteATDRecord(id){
  const rec=DB.atd.find(r=>r.id===id); const storagePaths=recordStoragePaths(rec);
  DB.atd = DB.atd.filter(r=>r.id!==id);
  logAudit('Deleted an ATD record'); await saveDB(); await deleteStorageObjects(storagePaths); renderNav(); renderATD(); toast('ATD record deleted.');
}

function openATDPayments(id){
  const rec = DB.atd.find(r=>r.id===id); if(!rec) return;
  const payments = (rec.payments||[]).slice().sort((a,b)=>(a.dateRecorded||'').localeCompare(b.dateRecorded||''));
  openModal(`
    <div class="modal-head"><h3>Payment History — ${esc(rec.employeeName)}</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="grid cols-4" style="margin-bottom:14px;gap:10px;">
        <div class="stat" style="--accent:var(--brass);padding:12px 14px;"><div class="lbl">Total ATD</div><div class="val" style="font-size:17px;">${peso(rec.totalAmount)}</div></div>
        <div class="stat" style="--accent:var(--forest);padding:12px 14px;"><div class="lbl">Total Paid</div><div class="val" style="font-size:17px;">${peso(atdTotalPaid(rec))}</div></div>
        <div class="stat" style="--accent:var(--rust);padding:12px 14px;"><div class="lbl">Remaining</div><div class="val" style="font-size:17px;">${peso(atdRemaining(rec))}</div></div>
        <div class="stat" style="--accent:var(--ink);padding:12px 14px;"><div class="lbl">Status</div><div class="val" style="font-size:17px;">${statusBadge(atdComputeStatus(rec), ATD_STATUS_MAP)}</div></div>
      </div>
      <div class="desc">${payments.length} payment(s) recorded, in chronological order. Payment terms: ${esc(rec.paymentTerms||'—')}.</div>
      <div class="tablewrap"><table class="data-table">
        <thead><tr><th>Month</th><th>Cut-Off</th><th>Amount Paid</th><th>Payslip</th><th>Date Recorded</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>${payments.length? payments.map(p=>`<tr>
          <td>${esc(p.month)}</td><td>${esc(p.cutoff)}</td><td>${peso(p.amountPaid)}</td>
          <td>${atdPayslipCellHTML(rec.id, p)}</td>
          <td>${fmtDate(p.dateRecorded)}</td>
          <td><div class="rowactions">
            ${canEdit()? `<button class="iconbtn" onclick="openATDPaymentForm('${rec.id}','${p.id}')" title="Edit">${iEdit(14)}</button>
            <button class="iconbtn" onclick="deleteATDPayment('${rec.id}','${p.id}')" title="Delete">${iTrash(14)}</button>`:''}
          </div></td>
        </tr>`).join('') : `<tr><td colspan="6"><div class="empty"><b>No payments recorded yet</b></div></td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Close</button>${canEdit()? `<button class="btn btn-brass" onclick="openATDPaymentForm('${rec.id}')">${iPlus(15)} Record Payment</button>`:''}</div>
  `);
}
function atdPayslipCellHTML(atdId, p){
  if(!p.payslip) return '<span class="small">—</span>';
  return `<div class="attach-cell">${iDoc(13)}<span title="${esc(p.payslip)}" style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.payslip)}</span>${p.payslipData?`<button class="iconbtn" title="Download" onclick="downloadATDPayslip('${atdId}','${p.id}')">${iDownload(12)}</button>`:'<span class="small" title="No stored file">n/a</span>'}</div>`;
}
function downloadATDPayslip(atdId, paymentId){
  const rec = DB.atd.find(r=>r.id===atdId); if(!rec) return;
  const p = (rec.payments||[]).find(x=>x.id===paymentId); if(!p) return;
  downloadAttachment(p.payslipData, p.payslip);
}
function openATDPaymentForm(atdId, paymentId){
  const rec = DB.atd.find(r=>r.id===atdId); if(!rec) return;
  const existing = paymentId? (rec.payments||[]).find(p=>p.id===paymentId) : null;
  const now = new Date();
  openModal(`
    <div class="modal-head"><h3>${existing?'Edit':'Record'} Payment</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <span hidden data-upload-employee-id="${esc(rec.employeeId||'')}" data-upload-employee-name="${esc(rec.employeeName||'')}" data-upload-employee-no="${esc(DB.employees.find(employee=>String(employee.id)===String(rec.employeeId))?.employeeNo||'')}" data-upload-department="${esc(rec.department||'')}"></span>
      <div class="formgrid">
        <div class="field"><label>Month *</label><select id="p_month">${ATD_MONTHS.map(m=>`<option ${(existing?existing.month:ATD_MONTHS[now.getMonth()])===m?'selected':''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label>Cut-Off *</label><select id="p_cutoff">${ATD_CUTOFFS.map(c=>`<option ${(existing?existing.cutoff:ATD_CUTOFFS[0])===c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Amount Paid (₱) *</label><input type="number" step="0.01" id="p_amountPaid" value="${existing?existing.amountPaid:''}"></div>
        <div class="field"><label>Date Recorded</label><input type="date" id="p_dateRecorded" value="${existing?existing.dateRecorded:todayISO()}"></div>
        ${fieldHTML({key:'payslip', label:'Payslip Attachment', type:'file', full:true, storagePrefix:'atd', existingData:existing?existing.payslipData:''}, existing?existing.payslip:'')}
      </div>
      <div class="computed-note">Cumulative amount paid, remaining balance, and payment status recalculate automatically once saved.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveATDPayment('${atdId}','${paymentId||''}')">Save Payment</button></div>
  `);
}
async function saveATDPayment(atdId, paymentId){
  const rec = DB.atd.find(r=>r.id===atdId); if(!rec) return;
  const amountPaid = parseFloat(document.getElementById('p_amountPaid').value)||0;
  if(amountPaid<=0){ toast('Enter an amount paid greater than zero.'); return; }
  const oldStoragePaths=recordStoragePaths(rec);
  const vals = {
    month:document.getElementById('p_month').value, cutoff:document.getElementById('p_cutoff').value, amountPaid,
    dateRecorded:document.getElementById('p_dateRecorded').value||todayISO(),
    payslip:document.getElementById('f_payslip').value, payslipData:document.getElementById('f_payslip_data').value,
  };
  if(!rec.payments) rec.payments=[];
  if(paymentId){ const p=rec.payments.find(x=>x.id===paymentId); Object.assign(p, vals); logAudit(`Updated ATD payment for ${rec.employeeName} (${vals.month}, ${vals.cutoff})`); }
  else { rec.payments.push({id:uid(), ...vals}); logAudit(`Recorded ATD payment for ${rec.employeeName} (${vals.month}, ${vals.cutoff})`); }
  rec.status = atdComputeStatus(rec);
  await saveDB(); const newStoragePaths=recordStoragePaths(rec); rememberCommittedRecordFiles(rec);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  toast('Payment saved.'); await closeModal([...newStoragePaths]); openATDPayments(atdId); renderNav();
}
async function deleteATDPayment(atdId, paymentId){
  const rec = DB.atd.find(r=>r.id===atdId); if(!rec) return;
  const payment=rec.payments?.find(p=>p.id===paymentId); const storagePaths=recordStoragePaths(payment);
  rec.payments = (rec.payments||[]).filter(p=>p.id!==paymentId);
  rec.status = atdComputeStatus(rec);
  logAudit('Deleted an ATD payment entry for '+rec.employeeName);
  await saveDB(); await deleteStorageObjects(storagePaths); toast('Payment removed.'); openATDPayments(atdId);
}

function exportATDCSV(){
  if(!requireExportAccess())return;
  const rows=[];
  DB.atd.forEach(r=>{
    if(!r.payments || !r.payments.length){ rows.push({employeeName:r.employeeName, department:r.department, category:r.category, deductionType:r.deductionType, totalAmount:r.totalAmount, month:'—', cutoff:'—', amountPaid:0, remaining:atdRemaining(r), status:atdComputeStatus(r)}); return; }
    r.payments.forEach(p=> rows.push({employeeName:r.employeeName, department:r.department, category:r.category, deductionType:r.deductionType, totalAmount:r.totalAmount, month:p.month, cutoff:p.cutoff, amountPaid:p.amountPaid, remaining:atdRemaining(r), status:atdComputeStatus(r)}) );
  });
  const csv = toCSV(rows, [
    {label:'Employee', get:r=>r.employeeName},{label:'Department', get:r=>r.department},{label:'Category', get:r=>r.category},
    {label:'Deduction Type', get:r=>r.deductionType},{label:'Total ATD', get:r=>r.totalAmount},{label:'Month', get:r=>r.month},
    {label:'Cut-Off', get:r=>r.cutoff},{label:'Amount Paid (this entry)', get:r=>r.amountPaid},{label:'Remaining Balance', get:r=>r.remaining},{label:'Status', get:r=>r.status},
  ]);
  downloadCSV('atd_monitoring_export.csv', csv);
  toast('ATD CSV exported.');
}

/* ================================================================
   PROBATIONARY EVALUATIONS (1st/3rd/6th month, auto-scheduled)
   ================================================================ */
function evalDueDate(dateHired, days){ return addDaysISO(dateHired, days); }
function getEvalRecord(employeeId, milestone){ return DB.evaluations.find(e=>e.employeeId===employeeId && e.milestone===milestone); }
function evalStatusInfo(emp, m){
  const rec = getEvalRecord(emp.id, m.key);
  if(rec && rec.completedDate) return {label:'Completed', cls:'b-green', rec};
  const due = evalDueDate(emp.dateHired, m.days);
  if(due < todayISO()) return {label:'Overdue', cls:'b-red', rec, due};
  if(due <= addDaysISO(todayISO(),7)) return {label:'Due Soon', cls:'b-amber', rec, due};
  return {label:'Upcoming', cls:'b-grey', rec, due};
}
function renderEvaluations(){
  setTitle('Probationary Evaluations', 'Auto-scheduled 1st/3rd/6th month evaluations for employees still within the probation period.');
  const q=(STATE.search||'').toLowerCase();
  let emps = DB.employees.filter(e=>classify(e)==='Probationary' && e.dateHired);
  if(STATE.evaluationFilter) emps=emps.filter(e=>EVAL_MILESTONES.some(m=>evalStatusInfo(e,m).label===STATE.evaluationFilter));
  if(q) emps = emps.filter(e=>e.name.toLowerCase().includes(q) || (e.department||'').toLowerCase().includes(q));
  emps = emps.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const html = `
  <div class="sectionhead">
    <div><h2>Probationary Evaluations</h2><p>${emps.length} employee(s) currently on probation.</p></div>
    <div class="page-header-actions">${informationNoteButton('evaluations')}</div>
  </div>
  <div class="toolbar"><div class="search">${iSearch(15)}<input data-search-key="search" type="search" autocomplete="off" placeholder="Search by employee or department…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderEvaluations)"></div><select onchange="STATE.evaluationFilter=this.value;STATE.tablePages={};renderEvaluations()"><option value="">All Evaluation Statuses</option><option value="Overdue" ${STATE.evaluationFilter==='Overdue'?'selected':''}>Overdue</option><option value="Due Soon" ${STATE.evaluationFilter==='Due Soon'?'selected':''}>Due Soon</option><option value="Upcoming" ${STATE.evaluationFilter==='Upcoming'?'selected':''}>Upcoming</option><option value="Completed" ${STATE.evaluationFilter==='Completed'?'selected':''}>Completed</option></select><button class="btn btn-ghost btn-sm" onclick="cancelSearchRender('search');STATE.evaluationFilter='';STATE.search='';STATE.tablePages={};renderEvaluations()">Clear</button></div>
  <div class="tablewrap"><table class="data-table">
    <thead><tr><th>Employee</th><th>Department</th><th>Date Hired</th><th>1st Month</th><th>3rd Month</th><th>6th Month</th></tr></thead>
    <tbody>
    ${emps.length? emps.map(e=>`<tr>
      <td><b>${esc(employeeDisplayName(e))}</b></td><td>${esc(e.department||'—')}</td><td>${fmtDate(e.dateHired)}</td>
      ${EVAL_MILESTONES.map(m=>{ const s=evalStatusInfo(e,m); return `<td>
        <div style="cursor:pointer;" onclick="openEvalForm('${e.id}','${m.key}')">${statusBadge(s.label, {[s.label]:s.cls})}</div>
        <div class="small" style="margin-top:2px;">${s.rec&&s.rec.completedDate? fmtDate(s.rec.completedDate) : 'Due '+fmtDate(evalDueDate(e.dateHired,m.days))}</div>
        ${s.rec&&s.rec.attachment? `<div class="small">${attachCellHTML('evaluations', s.rec, 'attachment')}</div>`:''}
      </td>`; }).join('')}
    </tr>`).join('') : `<tr><td colspan="6"><div class="empty"><b>No probationary employees</b></div></td></tr>`}
    </tbody></table></div>`;
  document.getElementById('content').innerHTML = html;
}
function openEvalForm(employeeId, milestoneKey){
  const emp = DB.employees.find(e=>e.id===employeeId);
  const m = EVAL_MILESTONES.find(x=>x.key===milestoneKey);
  const rec = getEvalRecord(employeeId, milestoneKey);
  openModal(`
    <div class="modal-head"><h3>${m.label} Evaluation — ${esc(employeeDisplayName(emp))}</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <span hidden data-upload-employee-id="${esc(emp.id||'')}" data-upload-employee-name="${esc(employeeDisplayName(emp))}" data-upload-employee-no="${esc(emp.employeeNo||'')}" data-upload-department="${esc(emp.department||'')}"></span>
      <div class="formgrid">
        <div class="field"><label>Due Date</label><input value="${fmtDate(evalDueDate(emp.dateHired,m.days))}" disabled style="background:var(--paper);"></div>
        <div class="field"><label>Date Completed</label><input type="date" id="ev_completedDate" value="${(rec&&rec.completedDate)||''}"></div>
        ${fieldHTML({key:'attachment', label:'Uploaded Evaluation Document', type:'file', full:true, storagePrefix:'evaluation', existingData:(rec&&rec.attachmentData)||''}, rec?rec.attachment:'')}
        <div class="field full"><label>Remarks</label><textarea id="ev_remarks" rows="2">${esc((rec&&rec.remarks)||'')}</textarea></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveEval('${employeeId}','${milestoneKey}')">Save Evaluation</button></div>
  `);
}
async function saveEval(employeeId, milestoneKey){
  const completedDate = document.getElementById('ev_completedDate').value;
  const attachment = document.getElementById('f_attachment').value;
  const attachmentData = document.getElementById('f_attachment_data').value;
  const remarks = document.getElementById('ev_remarks').value.trim();
  let rec = getEvalRecord(employeeId, milestoneKey);
  const oldStoragePaths=recordStoragePaths(rec);
  if(rec){ Object.assign(rec, {completedDate, attachment, attachmentData, remarks}); }
  else { rec={id:uid(), employeeId, milestone:milestoneKey, completedDate, attachment, attachmentData, remarks}; DB.evaluations.push(rec); }
  logAudit(`Updated evaluation (${milestoneKey}) for employee`);
  await saveDB(); const newStoragePaths=recordStoragePaths(rec); rememberCommittedRecordFiles(rec);
  await deleteStorageObjects([...oldStoragePaths].filter(path=>!newStoragePaths.has(path)));
  await workflowSyncTasks({silent:true});
  await closeModal([...newStoragePaths]); renderEvaluations();
  toast('Evaluation saved.');
}

/* ================================================================
   CONSOLIDATED EMPLOYEE OFFENSE SUMMARY
   ================================================================ */
function renderOffenseSummary(){
  setTitle('Employee Offense Summary', 'One consolidated view per employee — every offense, count, level, and consequence, from Disciplinary Action and CVR combined.');
  const q=(STATE.search||'').toLowerCase();
  const map = {};
  function ensure(name, dept){ if(!map[name]) map[name]={department:dept, offenses:{}}; else if(dept && !map[name].department) map[name].department=dept; return map[name]; }
  DB.disciplinary.forEach(d=>{ const m=ensure(d.employeeName, d.department); const key=d.violation||'Unspecified'; m.offenses[key]=(m.offenses[key]||0)+1; });
  DB.cvr.forEach(c=>{ const m=ensure(c.employeeName, c.department); [...(c.offenses||[]), ...(c.otherOffense?[c.otherOffense]:[])].forEach(o=>{ m.offenses[o]=(m.offenses[o]||0)+1; }); });
  let names = Object.keys(map).sort((a,b)=>a.localeCompare(b));
  if(q) names = names.filter(n=> n.toLowerCase().includes(q) || Object.keys(map[n].offenses).some(o=>o.toLowerCase().includes(q)));
  const html = `
  <div class="sectionhead"><div><h2>Employee Offense Summary</h2><p>${names.length} employee(s) with recorded offenses.</p></div><div class="page-header-actions">${informationNoteButton('offenseSummary')}</div></div>
  <div class="toolbar"><div class="search">${iSearch(15)}<input data-search-key="search" type="search" autocomplete="off" placeholder="Search by employee or offense…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderOffenseSummary)"></div></div>
  ${names.length? names.map(n=>{
    const m = map[n];
    const rows = Object.entries(m.offenses).sort((a,b)=>b[1]-a[1]);
    return `<div class="panel" style="margin-bottom:12px;">
      <h3>${esc(n)} <span class="small" style="font-weight:400;">${esc(m.department||'')}</span></h3>
      <div class="tablewrap"><table class="data-table">
        <thead><tr><th>Offense</th><th>Count</th><th>Level</th><th>Consequence</th></tr></thead>
        <tbody>${rows.map(([o,c])=>{ const idx=Math.min(c-1, OFFENSE_LEVELS.length-1); const level=OFFENSE_LEVELS[idx]; const cons=consequenceFor(o, idx); return `<tr><td><b>${esc(o)}</b></td><td>${c}</td><td>${statusBadge(level,{})}</td><td class="small">${esc(cons)}</td></tr>`; }).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('') : '<div class="empty"><b>No offenses recorded yet</b></div>'}`;
  document.getElementById('content').innerHTML = html;
}

/* ================================================================
   WORKFLOW & APPROVAL CENTER
   Uses the existing hr_records persistence layer for durable task state.
   Source records remain the system of record; workflowTasks stores task,
   assignment, decision, and completion metadata around those records.
   ================================================================ */
const WORKFLOW_STATUS = ['Pending','Completed','Rejected','Cancelled'];
const WORKFLOW_TYPES = ['Approval','Review','Task'];
const WORKFLOW_STEP_LABELS = {
  leave_review:'Leave Approval',
  prf_review:'PRF Approval',
  case_review:'HR Case Workflow',
  evaluation_review:'Probation Evaluation',
  nte_review:'NTE Review',
  cvr_review:'CVR Review',
  incident_review:'Incident Review',
  lifecycle_task:'Lifecycle Checklist',
  manual:'HR Task'
};
function workflowTaskId(module,recordId,step='action'){
  const raw=`wf_${module}_${recordId}_${step}`;
  return raw.replace(/[^a-zA-Z0-9_-]+/g,'_');
}
function workflowTaskKey(module,recordId){ return `${module}:${recordId}`; }
function workflowExistingTask(module,recordId){ return (DB.workflowTasks||[]).find(t=>t.workflowKey===workflowTaskKey(module,recordId)); }
function workflowPendingCount(){ return (DB.workflowTasks||[]).filter(t=>t.status==='Pending' && workflowVisibleToSession(t)).length; }
function workflowTaskSeverity(task){
  if(task.status!=='Pending') return task.status==='Completed'?'success':'';
  if(task.dueDate && task.dueDate<todayISO()) return 'danger';
  if(task.priority==='Urgent'||task.priority==='High') return 'danger';
  if(task.dueDate && task.dueDate<=addDaysISO(todayISO(),3)) return 'warning';
  return '';
}
function workflowDueText(task){
  if(!task.dueDate) return 'No deadline set';
  const d=task.dueDate;
  if(task.status==='Pending' && d<todayISO()) return `Overdue · ${fmtDate(d)}`;
  if(task.status==='Pending' && d<=addDaysISO(todayISO(),7)) return `Due ${fmtDate(d)}`;
  return fmtDate(d);
}
function workflowPriorityBadge(priority){
  const map={Urgent:'b-red',High:'b-red',Normal:'b-blue',Low:'b-grey'};
  return statusBadge(priority||'Normal',map);
}
function workflowVisibleToSession(task){
  if(!SESSION || SESSION.role==='Administrator') return true;
  if(SESSION.role==='Viewer') return true;
  return !task.assigneeId || String(task.assigneeId)===String(SESSION.id);
}
function workflowActionable(task){ return task?.status==='Pending' && SESSION?.role!=='Viewer' && canEdit(); }
function workflowUpsertDesired(desired, module, recordId, patch){
  const key=workflowTaskKey(module,recordId);
  let task=(DB.workflowTasks||[]).find(t=>t.workflowKey===key);
  if(!task){
    task={id:workflowTaskId(module,recordId,patch.stepKey||'action'),workflowKey:key,createdAt:new Date().toISOString(),createdBy:SESSION?.id||null,status:'Pending'};
    DB.workflowTasks.push(task);
    desired.push(task);
  } else desired.push(task);
  Object.assign(task,patch,{workflowKey:key});
  return task;
}
async function workflowSyncTasks({silent=false}={}){
  if(!DB.workflowTasks) DB.workflowTasks=[];
  const before=JSON.stringify(DB.workflowTasks);
  const today=todayISO();

  // Cases live in hr_cases, so read the current workflow source directly.
  try{
    const {data:cases,error}=await supabase.from('hr_cases').select('id,case_number,employee_record_id,employee_name,department,subject,status,opened_at,closed_at,assigned_to,priority,due_date,updated_at').order('updated_at',{ascending:false}).limit(500);
    if(!error){
      (cases||[]).forEach(c=>{
        const closed=['Closed','Cancelled','Resolved'].includes(c.status);
        const forDecision=c.status==='For Decision';
        const title=closed?`Case closed — ${c.case_number||'HR Case'}`:forDecision?`Decision required — ${c.case_number||'HR Case'}`:c.assigned_to?`Review case — ${c.case_number||'HR Case'}`:`Assign case — ${c.case_number||'HR Case'}`;
        const existing=workflowExistingTask('cases',c.id);
        const preservedStatus=existing?.status==='Completed' && existing.sourceStatus===c.status ? 'Completed' : existing?.status==='Rejected' && existing.sourceStatus===c.status ? 'Rejected' : 'Pending';
        const task=workflowUpsertDesired([], 'cases', c.id, {
          stepKey:'action',workflowType:forDecision?'Approval':'Review',title,
          description:c.subject||'Review and advance the HR case workflow.',module:'cases',recordId:c.id,
          employeeRecordId:c.employee_record_id||'',employeeName:c.employee_name||'',department:c.department||'',
          priority:c.priority||'Normal',dueDate:c.due_date||'',assigneeId:c.assigned_to||'',
          sourceStatus:c.status||'',sourceUpdatedAt:c.updated_at||'',actionType:closed?'none':forDecision?'case_decision':c.assigned_to?'case_review':'case_assign',
          status:closed?'Completed':preservedStatus
        });
        if(closed){ task.status='Completed'; task.completedAt=task.completedAt||c.closed_at||new Date().toISOString(); }
      });
    }
  }catch(e){ if(!silent) console.warn('Workflow case sync failed',e); }

  const ensureRecordTask=(module,rec,patch)=>{
    const existing=workflowExistingTask(module,rec.id);
    const closed=patch.closed;
    const task=workflowUpsertDesired([],module,rec.id,{...patch,sourceUpdatedAt:patch.sourceUpdatedAt||'',status:closed?'Completed':(existing?.status||'Pending')});
    if(closed){ task.status='Completed'; task.completedAt=task.completedAt||new Date().toISOString(); }
    return task;
  };

  (DB.leaves||[]).forEach(l=>{
    const pending=l.status==='Pending';
    if(pending || workflowExistingTask('leaves',l.id)) ensureRecordTask('leaves',l,{
      stepKey:'approval',workflowType:'Approval',title:`Review leave request — ${l.employeeName||'Employee'}`,
      description:`${l.leaveType||'Leave'} · ${fmtDate(l.startDate)}–${fmtDate(l.endDate)}`,
      module:'leaves',recordId:l.id,employeeName:l.employeeName||'',department:l.department||'',priority:'Normal',
      dueDate:l.startDate||l.dateApplied||'',assigneeId:'',actionType:pending?'leave_decision':'none',closed:!pending
    });
  });

  (DB.prf||[]).forEach(p=>{
    const pending=p.status==='Pending Approval';
    if(pending || workflowExistingTask('prf',p.id)) ensureRecordTask('prf',p,{
      stepKey:'approval',workflowType:'Approval',title:`Review PRF — ${p.prfNumber||p.employeeName||'Request'}`,
      description:p.reasonForRequest||'Personnel requisition request awaiting review.',module:'prf',recordId:p.id,
      employeeName:p.employeeName||'',department:p.department||'',priority:'Normal',dueDate:p.dateOfRequest||'',assigneeId:'',
      actionType:pending?'prf_decision':'none',closed:!pending
    });
  });

  (DB.evaluations||[]).forEach(ev=>{
    const emp=DB.employees.find(e=>String(e.id)===String(ev.employeeId));
    if(!emp) return;
    const pending=!ev.completedDate && classify(emp)==='Probationary';
    if(pending || workflowExistingTask('evaluations',ev.id)){
      const m=EVAL_MILESTONES.find(x=>x.key===ev.milestone);
      const due=emp.dateHired&&m?evalDueDate(emp.dateHired,m.days):'';
      ensureRecordTask('evaluations',ev,{
        stepKey:'completion',workflowType:'Task',title:`Complete ${m?.label||ev.milestone||'evaluation'} — ${employeeDisplayName(emp)}`,
        description:`Probationary evaluation milestone for ${employeeDisplayName(emp)}.`,module:'evaluations',recordId:ev.id,
        employeeName:emp.name,employeeRecordId:emp.id,department:emp.department||'',priority:due&&due<today?'High':'Normal',dueDate:due||'',assigneeId:'',
        actionType:pending?'evaluation_review':'none',closed:!pending
      });
    }
  });

  (DB.nte||[]).forEach(r=>{
    const pending=['Explanation Submitted','Under Review'].includes(r.status);
    if(pending || workflowExistingTask('nte',r.id)) ensureRecordTask('nte',r,{
      stepKey:'review',workflowType:'Review',title:`Review NTE response — ${r.employeeName||'Employee'}`,
      description:r.violation||'NTE response requires HR review.',module:'nte',recordId:r.id,employeeName:r.employeeName||'',department:r.department||'',priority:'High',dueDate:'',assigneeId:'',
      actionType:pending?'nte_review':'none',closed:!pending
    });
  });

  (DB.cvr||[]).forEach(r=>{
    const pending=r.status==='Pending Review';
    if(pending || workflowExistingTask('cvr',r.id)) ensureRecordTask('cvr',r,{
      stepKey:'review',workflowType:'Review',title:`Review CVR — ${r.employeeName||'Employee'}`,
      description:r.remarks||r.otherOffense||'CVR requires HR review.',module:'cvr',recordId:r.id,employeeName:r.employeeName||'',department:r.department||'',priority:'Normal',dueDate:'',assigneeId:'',
      actionType:pending?'cvr_review':'none',closed:!pending
    });
  });

  (DB.incidents||[]).forEach(r=>{
    const pending=['Reported','Under Investigation'].includes(r.status);
    if(pending || workflowExistingTask('incidents',r.id)) ensureRecordTask('incidents',r,{
      stepKey:'review',workflowType:'Review',title:`Review incident — ${r.employeeName||'Employee'}`,
      description:r.incidentType||'Incident report requires review.',module:'incidents',recordId:r.id,employeeName:r.employeeName||'',department:r.department||'',priority:r.severity==='Critical'||r.severity==='Major'?'High':'Normal',dueDate:'',assigneeId:'',
      actionType:pending?'incident_review':'none',closed:!pending
    });
  });

  (DB.lifecycleChecklists||[]).forEach(checklist=>{
    const employee=lifecycleChecklistEmployee(checklist);
    const checklistClosed=['Cancelled','Completed'].includes(lifecycleChecklistComputedStatus(checklist));
    (checklist.items||[]).forEach(item=>{
      const recordId=`${checklist.id}__${item.id}`;
      const closed=checklistClosed||item.completed;
      if(!closed||workflowExistingTask('lifecycleChecklists',recordId)) ensureRecordTask('lifecycleChecklists',{id:recordId},{
        stepKey:'completion',workflowType:'Task',title:`${item.title} — ${employee?.name||'Employee'}`,
        description:`${checklist.type} checklist · ${item.owner}`,module:'lifecycleChecklists',recordId,
        checklistId:checklist.id,itemId:item.id,employeeName:employee?.name||'',employeeRecordId:checklist.employeeId||'',department:employee?.department||'',priority:item.dueDate&&item.dueDate<today?'High':'Normal',dueDate:item.dueDate||'',assigneeId:item.assigneeProfileId||checklist.managerProfileId||'',actionType:closed?'none':'lifecycle_task',closed
      });
    });
  });

  const after=JSON.stringify(DB.workflowTasks);
  if(before!==after){
    try{ await saveDB(); }
    catch(e){ if(!silent) toast('Workflow synchronization could not be saved: '+e.message,true); }
  }
  renderNav();
  return DB.workflowTasks;
}
function taskStatusPreserved(task){ return !!task && ['Completed','Rejected','Cancelled'].includes(task.status); }
function workflowFindTask(id){ return (DB.workflowTasks||[]).find(t=>String(t.id)===String(id)); }
function workflowOpenSource(task){
  if(!task) return;
  if(task.module==='cases'){ closeModal(); openCaseDetails(task.recordId); return; }
  if(task.module==='lifecycleChecklists'){ closeModal(); openLifecycleChecklist(task.checklistId); return; }
  if(task.module==='evaluations'){
    const ev=DB.evaluations.find(x=>String(x.id)===String(task.recordId));
    if(ev) { closeModal(); openEvalForm(ev.employeeId,ev.milestone); }
    return;
  }
  const route=task.module;
  if(RENDERERS[route]){ closeModal(); go(route); }
}
function openWorkflowTask(id){
  const task=workflowFindTask(id); if(!task) return;
  const actionable=workflowActionable(task);
  const due=workflowDueText(task);
  const steps=[];
  if(task.workflowType==='Approval') steps.push('<span class="workflow-step done">Request</span>','<span class="workflow-step active">Review / Decision</span>','<span class="workflow-step">Completion</span>');
  else if(task.workflowType==='Review') steps.push('<span class="workflow-step done">Record</span>','<span class="workflow-step active">Review</span>','<span class="workflow-step">Next Action</span>');
  else steps.push('<span class="workflow-step done">Created</span>','<span class="workflow-step active">Action Required</span>','<span class="workflow-step">Completed</span>');
  openModal(`<div class="modal-head"><div><h3>${esc(task.title)}</h3><div class="small">${esc(WORKFLOW_STEP_LABELS[task.actionType==='leave_decision'?'leave_review':task.actionType==='prf_decision'?'prf_review':task.actionType==='evaluation_review'?'evaluation_review':task.actionType==='case_decision'||task.actionType==='case_review'||task.actionType==='case_assign'?'case_review':task.actionType==='nte_review'?'nte_review':task.actionType==='cvr_review'?'cvr_review':task.actionType==='incident_review'?'incident_review':task.actionType==='lifecycle_task'?'lifecycle_task':'manual'])}</div></div><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="workflow-detail">
        <div class="item"><div class="label">Status</div><div class="value">${statusBadge(task.status,{Pending:'b-amber',Completed:'b-green',Rejected:'b-red',Cancelled:'b-grey'})}</div></div>
        <div class="item"><div class="label">Priority</div><div class="value">${workflowPriorityBadge(task.priority)}</div></div>
        <div class="item"><div class="label">Due</div><div class="value">${esc(due)}</div></div>
        <div class="item"><div class="label">Employee</div><div class="value">${esc(task.employeeName||'—')}</div></div>
        <div class="item"><div class="label">Department</div><div class="value">${esc(task.department||'—')}</div></div>
        <div class="item"><div class="label">Assigned To</div><div class="value">${esc((DB.users.find(u=>String(u.id)===String(task.assigneeId))?.fullName)||'Unassigned')}</div></div>
      </div>
      <div class="field"><label>Workflow Note</label><textarea id="wf_task_note" rows="4" placeholder="Add an internal workflow note or decision remark…" ${canEdit()?'':'readonly'}>${esc(task.remarks||'')}</textarea></div>
      <div class="workflow-rule"><b>Source of record:</b> ${esc(caseModuleLabel(task.module)||task.module)}. Workflow changes coordinate the work around the record; they do not replace the underlying HR record.</div>
      <div class="workflow-steps">${steps.join('')}</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Close</button>${canEdit()?`<button class="btn btn-ghost" onclick="saveWorkflowTaskNote('${task.id}')">Save Note</button>`:''}${task.status==='Pending'&&canEdit()?`<button class="btn btn-ghost" onclick="workflowAssignTask('${task.id}')">Assign</button><button class="btn btn-ghost" onclick="workflowOpenSource(workflowFindTask('${task.id}'))">Open Record</button>${task.actionType==='case_assign'?`<button class="btn btn-primary" onclick="workflowAssignTask('${task.id}')">Assign Owner</button>`:task.workflowType==='Approval'?`<button class="btn btn-danger" onclick="workflowDecideTask('${task.id}','Rejected')">Reject / Return</button><button class="btn btn-brass" onclick="workflowDecideTask('${task.id}','Approved')">Approve</button>`:`<button class="btn btn-primary" onclick="workflowCompleteTask('${task.id}')">Complete Task</button>`}`:''}</div>`);
}
async function workflowSaveTaskNote(id){
  const task=workflowFindTask(id); if(!task) return;
  task.remarks=(document.getElementById('wf_task_note')?.value||'').trim();
  task.lastActionAt=new Date().toISOString(); task.lastActionBy=SESSION?.id||null;
  await saveDB();
}
async function saveWorkflowTaskNote(id){
  if(!canEdit()) return;
  await workflowSaveTaskNote(id);
  toast('Workflow note saved.');
  await closeModal();
  if(STATE.view==='workflow') renderWorkflowCenter();
}
function workflowAssignTask(id){
  const task=workflowFindTask(id); if(!task) return;
  const users=(DB.users||[]).filter(u=>u.role!=='Viewer');
  openModal(`<div class="modal-head"><div><h3>Assign Workflow Task</h3><div class="small">${esc(task.title)}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="field"><label>Assigned To *</label><select id="wf_assign_to"><option value="">Unassigned</option>${users.map(u=>`<option value="${esc(u.id)}" ${String(task.assigneeId||'')===String(u.id)?'selected':''}>${esc(u.fullName)} · ${esc(u.role)}</option>`).join('')}</select></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="workflowSaveAssignment('${task.id}')">Save Assignment</button></div>`);
}
async function workflowSaveAssignment(id){
  if(!canEdit()) return;
  const task=workflowFindTask(id); if(!task) return;
  const assigneeId=document.getElementById('wf_assign_to')?.value||'';
  task.assigneeId=assigneeId; task.assignedAt=new Date().toISOString(); task.assignedBy=SESSION?.id||null;
  await saveDB(); logAudit(`Assigned workflow task: ${task.title}`); toast(assigneeId?'Workflow task assigned.':'Workflow task unassigned.'); closeModal(); await workflowSyncTasks({silent:true}); if(STATE.view==='workflow') renderWorkflowCenter(); else renderNav();
}
async function workflowCompleteTask(id){
  if(!canEdit()) return;
  const task=workflowFindTask(id); if(!task||task.status!=='Pending') return;
  if(task.actionType==='case_assign'){ workflowAssignTask(id); return; }
  if(task.module==='evaluations'){
    const ev=DB.evaluations.find(x=>String(x.id)===String(task.recordId));
    if(!ev?.completedDate){ toast('Complete the evaluation record before closing this task.'); workflowOpenSource(task); return; }
  }
  if(task.module==='lifecycleChecklists'){
    const checklist=(DB.lifecycleChecklists||[]).find(row=>String(row.id)===String(task.checklistId));
    const item=checklist?.items?.find(row=>String(row.id)===String(task.itemId));
    if(!checklist||!item){toast('The lifecycle task source could not be found.',true);return;}
    item.completed=true;item.completedAt=new Date().toISOString();item.completedBy=SESSION?.id||'';item.note=(document.getElementById('wf_task_note')?.value||item.note||'').trim();checklist.status=lifecycleChecklistComputedStatus(checklist);checklist.updatedAt=new Date().toISOString();lifecycleChecklistHistory(checklist,'Task completed from Workflow',item.title);await saveDB();
  }
  await workflowSaveTaskNote(id);
  task.status='Completed'; task.completedAt=new Date().toISOString(); task.completedBy=SESSION?.id||null; task.decision='Completed';
  await saveDB(); logAudit(`Completed workflow task: ${task.title}`); toast('Workflow task completed.'); closeModal(); await workflowSyncTasks({silent:true}); renderWorkflowCenter();
}
async function workflowDecideTask(id,decision){
  if(!canEdit()) return;
  const task=workflowFindTask(id); if(!task||task.status!=='Pending') return;
  await workflowSaveTaskNote(id);
  if(task.module==='leaves'){
    const rec=DB.leaves.find(x=>String(x.id)===String(task.recordId)); if(!rec) return;
    rec.status=decision==='Approved'?'Approved':'Disapproved';
  } else if(task.module==='prf'){
    const rec=DB.prf.find(x=>String(x.id)===String(task.recordId)); if(!rec) return;
    rec.status=decision==='Approved'?'Approved':'Rejected';
  } else if(task.module==='cases'){
    const {data:caseRec,error}=await supabase.from('hr_cases').select('id,status,due_date').eq('id',task.recordId).maybeSingle();
    if(error||!caseRec){ toast('Could not load the case for this decision.',true); return; }
    const next=decision==='Approved'?'Resolved':'Under Review';
    const {error:updateError}=await supabase.from('hr_cases').update({status:next,closed_at:next==='Resolved'?todayISO():null,updated_by:SESSION?.id||null}).eq('id',task.recordId);
    if(updateError){toast('Case decision failed: '+updateError.message,true);return;}
    try{ await addCaseActivity(task.recordId,'status',`Workflow ${decision==='Approved'?'approved the case decision':'returned the case to review'}.`,caseRec.status,next,caseRec.due_date||null); }catch(e){}
  } else {
    task.decision=decision;
  }
  task.status=decision==='Approved'?'Completed':'Rejected'; task.completedAt=new Date().toISOString(); task.completedBy=SESSION?.id||null; task.decision=decision;
  await saveDB();
  logAudit(`${decision==='Approved'?'Approved':'Returned'} workflow task: ${task.title}`);
  toast(decision==='Approved'?'Workflow approval completed.':'Workflow item returned for further review.');
  closeModal(); await workflowSyncTasks({silent:true}); renderNav(); renderWorkflowCenter();
}
function workflowSourceTitle(task){
  if(task.module==='cases') return `Case ${task.recordId||''}`;
  if(task.module==='prf') return 'PRF';
  if(task.module==='leaves') return 'Leave';
  if(task.module==='evaluations') return 'Evaluation';
  if(task.module==='nte') return 'NTE';
  if(task.module==='cvr') return 'CVR';
  if(task.module==='incidents') return 'Incident';
  return 'HR Task';
}
function workflowActionButtons(task){
  const a=workflowActionable(task); if(!a) return `<button class="btn btn-ghost btn-sm" onclick="openWorkflowTask('${esc(task.id)}')">View</button>`;
  let html=`<button class="btn btn-ghost btn-sm" onclick="openWorkflowTask('${esc(task.id)}')">Open</button>`;
  if(task.actionType==='case_assign') html+=`<button class="btn btn-primary btn-sm" onclick="workflowAssignTask('${esc(task.id)}')">Assign</button>`;
  else if(task.workflowType==='Approval') html+=`<button class="btn btn-brass btn-sm" onclick="workflowDecideTask('${esc(task.id)}','Approved')">Approve</button>`;
  else html+=`<button class="btn btn-primary btn-sm" onclick="workflowCompleteTask('${esc(task.id)}')">Complete</button>`;
  return html;
}
async function openWorkflowCreateForm(){
  if(!canEdit()) return;
  const users=(DB.users||[]).filter(u=>u.role!=='Viewer');
  openModal(`<div class="modal-head"><div><h3>Create HR Task</h3><div class="small">Manual tasks can be used for work that does not yet have a dedicated workflow.</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="formgrid">
    <div class="field full"><label>Task Title *</label><input id="wf_new_title" placeholder="e.g. Confirm employee clearance documents"></div>
    <div class="field"><label>Priority</label><select id="wf_new_priority"><option>Normal</option><option>Low</option><option>High</option><option>Urgent</option></select></div>
    <div class="field"><label>Due Date</label><input type="date" id="wf_new_due" value="${todayISO()}"></div>
    <div class="field"><label>Assign To</label><select id="wf_new_assignee"><option value="">Unassigned</option>${users.map(u=>`<option value="${esc(u.id)}">${esc(u.fullName)} · ${esc(u.role)}</option>`).join('')}</select></div>
    <div class="field full"><label>Description / Notes</label><textarea id="wf_new_desc" rows="4" placeholder="Describe the action required and the expected result…"></textarea></div>
  </div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveWorkflowManualTask()">Create Task</button></div>`);
}
async function saveWorkflowManualTask(){
  if(!canEdit()) return;
  const title=document.getElementById('wf_new_title')?.value.trim();
  if(!title){toast('Enter a task title.');return;}
  const task={id:uid(),workflowKey:`manual:${uid()}`,createdAt:new Date().toISOString(),createdBy:SESSION?.id||null,workflowType:'Task',title,description:document.getElementById('wf_new_desc')?.value.trim()||'',module:'manual',recordId:'',employeeName:'',department:'',priority:document.getElementById('wf_new_priority')?.value||'Normal',dueDate:document.getElementById('wf_new_due')?.value||'',assigneeId:document.getElementById('wf_new_assignee')?.value||'',actionType:'manual',status:'Pending'};
  DB.workflowTasks.push(task); await saveDB(); logAudit(`Created workflow task: ${title}`); toast('HR task created.'); closeModal(); renderNav(); renderWorkflowCenter();
}
function workflowPageGo(_scope,page){ STATE.tablePages ||= {}; const cur=STATE.tablePages['workflow:list']||{page:1,size:10,signature:''}; STATE.tablePages['workflow:list']={...cur,page:Math.max(1,Number(page)||1)}; renderWorkflowCenter(); }
function workflowPageSize(_scope,size){ STATE.tablePages ||= {}; STATE.tablePageSizes ||= {}; const nextSize=Number(size)||10; const cur=STATE.tablePages['workflow:list']||{page:1,size:nextSize,signature:''}; STATE.tablePageSizes['workflow:list']=nextSize; STATE.tablePages['workflow:list']={...cur,page:1,size:nextSize,signature:''}; renderWorkflowCenter(); }
function workflowSetQuickFilter(scope){
  STATE.workflowFilter=scope;
  STATE.workflowStatus='Pending';
  paginationReset(STATE,'workflow:list');
  renderWorkflowCenter();
}
function workflowResetFilters(){
  STATE.search='';
  STATE.workflowFilter='queue';
  STATE.workflowStatus='Pending';
  STATE.workflowType='';
  STATE.workflowPriority='';
  STATE.workflowDepartment='';
  paginationReset(STATE,'workflow:list');
  renderWorkflowCenter();
}
function automationPageGo(_scope,page){ STATE.tablePages ||= {}; const cur=STATE.tablePages['automation:tasks']||{page:1,size:10,signature:''}; STATE.tablePages['automation:tasks']={...cur,page:Math.max(1,Number(page)||1)}; renderAutomationCenter(); }
function automationPageSize(_scope,size){ STATE.tablePages ||= {}; STATE.tablePageSizes ||= {}; const nextSize=Number(size)||10; const cur=STATE.tablePages['automation:tasks']||{page:1,size:nextSize,signature:''}; STATE.tablePageSizes['automation:tasks']=nextSize; STATE.tablePages['automation:tasks']={...cur,page:1,size:nextSize,signature:''}; renderAutomationCenter(); }

async function renderWorkflowCenter(){
  setTitle('Workflow & Approvals','A unified work queue for approvals, reviews, deadlines, and HR tasks.');
  document.getElementById('content').innerHTML='<div class="panel"><div class="desc">Synchronizing current HR workflow items…</div></div>';
  await workflowSyncTasks({silent:true});
  if(STATE.view!=='workflow') return;
  const all=DB.workflowTasks||[];
  const visible=all.filter(workflowVisibleToSession);
  const pending=visible.filter(t=>t.status==='Pending');
  const today=todayISO(), next7=addDaysISO(today,7);
  const overdue=visible.filter(t=>t.status==='Pending'&&t.dueDate&&t.dueDate<today);
  const due7=visible.filter(t=>t.status==='Pending'&&t.dueDate&&t.dueDate>=today&&t.dueDate<=next7);
  const my=visible.filter(t=>t.status==='Pending'&&String(t.assigneeId||'')===String(SESSION?.id||''));
  const unassigned=visible.filter(t=>t.status==='Pending'&&!t.assigneeId);
  const departments=[...new Set(visible.map(t=>String(t.department||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const q=(STATE.search||'').toLowerCase();
  let rows=visible.filter(t=>{
    const searchOk=!q||[t.title,t.description,t.employeeName,t.department,t.module,t.priority,t.status,workflowSourceTitle(t)].some(v=>String(v||'').toLowerCase().includes(q));
    const statusOk=STATE.workflowStatus==='All'||t.status===STATE.workflowStatus;
    const typeOk=!STATE.workflowType||t.workflowType===STATE.workflowType;
    const priorityOk=!STATE.workflowPriority||t.priority===STATE.workflowPriority;
    const departmentOk=!STATE.workflowDepartment||t.department===STATE.workflowDepartment;
    let scopeOk=true;
    if(STATE.workflowFilter==='mine') scopeOk=String(t.assigneeId||'')===String(SESSION?.id||'');
    if(STATE.workflowFilter==='queue') scopeOk=t.status==='Pending';
    if(STATE.workflowFilter==='unassigned') scopeOk=t.status==='Pending'&&!t.assigneeId;
    if(STATE.workflowFilter==='overdue') scopeOk=t.status==='Pending'&&t.dueDate&&t.dueDate<today;
    if(STATE.workflowFilter==='due7') scopeOk=t.status==='Pending'&&t.dueDate&&t.dueDate>=today&&t.dueDate<=next7;
    return searchOk&&statusOk&&typeOk&&priorityOk&&departmentOk&&scopeOk;
  }).sort((a,b)=>{
    const pa={Urgent:0,High:1,Normal:2,Low:3};
    if(a.status!==b.status) return a.status==='Pending'?-1:1;
    if((pa[a.priority]??2)!==(pa[b.priority]??2)) return (pa[a.priority]??2)-(pa[b.priority]??2);
    return String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'));
  });
  const page=paginateRows(rows,STATE,'workflow:list',10);
  const pageRows=page.rows;
  const hasFilters=STATE.search||STATE.workflowFilter!=='queue'||STATE.workflowStatus!=='Pending'||STATE.workflowType||STATE.workflowPriority||STATE.workflowDepartment;
  const workflowStatusMap={Pending:'b-amber',Completed:'b-green',Rejected:'b-red',Cancelled:'b-grey'};
  const html=`<div class="workflow-hero"><div><h1>Workflow &amp; Approvals</h1><p>${visible.filter(t=>t.status==='Pending').length} pending workflow item${visible.filter(t=>t.status==='Pending').length===1?'':'s'} across cases, leave, PRF, evaluations, and HR reviews.</p></div><div class="workflow-actions">${canEdit()?`<button class="btn btn-brass" onclick="openWorkflowCreateForm()">${iPlus(15)} New HR Task</button>`:''}<button class="btn btn-ghost" onclick="go('actionCenter')">Action Center</button></div></div>
    <div class="workflow-kpis">
      <button type="button" class="workflow-kpi workflow-kpi-link ${STATE.workflowFilter==='queue'?'active':''}" style="--accent:var(--amber)" onclick="workflowSetQuickFilter('queue')"><span class="k">Pending Queue</span><span class="v">${pending.length}</span><span class="s">All pending items</span></button>
      <button type="button" class="workflow-kpi workflow-kpi-link ${STATE.workflowFilter==='mine'?'active':''}" style="--accent:var(--ink)" onclick="workflowSetQuickFilter('mine')"><span class="k">My Work</span><span class="v">${my.length}</span><span class="s">Assigned to me</span></button>
      <button type="button" class="workflow-kpi workflow-kpi-link ${STATE.workflowFilter==='overdue'?'active':''}" style="--accent:${overdue.length?'var(--rust)':'var(--forest)'}" onclick="workflowSetQuickFilter('overdue')"><span class="k">Overdue</span><span class="v">${overdue.length}</span><span class="s">Past due date</span></button>
      <button type="button" class="workflow-kpi workflow-kpi-link ${STATE.workflowFilter==='due7'?'active':''}" style="--accent:var(--brass)" onclick="workflowSetQuickFilter('due7')"><span class="k">Due · 7d</span><span class="v">${due7.length}</span><span class="s">Upcoming deadlines</span></button>
      <button type="button" class="workflow-kpi workflow-kpi-link ${STATE.workflowFilter==='unassigned'?'active':''}" style="--accent:var(--forest)" onclick="workflowSetQuickFilter('unassigned')"><span class="k">Unassigned</span><span class="v">${unassigned.length}</span><span class="s">Needs an owner</span></button>
    </div>
    <div class="workflow-panel table-card workflow-table-card"><div class="workflow-toolbar data-toolbar"><label class="searchbox">${iSearch(15)}<input data-search-key="search" type="search" autocomplete="off" placeholder="Search task, employee, department…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderWorkflowCenter)"></label><select class="filter-select" aria-label="Workflow scope" onchange="STATE.workflowFilter=this.value;paginationReset(STATE,'workflow:list');renderWorkflowCenter()"><option value="queue" ${STATE.workflowFilter==='queue'?'selected':''}>Pending Queue</option><option value="mine" ${STATE.workflowFilter==='mine'?'selected':''}>My Work</option><option value="overdue" ${STATE.workflowFilter==='overdue'?'selected':''}>Overdue</option><option value="due7" ${STATE.workflowFilter==='due7'?'selected':''}>Due in 7 days</option><option value="unassigned" ${STATE.workflowFilter==='unassigned'?'selected':''}>Unassigned</option><option value="all" ${STATE.workflowFilter==='all'?'selected':''}>All Tasks</option></select><select class="filter-select" aria-label="Workflow status" onchange="STATE.workflowStatus=this.value;paginationReset(STATE,'workflow:list');renderWorkflowCenter()">${[...WORKFLOW_STATUS,'All'].map(value=>`<option value="${value}" ${STATE.workflowStatus===value?'selected':''}>${value==='All'?'All Statuses':value}</option>`).join('')}</select><select class="filter-select" aria-label="Workflow type" onchange="STATE.workflowType=this.value;paginationReset(STATE,'workflow:list');renderWorkflowCenter()"><option value="">All Types</option>${WORKFLOW_TYPES.map(t=>`<option value="${t}" ${STATE.workflowType===t?'selected':''}>${t}</option>`).join('')}</select><select class="filter-select" aria-label="Workflow priority" onchange="STATE.workflowPriority=this.value;paginationReset(STATE,'workflow:list');renderWorkflowCenter()"><option value="">All Priorities</option>${['Urgent','High','Normal','Low'].map(value=>`<option value="${value}" ${STATE.workflowPriority===value?'selected':''}>${value}</option>`).join('')}</select>${departments.length?`<select class="filter-select" aria-label="Workflow department" onchange="STATE.workflowDepartment=this.value;paginationReset(STATE,'workflow:list');renderWorkflowCenter()"><option value="">All Departments</option>${departments.map(value=>`<option value="${esc(value)}" ${STATE.workflowDepartment===value?'selected':''}>${esc(value)}</option>`).join('')}</select>`:''}${hasFilters?`<button class="btn btn-ghost btn-sm" onclick="workflowResetFilters()">Reset</button>`:''}</div>
    ${rows.length?`<div class="tablewrap workflow-table-scroll"><table class="data-table" data-server-paginated="true"><thead><tr><th>Task</th><th>Employee / Source</th><th>Department</th><th>Type</th><th>Priority</th><th>Due</th><th>Assignee</th><th>Status</th><th class="actions-head">Actions</th></tr></thead><tbody>${pageRows.map(t=>{const assignee=t.assigneeId?(DB.users.find(u=>String(u.id)===String(t.assigneeId))?.fullName||'Assigned'):'Unassigned';return `<tr><td><b>${esc(t.title)}</b>${t.description?`<div class="cell-secondary">${esc(t.description)}</div>`:''}</td><td>${esc(t.employeeName||workflowSourceTitle(t))}</td><td>${esc(t.department||'—')}</td><td>${esc(t.workflowType||'Task')}</td><td>${workflowPriorityBadge(t.priority)}</td><td><span class="workflow-due ${workflowTaskSeverity(t)}">${esc(workflowDueText(t))}</span></td><td>${esc(assignee)}</td><td>${statusBadge(t.status,workflowStatusMap)}</td><td><div class="rowactions">${workflowActionButtons(t)}</div></td></tr>`;}).join('')}</tbody></table></div><div class="table-pagination-wrap"><div class="table-pagination-meta">${page.meta.start?`${page.meta.start}–${page.meta.end}`:'0'} <span>of ${page.meta.total} workflow items</span></div>${paginationHTML(page.meta,'workflow:list',{go:'workflowPageGo',size:'workflowPageSize'})}</div>`:`<div class="workflow-empty"><b>No workflow items match this view.</b>Try another filter or create a manual HR task.</div>`}</div>
    <div class="notice" style="margin-top:12px;"><b>Workflow rule:</b> Source records remain the system of record. Approvals and task state coordinate HR work around those records and are retained in the audit trail.</div>`;
  document.getElementById('content').innerHTML=html;
}


/* ================================================================
   AUTOMATION ENGINE
   Browser-side rule runner with durable task/run metadata. The app
   remains the source of record; automation coordinates work around it.
   Server-side scheduled execution can be added later without changing
   the rule contracts below.
   ================================================================ */
const AUTOMATION_RULES = [
  {id:'probation_milestones',label:'Probation Milestone Prep',category:'Lifecycle',defaultEnabled:true,description:'Create a preparation task when a 30/90/180-day probation milestone is due within 14 days or is overdue.',windowDays:14},
  {id:'document_expiry',label:'Document Expiry Follow-up',category:'Documents',defaultEnabled:true,description:'Create a follow-up task for active documents expiring within 30 days.',windowDays:30},
  {id:'aged_cases',label:'Aged Case Review',category:'Employee Relations',defaultEnabled:true,description:'Flag open HR cases that have remained open for 30 days or more.',windowDays:30},
  {id:'case_deadline_priority',label:'Case Deadline Escalation',category:'Employee Relations',defaultEnabled:true,description:'Automatically raise workflow-task urgency as open case deadlines approach or pass.',windowDays:3},
  {id:'data_quality_followup',label:'Data Quality Follow-up',category:'Governance',defaultEnabled:true,description:'Create one governance task when the current data-quality scan contains material errors.',windowDays:0}
];
let AUTOMATION_RUNNING=false;
let AUTOMATION_TIMER=null;
function ensureAutomationSettings(){
  if(!DB.settings) DB.settings={orgName:'SCPA',probationDays:180};
  if(!DB.settings.automationRules) DB.settings.automationRules={};
  let changed=false;
  AUTOMATION_RULES.forEach(r=>{
    if(typeof DB.settings.automationRules[r.id] !== 'boolean'){ DB.settings.automationRules[r.id]=r.defaultEnabled; changed=true; }
  });
  return changed;
}
function automationRuleEnabled(id){ ensureAutomationSettings(); return DB.settings.automationRules[id]!==false; }
function automationPendingCount(){ return (DB.workflowTasks||[]).filter(t=>t.automationGenerated && t.status==='Pending' && workflowVisibleToSession(t)).length; }
function automationTaskKey(ruleId,key){ return `automation:${ruleId}:${key}`; }
function automationExistingTask(ruleId,key){ return (DB.workflowTasks||[]).find(t=>t.workflowKey===automationTaskKey(ruleId,key)); }
function automationUpsertTask(ruleId,key,patch){
  if(!DB.workflowTasks) DB.workflowTasks=[];
  const workflowKey=automationTaskKey(ruleId,key);
  let t=DB.workflowTasks.find(x=>x.workflowKey===workflowKey);
  if(!t){
    t={id:uid(),workflowKey,createdAt:new Date().toISOString(),createdBy:SESSION?.id||null,status:'Pending',automationGenerated:true,automationRuleId:ruleId};
    DB.workflowTasks.push(t);
  }
  Object.assign(t,patch,{workflowKey,automationGenerated:true,automationRuleId:ruleId});
  return t;
}
function automationCloseTask(ruleId,key,reason='Condition cleared'){
  const t=automationExistingTask(ruleId,key);
  if(!t || !['Pending','Rejected'].includes(t.status)) return false;
  t.status='Completed'; t.completedAt=t.completedAt||new Date().toISOString(); t.completedBy=t.completedBy||null; t.decision='Auto-completed'; t.autoCompletionReason=reason;
  return true;
}
function automationDateState(due,today=todayISO(),windowDays=14){
  if(!due) return 'none';
  if(due<today) return 'overdue';
  if(due<=addDaysISO(today,windowDays)) return 'upcoming';
  return 'future';
}
function automationTaskPriority(state){ return state==='overdue'?'Urgent':state==='upcoming'?'High':'Normal'; }
function automationRuleStateMap(){
  const out={};
  AUTOMATION_RULES.forEach(r=>out[r.id]={rule:r,created:0,updated:0,closed:0,active:0,errors:[]});
  return out;
}
async function runAutomationEngine({manual=false,silent=false}={}){
  if(AUTOMATION_RUNNING) return {skipped:true};
  AUTOMATION_RUNNING=true;
  const started=new Date().toISOString();
  const stats=automationRuleStateMap();
  const errors=[];
  try{
    let settingsChanged=ensureAutomationSettings();
    if(settingsChanged) await saveDB();
    await workflowSyncTasks({silent:true});
    const today=todayISO();

    // 1) Probation milestone preparation.
    if(automationRuleEnabled('probation_milestones')){
      const rstat=stats.probation_milestones;
      DB.employees.filter(e=>classify(e)==='Probationary' && e.dateHired).forEach(emp=>EVAL_MILESTONES.forEach(m=>{
        const due=evalDueDate(emp.dateHired,m.days); if(!due) return;
        const state=automationDateState(due,today,14);
        const ev=getEvalRecord(emp.id,m.key);
        const key=`${emp.id}:${m.key}`;
        if(ev?.completedDate || state==='future'){
          if(automationCloseTask('probation_milestones',key,ev?.completedDate?'Evaluation completed':'Outside automation window')) rstat.closed++;
          return;
        }
        if(state==='overdue'||state==='upcoming'){
          const existed=!!automationExistingTask('probation_milestones',key);
          const t=automationUpsertTask('probation_milestones',key,{workflowType:'Task',title:`Prepare ${m.label} evaluation — ${employeeDisplayName(emp)}`,description:`Probation milestone ${m.label} for ${employeeDisplayName(emp)}. ${state==='overdue'?'Milestone is overdue.':'Milestone is approaching.'}`,module:'evaluations',recordId:ev?.id||'',employeeRecordId:emp.id,employeeName:employeeDisplayName(emp),department:emp.department||'',priority:automationTaskPriority(state),dueDate:due,assigneeId:'',actionType:'evaluation_prep',status:'Pending'});
          if(existed) rstat.updated++; else rstat.created++;
          rstat.active++;
        }
      }));
    }

    // 2) Document expiration follow-up.
    if(automationRuleEnabled('document_expiry')){
      const rstat=stats.document_expiry;
      (DB.documents||[]).filter(d=>d.expirationDate && d.status!=='Archived').forEach(d=>{
        const state=automationDateState(d.expirationDate,today,30); const key=String(d.id);
        if(state==='future' || !state){ if(automationCloseTask('document_expiry',key,'Document is outside expiry window')) rstat.closed++; return; }
        const emp=DB.employees.find(e=>String(e.id)===String(d.employeeId));
        const owner=emp?.name||d.employeeName||'HR document';
        const existed=!!automationExistingTask('document_expiry',key);
        const t=automationUpsertTask('document_expiry',key,{workflowType:'Review',title:`Review document expiry — ${d.name||'Untitled document'}`,description:`${owner} · ${state==='overdue'?'Document has expired.':'Document expires soon.'}`,module:'documents',recordId:d.id,employeeName:owner,department:emp?.department||d.department||'',priority:state==='overdue'?'Urgent':'High',dueDate:d.expirationDate,assigneeId:'',actionType:'document_review',status:'Pending'});
        rstat.active++; if(existed) rstat.updated++; else rstat.created++;
      });
    }

    // 3) Aged case review (read-only query into source records).
    if(automationRuleEnabled('aged_cases')){
      const rstat=stats.aged_cases;
      const {data:cases,error}=await supabase.from('hr_cases').select('id,case_number,employee_record_id,employee_name,department,status,opened_at,assigned_to,priority,due_date,updated_at').order('updated_at',{ascending:false}).limit(1000);
      if(error) throw error;
      (cases||[]).forEach(c=>{
        const closed=['Closed','Cancelled','Resolved'].includes(c.status); const age=analyticsDaysOpen(c.opened_at,null);
        const key=String(c.id);
        if(closed || age<30){ if(automationCloseTask('aged_cases',key,closed?'Case closed':'Case is under 30 days old')) rstat.closed++; return; }
        const existed=!!automationExistingTask('aged_cases',key);
        const t=automationUpsertTask('aged_cases',key,{workflowType:'Review',title:`Review aged HR case — ${c.case_number||'HR Case'}`,description:`${c.employee_name||'Employee'} · Open ${age} days${c.department?' · '+c.department:''}`,module:'cases',recordId:c.id,employeeRecordId:c.employee_record_id||'',employeeName:c.employee_name||'',department:c.department||'',priority:age>=60?'Urgent':'High',dueDate:c.due_date||today,assigneeId:c.assigned_to||'',actionType:'case_review',status:'Pending'});
        rstat.active++; if(existed) rstat.updated++; else rstat.created++;
      });
    }

    // 4) Escalate task urgency around case deadlines.
    if(automationRuleEnabled('case_deadline_priority')){
      const rstat=stats.case_deadline_priority;
      (DB.workflowTasks||[]).filter(t=>t.module==='cases'&&t.status==='Pending'&&t.dueDate).forEach(t=>{
        const state=automationDateState(t.dueDate,today,3); const next=state==='overdue'?'Urgent':state==='upcoming'?'High':(t.priority||'Normal');
        if(['overdue','upcoming'].includes(state) && t.priority!==next){t.priority=next;t.lastAutomationUpdateAt=new Date().toISOString();rstat.updated++;}
        if(state==='overdue'||state==='upcoming') rstat.active++;
      });
    }

    // 5) One governance task when there are material errors.
    if(automationRuleEnabled('data_quality_followup')){
      const rstat=stats.data_quality_followup;
      let caseRows=[];
      try{ const q=await supabase.from('hr_cases').select('id,case_number,employee_name,department,status,opened_at,closed_at,updated_at').order('updated_at',{ascending:false}).limit(1000); if(!q.error) caseRows=q.data||[]; }catch(e){}
      const errors=(typeof qualityIssues==='function'?qualityIssues(caseRows).filter(x=>x.severity==='error'):[]);
      const key='global';
      if(errors.length){
        const t=automationUpsertTask('data_quality_followup',key,{workflowType:'Review',title:'Review HR data-quality errors',description:`${errors.length} material data-quality error${errors.length===1?'':'s'} require HR review.`,module:'dataQuality',recordId:'',employeeName:'',department:'',priority:errors.length>=5?'Urgent':'High',dueDate:'',assigneeId:'',actionType:'data_quality_review',status:'Pending'});
        rstat.active++; if(t.createdAt===t.lastAutomationCreatedAt) rstat.created++; else rstat.updated++; t.lastAutomationCreatedAt=t.createdAt;
      } else if(automationCloseTask('data_quality_followup',key,'No material data-quality errors remain')) rstat.closed++;
    }

    const changedTasks=JSON.stringify(DB.workflowTasks);
    // Persist automation run plus task changes together. saveDB is idempotent through hr_records.
    const totalCreated=Object.values(stats).reduce((n,x)=>n+x.created,0);
    const totalUpdated=Object.values(stats).reduce((n,x)=>n+x.updated,0);
    const totalClosed=Object.values(stats).reduce((n,x)=>n+x.closed,0);
    DB.automationRuns=DB.automationRuns||[];
    DB.automationRuns.unshift({id:uid(),runAt:started,completedAt:new Date().toISOString(),runBy:SESSION?.id||null,mode:manual?'Manual':'Automatic',created:totalCreated,updated:totalUpdated,closed:totalClosed,errors:errors.length,summary:{rules:Object.values(stats).map(x=>({ruleId:x.rule.id,created:x.created,updated:x.updated,closed:x.closed,active:x.active,errors:x.errors.length}))}});
    DB.automationRuns=DB.automationRuns.slice(0,100);
    await saveDB();
    await refreshNotificationBadge();
    renderNav();
    if(!silent && manual) toast(`Automation run complete · ${totalCreated} created, ${totalUpdated} updated, ${totalClosed} closed.`);
    return {created:totalCreated,updated:totalUpdated,closed:totalClosed,errors:errors.length,stats};
  }catch(e){
    errors.push(e.message||String(e));
    DB.automationRuns=DB.automationRuns||[];
    DB.automationRuns.unshift({id:uid(),runAt:started,completedAt:new Date().toISOString(),runBy:SESSION?.id||null,mode:manual?'Manual':'Automatic',created:0,updated:0,closed:0,errors:1,summary:{error:e.message||String(e)}});
    DB.automationRuns=DB.automationRuns.slice(0,100);
    try{ await saveDB(); }catch(saveErr){ if(!silent) toast('Automation run failed to save: '+saveErr.message,true); }
    if(!silent) toast('Automation run failed: '+(e.message||e),true);
    return {created:0,updated:0,closed:0,errors:1,error:e.message||String(e)};
  }finally{ AUTOMATION_RUNNING=false; }
}
async function toggleAutomationRule(id,enabled){
  if(!canEdit()) return;
  ensureAutomationSettings();
  DB.settings.automationRules[id]=!!enabled;
  await saveDB();
  logAudit(`${enabled?'Enabled':'Disabled'} automation rule: ${AUTOMATION_RULES.find(r=>r.id===id)?.label||id}`);
  toast(`Automation rule ${enabled?'enabled':'disabled'}.`);
  await runAutomationEngine({manual:false,silent:true});
  renderAutomationCenter();
}
function automationRunSummary(run){
  if(!run) return 'No automation runs yet.';
  if(run.summary?.error) return run.summary.error;
  return `${run.created||0} created · ${run.updated||0} updated · ${run.closed||0} closed${run.errors?' · '+run.errors+' error'+(run.errors===1?'':'s'):''}`;
}
function automationLastRun(){ return (DB.automationRuns||[]).slice().sort((a,b)=>String(b.runAt||'').localeCompare(String(a.runAt||'')))[0]||null; }
function automationOpenTask(id){ openWorkflowTask(id); }
async function renderAutomationCenter(){
  setTitle('Automation Center','Automatic HR task generation, deadline escalation, lifecycle preparation, and governance follow-up.');
  document.getElementById('content').innerHTML='<div class="panel"><div class="desc">Running current HR automation rules…</div></div>';
  await runAutomationEngine({silent:true});
  ensureAutomationSettings();
  const tasks=(DB.workflowTasks||[]).filter(t=>t.automationGenerated);
  const pending=tasks.filter(t=>t.status==='Pending');
  const overdue=pending.filter(t=>t.dueDate&&t.dueDate<todayISO());
  const last=automationLastRun();
  const enabled=AUTOMATION_RULES.filter(r=>automationRuleEnabled(r.id)).length;
  const q=(STATE.automationSearch||'').toLowerCase().trim();
  const visibleTasks=pending.filter(t=>!q||[t.title,t.description,t.employeeName,t.department,t.automationRuleId].some(v=>String(v||'').toLowerCase().includes(q)));
  const taskPage=paginateRows(visibleTasks,STATE,'automation:tasks',10);
  const runs=(DB.automationRuns||[]).slice().sort((a,b)=>String(b.runAt||'').localeCompare(String(a.runAt||''))).slice(0,8);
  const byRule={}; pending.forEach(t=>byRule[t.automationRuleId]=(byRule[t.automationRuleId]||0)+1);
  const html=`<div class="automation-hero"><div><h1>Automation Center</h1><p>Rules continuously inspect existing HR records and coordinate work through the Workflow &amp; Approvals engine. Automation does not make personnel decisions or overwrite source HR records.</p></div><div class="automation-actions">${canEdit()?`<button class="btn btn-brass" onclick="runAutomationEngine({manual:true}).then(()=>renderAutomationCenter())">${iCheck(15)} Run Now</button>`:''}<button class="btn btn-ghost" onclick="go('workflow')">Open Workflow</button><button class="btn btn-ghost" onclick="go('dataQuality')">Data Quality</button></div></div>
    <div class="automation-kpis">
      <div class="automation-kpi" style="--accent:var(--ink)"><div class="k">Enabled Rules</div><div class="v">${enabled}</div><div class="s">${AUTOMATION_RULES.length} configured rule${AUTOMATION_RULES.length===1?'':'s'}</div></div>
      <div class="automation-kpi" style="--accent:${pending.length?'var(--amber)':'var(--forest)'}"><div class="k">Automation Tasks</div><div class="v">${pending.length}</div><div class="s">Pending generated work</div></div>
      <div class="automation-kpi" style="--accent:${overdue.length?'var(--rust)':'var(--forest)'}"><div class="k">Overdue</div><div class="v">${overdue.length}</div><div class="s">Generated tasks past due</div></div>
      <div class="automation-kpi" style="--accent:var(--brass)"><div class="k">Last Run</div><div class="v" style="font-size:16px;line-height:1.2;">${last?fmtDate(String(last.runAt).slice(0,10)):'—'}</div><div class="s">${last?automationRunSummary(last):'Automation has not run yet'}</div></div>
    </div>
    <div class="automation-grid">
      <div class="automation-panel"><div class="automation-panel-head"><div><h3>Automation Rules</h3><div class="desc">Built-in HR rules that create or update operational work.</div></div></div><div class="automation-rule-list">${AUTOMATION_RULES.map(r=>`<div class="automation-rule ${automationRuleEnabled(r.id)?'':'disabled'}"><div><div class="title">${esc(r.label)}</div><div class="desc">${esc(r.description)}</div><div class="meta"><span class="tag">${esc(r.category)}</span><span class="tag">${byRule[r.id]||0} pending</span></div></div><label class="automation-switch"><input type="checkbox" ${automationRuleEnabled(r.id)?'checked':''} ${canEdit()?'':'disabled'} onchange="toggleAutomationRule('${esc(r.id)}',this.checked)"> Enabled</label><button class="btn btn-ghost btn-sm" onclick="go('workflow')">View Work</button></div>`).join('')}</div><div class="automation-rule-note"><b>Execution model:</b> the current browser deployment runs automation when the application opens and on a periodic timer while it remains open. It is designed so a secure server-side scheduler can later call the same rule contracts without exposing service credentials in the frontend.</div></div>
      <div class="automation-panel"><div class="automation-panel-head"><div><h3>Automation Health</h3><div class="desc">Current generated workload and latest run status.</div></div></div><div style="padding:9px;">${Object.entries(byRule).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([id,n])=>{const r=AUTOMATION_RULES.find(x=>x.id===id);return `<div class="automation-insight"><div class="k">${esc(r?.category||id)}</div><div class="v">${n}</div><div class="s">${esc(r?.label||id)} currently has pending generated work.</div></div>`;}).join('')||'<div class="automation-empty"><b>No generated work</b>Current automation rules have no pending tasks.</div>'}${last?`<div class="automation-insight"><div class="k">Latest Run</div><div class="v" style="font-size:16px;">${esc(last.mode||'Automatic')}</div><div class="s">${fmtDate(String(last.runAt||'').slice(0,10))} · ${esc(automationRunSummary(last))}</div></div>`:''}</div></div>
    </div>
    <div class="automation-panel" style="margin-bottom:16px;"><div class="automation-panel-head"><div><h3>Generated Work</h3><div class="desc">Automation-created tasks appear in the same Workflow &amp; Approvals queue used by HR staff.</div></div></div><div class="automation-rule-note" style="margin:9px 9px 0;"><b>Search:</b> <input class="field" data-search-key="automationSearch" type="search" autocomplete="off" style="margin:0;padding:8px 10px;width:100%;border:1px solid var(--line-2);border-radius:7px;" placeholder="Search generated tasks, employees, departments…" value="${esc(STATE.automationSearch||'')}" oninput="queueSearchRender(this,'automationSearch',renderAutomationCenter)"></div><div class="automation-run-list">${taskPage.rows.map(t=>`<div class="automation-run-row ${t.status==='Pending'&&t.dueDate&&t.dueDate<todayISO()?'failed':''}"><span class="dot"></span><div><div class="title">${esc(t.title)}</div><div class="meta">${esc(t.description||'')}${t.employeeName?' · '+esc(t.employeeName):''}${t.dueDate?' · Due '+esc(fmtDate(t.dueDate)):''}</div></div><div class="right"><button class="btn btn-ghost btn-sm" onclick="automationOpenTask('${esc(t.id)}')">Open</button></div></div>`).join('')||'<div class="automation-empty"><b>No pending generated tasks</b>Automation is currently caught up.</div>'}</div>${taskPage.meta.total?`<div class="table-pagination-wrap"><div class="table-pagination-meta">${taskPage.meta.start}–${taskPage.meta.end} <span>of ${taskPage.meta.total} generated tasks</span></div>${paginationHTML(taskPage.meta,'automation:tasks',{go:'automationPageGo',size:'automationPageSize'})}</div>`:''}</div>
    <div class="automation-panel"><div class="automation-panel-head"><div><h3>Recent Automation Runs</h3><div class="desc">Durable run history retained in the HR record store.</div></div></div><div class="automation-run-list">${runs.length?runs.map(run=>`<div class="automation-run-row ${run.errors?'failed':''}"><span class="dot"></span><div><div class="title">${esc(run.mode||'Automatic')} automation run</div><div class="meta">${fmtDate(String(run.runAt||'').slice(0,10))} · ${esc(automationRunSummary(run))}</div></div><div class="right small">${run.completedAt?esc(String(run.completedAt).slice(11,16)):''}</div></div>`).join(''):'<div class="automation-empty"><b>No runs recorded</b>The automation engine will create a run entry after its first execution.</div>'}</div></div>`;
  document.getElementById('content').innerHTML=html;
}

/* ================================================================
   MODULE DEFINITIONS (leaves handled by custom view above but still
   registered for the modal/CRUD/export helpers; nte, memos, nod, oncall
   use the generic table view)
   ================================================================ */
const MODULES = {
  leaves: {
    title:'Leave Tracker', subtitle:'Upload, monitor, and manage employee leave records.', singular:'Leave Record', addLabel:'Add Leave Record',
    searchFields:['employeeName','department'], sortKey:'startDate',
    fields:[
      {key:'employeeName', label:'Employee Name', type:'text', required:true},
      {key:'position', label:'Position', type:'text'},
      {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, required:true},
      {key:'leaveType', label:'Type of Leave', type:'select', options:LEAVE_TYPES, required:true},
      {key:'startDate', label:'Leave Start Date', type:'date', required:true},
      {key:'endDate', label:'Leave End Date', type:'date', required:true},
      {key:'dateApplied', label:'Date of Application', type:'date'},
      {key:'dateReceived', label:'Date Received', type:'date'},
      {key:'reason', label:'Reason for Leave', type:'textarea'},
      {key:'attachment', label:'Uploaded Leave Form', type:'file', full:true},
      {key:'status', label:'Leave Status', type:'select', options:LEAVE_STATUS, required:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    computedNote:'Total leave days are calculated automatically as (End Date − Start Date + 1) and shown in the records table.',
    columns:[
      {key:'employeeName', label:'Employee', render:r=>`<b>${esc(r.employeeName)}</b>`},
      {key:'department', label:'Department'},
      {key:'leaveType', label:'Type'},
      {key:'startDate', label:'Start', render:r=>fmtDate(r.startDate)},
      {key:'endDate', label:'End', render:r=>fmtDate(r.endDate)},
      {key:'days', label:'Days', render:r=>daysBetweenInclusive(r.startDate,r.endDate)||'—', csv:r=>daysBetweenInclusive(r.startDate,r.endDate)},
      {key:'status', label:'Status', render:r=>statusBadge(r.status, LEAVE_STATUS_MAP)},
    ],
  },
  disciplinary:{ title:'Disciplinary Action', subtitle:'', singular:'Disciplinary Record', addLabel:'Add Record',
    searchFields:['employeeName','violation'], sortKey:'dateOfIncident',
    fields:[
      {key:'employeeName', label:'Employee Name', type:'text', required:true},
      {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, required:true},
      {key:'violation', label:'Violation Committed', type:'text', required:true, full:true},
      {key:'dateOfIncident', label:'Date of Incident', type:'date', required:true},
      {key:'action', label:'Disciplinary Action Taken', type:'text', full:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    columns:[ // used for CSV export only — table itself is custom-rendered in renderDisciplinary()
      {key:'employeeName', label:'Employee'},
      {key:'department', label:'Department'},
      {key:'violation', label:'Violation'},
      {key:'offenseLevel', label:'Offense Level', csv:r=>offenseLevelFor(r.employeeName,r.violation,r.id)},
      {key:'dateOfIncident', label:'Date'},
      {key:'action', label:'Action'},
      {key:'remarks', label:'Remarks'},
    ],
  },
  nte:{ title:'Notice to Explain (NTE)', subtitle:'Track NTE issuance, receipt, and employee explanations.', singular:'NTE Record', addLabel:'Add NTE',
    searchFields:['employeeName','violation'], sortKey:'dateIssued', filterField:'status', filterOptions:NTE_STATUS, filterLabel:'Status',
    notice:`Uploaded NTE documents use the storage destination selected by the System Administrator (up to ${Math.round(MAX_ATTACH_BYTES/1024/1024)}MB each). Dates and text are not extracted automatically here.`,
    fields:[
      {key:'employeeName', label:'Employee Name', type:'text', required:true},
      {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, required:true},
      {key:'violation', label:'Violation / Offense', type:'text', required:true, full:true},
      {key:'dateIssued', label:'Date of NTE Issuance', type:'date', required:true},
      {key:'dateReceived', label:'Date NTE Received', type:'date'},
      {key:'attachment', label:'Uploaded NTE Document', type:'file', full:true},
      {key:'explanation', label:"Employee's Written Explanation", type:'textarea'},
      {key:'status', label:'NTE Status', type:'select', options:NTE_STATUS, required:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    columns:[
      {key:'employeeName', label:'Employee', render:r=>`<b>${esc(r.employeeName)}</b>`},
      {key:'department', label:'Department'},
      {key:'violation', label:'Violation'},
      {key:'dateIssued', label:'Issued', render:r=>fmtDate(r.dateIssued)},
      {key:'dateReceived', label:'Received', render:r=>fmtDate(r.dateReceived)},
      {key:'attachment', label:'Attachment', render:r=>attachCellHTML('nte',r,'attachment'), csv:r=>r.attachment||''},
      {key:'status', label:'Status', render:r=>statusBadge(r.status, NTE_STATUS_MAP)},
    ],
  },
  memos:{ title:'Memorandum of Offense', subtitle:'Monitor memoranda issued for disciplinary offenses.', singular:'Memorandum', addLabel:'Add Memorandum',
    searchFields:['employeeName','offenseType'], sortKey:'dateOfMemo',
    fields:[
      {key:'employeeName', label:'Employee Name', type:'text', required:true},
      {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, required:true},
      {key:'offenseType', label:'Type of Offense', type:'text', required:true},
      {key:'action', label:'Disciplinary Action', type:'text', required:true},
      {key:'dateOfMemo', label:'Date of Memorandum', type:'date', required:true},
      {key:'dateReceived', label:'Date Received', type:'date'},
      {key:'attachment', label:'Uploaded Memorandum', type:'file', full:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    columns:[
      {key:'employeeName', label:'Employee', render:r=>`<b>${esc(r.employeeName)}</b>`},
      {key:'department', label:'Department'},
      {key:'offenseType', label:'Offense'},
      {key:'action', label:'Action'},
      {key:'dateOfMemo', label:'Date', render:r=>fmtDate(r.dateOfMemo)},
      {key:'dateReceived', label:'Received', render:r=>fmtDate(r.dateReceived)},
      {key:'attachment', label:'Attachment', render:r=>attachCellHTML('memos',r,'attachment'), csv:r=>r.attachment||''},
    ],
  },
  nod:{ title:'Notice of Decision (NOD)', subtitle:'Track final disciplinary decisions.', singular:'Notice of Decision', addLabel:'Add NOD',
    searchFields:['employeeName','relatedOffense'], sortKey:'dateOfNod',
    fields:[
      {key:'employeeName', label:'Employee Name', type:'text', required:true},
      {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, required:true},
      {key:'relatedOffense', label:'Related Offense', type:'text', required:true, full:true},
      {key:'dateOfNod', label:'Date of NOD', type:'date', required:true},
      {key:'dateReceived', label:'Date Received', type:'date'},
      {key:'finalAction', label:'Final Disciplinary Action', type:'text', full:true, required:true},
      {key:'attachment', label:'Uploaded NOD Document', type:'file', full:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    columns:[
      {key:'employeeName', label:'Employee', render:r=>`<b>${esc(r.employeeName)}</b>`},
      {key:'department', label:'Department'},
      {key:'relatedOffense', label:'Related Offense'},
      {key:'dateOfNod', label:'Date of NOD', render:r=>fmtDate(r.dateOfNod)},
      {key:'finalAction', label:'Final Action'},
      {key:'attachment', label:'Attachment', render:r=>attachCellHTML('nod',r,'attachment'), csv:r=>r.attachment||''},
    ],
  },
  oncall:{ title:'On-Call / Replacement', subtitle:'Monitor on-call employees and replacement personnel.', singular:'On-Call Record', addLabel:'Add On-Call Record',
    searchFields:['employeeName','prfNumber','employeeReplaced'], sortKey:'startDate', filterField:'status', filterOptions:ONCALL_STATUS, filterLabel:'Status',
    fields:[
      {key:'employeeName', label:'Employee Name', type:'text', required:true},
      {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, required:true},
      {key:'prfNumber', label:'PRF Number (optional)', type:'text'},
      {key:'reason', label:'Reason for Request', type:'text', full:true, required:true},
      {key:'employeeReplaced', label:'Employee Being Replaced', type:'text'},
      {key:'startDate', label:'Start Date', type:'date', required:true},
      {key:'endDate', label:'End Date', type:'date', required:true},
      {key:'status', label:'On-Call Status', type:'select', options:ONCALL_STATUS, required:true},
      {key:'attachment', label:'Uploaded PRF Document / Leave Form', type:'file', full:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    computedNote:'Total number of days is calculated automatically from Start Date and End Date.',
    columns:[
      {key:'employeeName', label:'Employee', render:r=>`<b>${esc(r.employeeName)}</b>`},
      {key:'department', label:'Department'},
      {key:'prfNumber', label:'PRF No.'},
      {key:'employeeReplaced', label:'Replacing'},
      {key:'startDate', label:'Start', render:r=>fmtDate(r.startDate)},
      {key:'endDate', label:'End', render:r=>fmtDate(r.endDate)},
      {key:'days', label:'Days', render:r=>daysBetweenInclusive(r.startDate,r.endDate)||'—', csv:r=>daysBetweenInclusive(r.startDate,r.endDate)},
      {key:'attachment', label:'Attachment', render:r=>attachCellHTML('oncall',r,'attachment'), csv:r=>r.attachment||''},
      {key:'status', label:'Status', render:r=>statusBadge(r.status, ONCALL_STATUS_MAP)},
    ],
  },
  transfers:{ title:'Department Transfers', subtitle:'Track employees moved between departments, with the date of each move.', singular:'Transfer Record', addLabel:'Add Transfer Record',
    searchFields:['employeeName','fromDepartment','toDepartment'], sortKey:'toDate',
    notice:"Use the transfer icon on an employee's row in Employee Information to record a move — that also updates the employee's current department automatically. Adding a record here manually logs history only and does not change the employee record.",
    fields:[
      {key:'employeeName', label:'Employee Name', type:'text', required:true},
      {key:'fromDepartment', label:'Transferred From', type:'select', options:employeeDepartmentNames, required:true},
      {key:'fromDate', label:'From Date', type:'date', required:true},
      {key:'toDepartment', label:'Transferred To', type:'select', options:employeeDepartmentNames, required:true},
      {key:'toDate', label:'To Date', type:'date', required:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    columns:[
      {key:'employeeName', label:'Employee', render:r=>`<b>${esc(r.employeeName)}</b>`},
      {key:'fromDepartment', label:'From'},
      {key:'fromDate', label:'From Date', render:r=>fmtDate(r.fromDate)},
      {key:'toDepartment', label:'To'},
      {key:'toDate', label:'To Date', render:r=>fmtDate(r.toDate)},
      {key:'remarks', label:'Remarks'},
    ],
  },
  offenseCatalog:{ title:'Offense Catalog', subtitle:"Your agency's disciplinary offense list and consequence per occurrence — CVR uses this to compute offense level automatically.", singular:'Offense', addLabel:'Add Offense',
    searchFields:['offense'], sortKey:'offense',
    notice:"Add every offense from your agency's disciplinary matrix here, with the consequence for each occurrence. CVR records reference this list automatically to determine the offense level and consequence.",
    fields:[
      {key:'offense', label:'Offense / Violation', type:'text', required:true, full:true},
      {key:'consequence1', label:'1st Offense — Consequence', type:'text', full:true},
      {key:'consequence2', label:'2nd Offense — Consequence', type:'text', full:true},
      {key:'consequence3', label:'3rd Offense — Consequence', type:'text', full:true},
      {key:'consequence4', label:'4th Offense+ — Consequence', type:'text', full:true},
    ],
    columns:[
      {key:'offense', label:'Offense', render:r=>`<b>${esc(r.offense)}</b>`},
      {key:'consequence1', label:'1st'},
      {key:'consequence2', label:'2nd'},
      {key:'consequence3', label:'3rd'},
      {key:'consequence4', label:'4th+'},
    ],
  },
  prf:{ title:'PRF / Replacement Tracking', subtitle:'Personnel Request Forms — replacement and additional manpower requests.', singular:'PRF Record', addLabel:'Add PRF Record',
    searchFields:['employeeName','prfNumber','employeeReplaced'], sortKey:'dateOfRequest',
    fields:[
      {key:'employeeName', label:'Employee Name (hired/assigned)', type:'text', required:true},
      {key:'department', label:'Department', type:'select', options:employeeDepartmentNames, required:true},
      {key:'prfNumber', label:'PRF Number (optional)', type:'text'},
      {key:'dateOfRequest', label:'Date of Request', type:'date', required:true},
      {key:'reasonForRequest', label:'Reason for Manpower Request', type:'text', full:true, required:true},
      {key:'classification', label:'Classification', type:'select', options:PRF_CLASS, required:true},
      {key:'employeeReplaced', label:'Employee Being Replaced (if applicable)', type:'text'},
      {key:'status', label:'Workflow Status', type:'select', options:PRF_STATUS, required:true, default:()=>PRF_STATUS[1]},
      {key:'attachment', label:'Uploaded PRF Document', type:'file', full:true},
      {key:'remarks', label:'Remarks', type:'textarea'},
    ],
    columns:[
      {key:'employeeName', label:'Employee', render:r=>`<b>${esc(r.employeeName)}</b>`},
      {key:'department', label:'Department'},
      {key:'prfNumber', label:'PRF No.'},
      {key:'classification', label:'Classification'},
      {key:'employeeReplaced', label:'Replacing'},
      {key:'dateOfRequest', label:'Date', render:r=>fmtDate(r.dateOfRequest)},
      {key:'status', label:'Status', render:r=>statusBadge(r.status||'Draft',PRF_STATUS_MAP)},
      {key:'attachment', label:'Attachment', render:r=>attachCellHTML('prf',r,'attachment'), csv:r=>r.attachment||''},
    ],
  },
};

/* ================================================================
   MANAGEMENT ANALYTICS
   ================================================================ */
function analyticsDateFor(module,rec){
  if(module==='employees') return rec.dateHired||'';
  if(module==='leaves') return rec.startDate||rec.dateApplied||'';
  if(module==='disciplinary') return rec.dateOfIncident||'';
  if(module==='nte') return rec.dateIssued||rec.dateReceived||'';
  if(module==='memos') return rec.dateOfMemo||rec.dateReceived||'';
  if(module==='nod') return rec.dateOfNod||rec.dateReceived||'';
  if(module==='oncall') return rec.startDate||'';
  if(module==='transfers') return rec.toDate||rec.fromDate||'';
  if(module==='cvr') return rec.dateOfCVR||'';
  if(module==='incidents') return rec.dateOfIncident||'';
  if(module==='prf') return rec.dateOfRequest||'';
  if(module==='evaluations') return rec.completedDate||'';
  if(module==='atd') return rec.atdDate||'';
  return '';
}
function analyticsMonthLabel(date){
  if(!date) return '';
  const d=new Date(date+'T00:00:00');
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US',{month:'short',year:'numeric'});
}
function analyticsDaysOpen(openedAt, closedAt){
  if(!openedAt) return 0;
  const end=closedAt||todayISO();
  const a=new Date(openedAt+'T00:00:00'), b=new Date(end+'T00:00:00');
  return Math.max(0,Math.floor((b-a)/86400000));
}
function analyticsEsc(value){ return esc(value==null?'':value); }
function analyticsPresetRange(preset){
  const end=todayISO();
  const starts={
    '30d':addDaysISO(end,-29),
    '90d':addDaysISO(end,-89),
    '180d':addDaysISO(end,-179),
    '365d':addDaysISO(end,-364)
  };
  return {start:starts[preset]||STATE.analyticsStart||addDaysISO(end,-89),end};
}
function analyticsApplyFilters(){
  const start=document.getElementById('analytics-start')?.value||todayISO();
  const end=document.getElementById('analytics-end')?.value||todayISO();
  const dept=document.getElementById('analytics-dept')?.value||'';
  if(end<start){toast('Analytics end date cannot be before the start date.',true);return;}
  STATE.analyticsStart=start; STATE.analyticsEnd=end; STATE.analyticsDept=dept; STATE.analyticsRange='custom'; renderAnalytics();
}
function analyticsSetPreset(preset){
  const r=analyticsPresetRange(preset); STATE.analyticsRange=preset; STATE.analyticsStart=r.start; STATE.analyticsEnd=r.end;
  renderAnalytics();
}
function analyticsMonthKey(date){
  const s=String(date||'').slice(0,7); return /^\d{4}-\d{2}$/.test(s)?s:'';
}
function analyticsMonthLabelFromKey(key){
  if(!key) return '';
  const d=new Date(key+'-01T00:00:00'); return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-US',{month:'short'});
}
function analyticsMonthRange(endISO,count=6){
  const end=new Date(String(endISO||todayISO()).slice(0,10)+'T00:00:00');
  const out=[];
  for(let i=count-1;i>=0;i--){const d=new Date(end); d.setMonth(d.getMonth()-i); out.push(d.toISOString().slice(0,7));}
  return out;
}
function analyticsStatusMap(rows,key){
  const o={}; (rows||[]).forEach(r=>{const v=r?.[key]||'Unspecified';o[v]=(o[v]||0)+1;}); return o;
}
function analyticsDeptFilterRows(module,start,end,dept){
  return (DB[module]||[]).filter(r=>{
    const d=reportDateFor(module,r); if(!reportInRange(d,start,end)) return false;
    return reportDeptMatch(r,dept);
  });
}
async function exportAnalyticsSnapshot(){
  if(!requireExportAccess())return;
  const start=STATE.analyticsStart||addDaysISO(todayISO(),-89), end=STATE.analyticsEnd||todayISO(), dept=STATE.analyticsDept||'';
  const employees=DB.employees.filter(e=>reportDeptMatch(e,dept));
  const cases=(REPORT_CACHE.cases||[]).filter(c=>!dept||(c.department||'Unassigned')===dept);
  const openCases=cases.filter(c=>!['Closed','Cancelled','Resolved'].includes(c.status));
  const rows=[
    {section:'Scope',metric:'Start Date',value:start,detail:dept||'All Departments'},
    {section:'Scope',metric:'End Date',value:end,detail:dept||'All Departments'},
    {section:'Workforce',metric:'Current Headcount',value:employees.length,detail:'Current employee records'},
    {section:'Workforce',metric:'Probationary',value:employees.filter(e=>classify(e)==='Probationary').length,detail:'Current classification'},
    {section:'Workforce',metric:'New Hires in Period',value:employees.filter(e=>reportInRange(e.dateHired,start,end)).length,detail:'Date hired'},
    {section:'Workforce',metric:'Separations in Period',value:employees.filter(e=>['Resigned','AWOL','Separated'].includes(e.status)&&reportInRange(e.statusDate,start,end)).length,detail:'Status date'},
    {section:'Cases',metric:'Open Cases',value:openCases.length,detail:'Current open cases'},
    {section:'Cases',metric:'Cases in Period',value:cases.filter(c=>reportInRange(String(c.opened_at||c.updated_at||'').slice(0,10),start,end)).length,detail:'Opened/updated'},
    {section:'Cases',metric:'30+ Days Open',value:openCases.filter(c=>analyticsDaysOpen(c.opened_at)>=30).length,detail:'Current aging'},
    {section:'Leave',metric:'Leave Records in Period',value:analyticsDeptFilterRows('leaves',start,end,dept).length,detail:'Selected period'},
    {section:'Attendance',metric:'ATD Records in Period',value:analyticsDeptFilterRows('atd',start,end,dept).length,detail:'Selected period'},
    {section:'Discipline',metric:'Disciplinary Records in Period',value:analyticsDeptFilterRows('disciplinary',start,end,dept).length,detail:'Selected period'},
  ];
  exportReportRows(`hr_analytics_${start}_to_${end}.csv`,rows,[{label:'Section',get:r=>r.section},{label:'Metric',get:r=>r.metric},{label:'Value',get:r=>r.value},{label:'Detail',get:r=>r.detail}]);
}
async function renderAnalytics(){
  setTitle('Management Analytics','A decision-support view of workforce, cases, HR activity, and trends across the selected reporting period.');
  document.getElementById('content').innerHTML='<div class="panel"><div class="desc">Loading advanced analytics…</div></div>';
  try{
    const start=STATE.analyticsStart||addDaysISO(todayISO(),-89), end=STATE.analyticsEnd||todayISO(), dept=STATE.analyticsDept||'';
    if(end<start){document.getElementById('content').innerHTML='<div class="panel"><div class="notice"><b>Invalid analytics period.</b> The end date must be on or after the start date.</div></div>';return;}
    const {data:cases,error:caseError}=await supabase.from('hr_cases').select('id,case_number,employee_name,department,status,priority,due_date,opened_at,closed_at,updated_at,assigned_to').order('updated_at',{ascending:false}).limit(1500);
    if(caseError) throw caseError;
    const allCases=cases||[]; REPORT_CACHE.cases=allCases;
    const caseScope=allCases.filter(c=>!dept||(c.department||'Unassigned')===dept);
    const periodCases=caseScope.filter(c=>reportInRange(String(c.opened_at||c.updated_at||'').slice(0,10),start,end));
    const openCases=caseScope.filter(c=>!['Closed','Cancelled','Resolved'].includes(c.status));
    const overdueCases=openCases.filter(c=>c.due_date && c.due_date<todayISO());
    const agingBuckets=[
      ['0–7 days',openCases.filter(c=>analyticsDaysOpen(c.opened_at)<=7).length],
      ['8–30 days',openCases.filter(c=>{const d=analyticsDaysOpen(c.opened_at);return d>=8&&d<=30;}).length],
      ['31–60 days',openCases.filter(c=>{const d=analyticsDaysOpen(c.opened_at);return d>=31&&d<=60;}).length],
      ['61+ days',openCases.filter(c=>analyticsDaysOpen(c.opened_at)>=61).length]
    ];
    const employees=DB.employees.filter(e=>reportDeptMatch(e,dept));
    const hired=employees.filter(e=>reportInRange(e.dateHired,start,end));
    const separated=employees.filter(e=>['Resigned','AWOL','Separated'].includes(e.status)&&reportInRange(e.statusDate,start,end));
    const activeEmployees=employees.filter(e=>e.status==='Active'||e.status==='Newly Hired');
    const probationary=employees.filter(e=>classify(e)==='Probationary');
    const evalOverdue=probationary.reduce((sum,e)=>sum+EVAL_MILESTONES.filter(m=>evalStatusInfo(e,m).label==='Overdue').length,0);
    const leaveRows=analyticsDeptFilterRows('leaves',start,end,dept);
    const incidentRows=analyticsDeptFilterRows('incidents',start,end,dept);
    const cvrRows=analyticsDeptFilterRows('cvr',start,end,dept);
    const discRows=analyticsDeptFilterRows('disciplinary',start,end,dept);
    const nteRows=analyticsDeptFilterRows('nte',start,end,dept);
    const memoRows=analyticsDeptFilterRows('memos',start,end,dept);
    const nodRows=analyticsDeptFilterRows('nod',start,end,dept);
    const transferRows=analyticsDeptFilterRows('transfers',start,end,dept);
    const atdRows=analyticsDeptFilterRows('atd',start,end,dept);
    const activityTotal=incidentRows.length+cvrRows.length+discRows.length+nteRows.length+memoRows.length+nodRows.length+leaveRows.length+transferRows.length+atdRows.length;

    const monthKeys=analyticsMonthRange(end,6);
    const monthly=monthKeys.map(k=>{
      const monthRows=(module,rows)=>rows.filter(r=>analyticsMonthKey(reportDateFor(module,r))===k).length;
      const hiresMonth=employees.filter(e=>analyticsMonthKey(e.dateHired)===k).length;
      const sepMonth=employees.filter(e=>['Resigned','AWOL','Separated'].includes(e.status)&&analyticsMonthKey(e.statusDate)===k).length;
      const casesMonth=periodCases.filter(c=>analyticsMonthKey(String(c.opened_at||c.updated_at||'').slice(0,10))===k).length;
      const activityMonth=monthRows('incidents',incidentRows)+monthRows('cvr',cvrRows)+monthRows('disciplinary',discRows)+monthRows('nte',nteRows)+monthRows('memos',memoRows)+monthRows('nod',nodRows)+monthRows('leaves',leaveRows)+monthRows('transfers',transferRows)+monthRows('atd',atdRows);
      return {k,hires:hiresMonth,separations:sepMonth,cases:casesMonth,activity:activityMonth};
    });
    const maxTrend=Math.max(1,...monthly.flatMap(m=>[m.hires,m.separations,m.cases]));
    const statusCounts=analyticsStatusMap(employees,'status');
    const classCounts={}; employees.forEach(e=>{const c=classify(e);classCounts[c]=(classCounts[c]||0)+1;});
    const deptCounts={}; employees.forEach(e=>{const d=e.department||'Unassigned';deptCounts[d]=(deptCounts[d]||0)+1;});
    const topDepts=Object.entries(deptCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const maxDept=Math.max(1,...topDepts.map(x=>x[1]));
    const caseStatus=analyticsStatusMap(periodCases,'status');
    const casePriority=analyticsStatusMap(openCases,'priority');
    const maxCaseStatus=Math.max(1,...Object.values(caseStatus));
    const openNTE=nteRows.filter(n=>n.status!=='Resolved').length;
    const atdOutstanding=atdRows.reduce((sum,r)=>sum+Math.max(0,atdRemaining(r)),0);
    const activityModules=[['Incidents',incidentRows.length],['CVR',cvrRows.length],['Disciplinary',discRows.length],['NTE',nteRows.length],['Memoranda',memoRows.length],['NOD',nodRows.length],['Leaves',leaveRows.length],['Transfers',transferRows.length],['ATD',atdRows.length]];
    const maxActivity=Math.max(1,...activityModules.map(x=>x[1]));
    const latestCases=periodCases.slice(0,8);
    const attention=[];
    overdueCases.slice(0,5).forEach(c=>attention.push({danger:true,title:`${c.case_number} — ${c.employee_name}`,meta:`${c.status} · due ${fmtDate(c.due_date)}`,action:`openCaseDetails('${c.id}')`}));
    if(evalOverdue) attention.push({title:`${evalOverdue} probationary evaluation checkpoint(s) overdue`,meta:'Review the Probationary Evaluations workspace.',action:"go('evaluations')"});
    if(openNTE) attention.push({title:`${openNTE} NTE record(s) still open`,meta:'Review outstanding Notice to Explain records.',action:"go('nte')"});
    if(atdOutstanding>0) attention.push({title:`${peso(atdOutstanding)} ATD balance remaining`,meta:'Review current ATD collection records.',action:"go('atd')"});

    const rangeButtons=[['30d','30D'],['90d','90D'],['180d','180D'],['365d','1Y']];
    const html=`
      <div class="sectionhead">
        <div><h2>Management Analytics</h2><p>${fmtDate(start)} – ${fmtDate(end)}${dept?' · '+esc(dept):' · All Departments'}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportAnalyticsSnapshot()">${iDownload(14)} Export Snapshot</button>`:''}<button class="btn btn-brass btn-sm" onclick="go('reports')">Reports</button></div>
      </div>
      <div class="analytics-toolbar">
        <div><div class="small" style="font-weight:800;color:var(--ink);margin-bottom:7px;">Reporting range</div><div class="range-buttons">${rangeButtons.map(([v,l])=>`<button class="range-btn ${STATE.analyticsRange===v?'active':''}" onclick="analyticsSetPreset('${v}')">${l}</button>`).join('')}<button class="range-btn ${STATE.analyticsRange==='custom'?'active':''}" onclick="STATE.analyticsRange='custom';document.getElementById('analytics-start')?.focus()">Custom</button></div></div>
        <div class="range-fields">
          <div class="field"><label>From</label><input id="analytics-start" type="date" value="${esc(start)}"></div>
          <div class="field"><label>To</label><input id="analytics-end" type="date" value="${esc(end)}"></div>
          <div class="field"><label>Department</label><select id="analytics-dept"><option value="">All Departments</option>${reportDepartments().map(d=>`<option value="${esc(d)}" ${dept===d?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
          <button class="btn btn-primary" onclick="analyticsApplyFilters()">Apply</button>
        </div>
      </div>

      <div class="analytics-kpis">
        <div class="metric-card"><div class="k">Current Headcount</div><div class="v">${employees.length}</div><div class="s">${activeEmployees.length} active / newly hired</div></div>
        <div class="metric-card"><div class="k">New Hires</div><div class="v">${hired.length}</div><div class="s">Within selected period</div></div>
        <div class="metric-card"><div class="k">Separations</div><div class="v">${separated.length}</div><div class="s">Resigned / AWOL / separated</div></div>
        <div class="metric-card"><div class="k">Open Cases</div><div class="v">${openCases.length}</div><div class="s">${overdueCases.length} currently overdue</div></div>
        <div class="metric-card"><div class="k">HR Activity</div><div class="v">${activityTotal}</div><div class="s">Selected period across modules</div></div>
      </div>

      <div class="analytics-grid equal">
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Six-Month Workforce & Case Trend</h3><div class="desc">Monthly new hires, separations, and cases based on available record dates.</div></div></div>
          <div class="analytics-trend">${monthly.map(m=>`<div class="month"><div class="month-total">${m.hires+m.separations+m.cases}</div><div class="bars"><div class="bar" title="${m.hires} hires" style="height:${Math.max(2,Math.round(m.hires/maxTrend*125))}px"></div><div class="bar secondary" title="${m.separations} separations" style="height:${Math.max(2,Math.round(m.separations/maxTrend*125))}px"></div><div class="bar tertiary" title="${m.cases} cases" style="height:${Math.max(2,Math.round(m.cases/maxTrend*125))}px"></div></div><div class="month-label">${esc(analyticsMonthLabelFromKey(m.k))}</div></div>`).join('')}</div>
          <div class="analytics-legend"><span><i></i>New hires</span><span><i class="secondary"></i>Separations</span><span><i class="tertiary"></i>Cases</span></div>
        </div>
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Current Case Aging</h3><div class="desc">Age distribution of currently open cases.</div></div><button class="btn btn-ghost btn-sm" onclick="go('cases')">Open Cases</button></div>
          <div class="analytics-aging">${agingBuckets.map((x,i)=>`<div class="bucket"><div class="v">${x[1]}</div><div class="k">${esc(x[0])}</div></div>`).join('')}</div>
          <div class="chart-list" style="margin-top:14px;">${agingBuckets.map((x,i)=>`<div class="chart-row"><div class="label">${esc(x[0])}</div><div class="chart-track"><div class="chart-fill ${i===3?'danger':i===2?'warn':''}" style="width:${Math.round(x[1]/Math.max(openCases.length,1)*100)}%"></div></div><div class="chart-count">${x[1]}</div></div>`).join('')}</div>
        </div>
      </div>

      <div class="analytics-grid equal">
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Workforce by Department</h3><div class="desc">Current employee distribution within the selected scope.</div></div></div>
          <div class="chart-list">${topDepts.length?topDepts.map(([d,c],i)=>`<div class="chart-row"><div class="label" title="${esc(d)}">${esc(d)}</div><div class="chart-track"><div class="chart-fill ${i===0?'alt':''}" style="width:${Math.round(c/maxDept*100)}%"></div></div><div class="chart-count">${c}</div></div>`).join(''):'<div class="analytics-empty">No employee records match the selected scope.</div>'}</div>
        </div>
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Employment Classification</h3><div class="desc">Current classification mix using the platform's lifecycle rules.</div></div></div>
          <div class="chart-list">${Object.entries(classCounts).sort((a,b)=>b[1]-a[1]).map(([k,c],i)=>`<div class="chart-row"><div class="label">${esc(k)}</div><div class="chart-track"><div class="chart-fill ${i===0?'alt':i===1?'warn':''}" style="width:${Math.round(c/Math.max(employees.length,1)*100)}%"></div></div><div class="chart-count">${c}</div></div>`).join('')||'<div class="analytics-empty">No employee records in scope.</div>'}</div>
          <div class="analytics-note" style="margin-top:10px;">${probationary.length} probationary employee(s); ${evalOverdue} evaluation checkpoint(s) currently overdue.</div>
        </div>
      </div>

      <div class="analytics-grid equal">
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Case Status in Period</h3><div class="desc">Cases opened or updated during the selected period.</div></div></div>
          <div class="chart-list">${Object.keys(CASE_STATUS_MAP).map((status,i)=>{const c=caseStatus[status]||0;return `<div class="chart-row"><div class="label">${esc(status)}</div><div class="chart-track"><div class="chart-fill ${status==='Cancelled'?'danger':status==='Resolved'||status==='Closed'?'alt':'warn'}" style="width:${Math.round(c/maxCaseStatus*100)}%"></div></div><div class="chart-count">${c}</div></div>`;}).join('')}</div>
        </div>
        <div class="panel"><div class="dashboard-panel-head"><div><h3>HR Activity by Module</h3><div class="desc">Operational volume within the selected period.</div></div></div>
          <div class="chart-list">${activityModules.map((x,i)=>`<div class="chart-row"><div class="label">${esc(x[0])}</div><div class="chart-track"><div class="chart-fill ${i%3===1?'alt':i%3===2?'warn':''}" style="width:${Math.round(x[1]/maxActivity*100)}%"></div></div><div class="chart-count">${x[1]}</div></div>`).join('')}</div>
        </div>
      </div>

      <div class="analytics-grid equal">
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Priority & Follow-Up Signals</h3><div class="desc">Current work requiring operational review.</div></div></div>
          <div class="analytics-rank-list">
            <div class="analytics-rank"><div class="num">01</div><div><div class="name">Overdue cases</div><div class="meta">Open cases past their recorded due date</div></div><div class="count">${overdueCases.length}</div></div>
            <div class="analytics-rank"><div class="num">02</div><div><div class="name">30+ day cases</div><div class="meta">Open cases with longer-running age</div></div><div class="count">${openCases.filter(c=>analyticsDaysOpen(c.opened_at)>=30).length}</div></div>
            <div class="analytics-rank"><div class="num">03</div><div><div class="name">Open NTEs</div><div class="meta">Notice to Explain records not resolved</div></div><div class="count">${openNTE}</div></div>
            <div class="analytics-rank"><div class="num">04</div><div><div class="name">ATD remaining</div><div class="meta">Current outstanding recorded balance</div></div><div class="count">${peso(atdOutstanding)}</div></div>
          </div>
        </div>
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Latest Cases</h3><div class="desc">Most recently updated cases within the selected scope.</div></div><button class="btn btn-ghost btn-sm" onclick="go('cases')">View All</button></div>
          <div class="tablewrap"><table class="analytics-table"><thead><tr><th>Case</th><th>Employee</th><th>Status</th><th>Priority</th></tr></thead><tbody>${latestCases.length?latestCases.map(c=>`<tr><td><button class="linkbtn" onclick="openCaseDetails('${c.id}')">${esc(c.case_number)}</button></td><td>${esc(c.employee_name)}</td><td>${statusBadge(c.status,CASE_STATUS_MAP)}</td><td>${casePriorityBadge(c.priority||'Normal')}</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">No cases in the selected period.</div></td></tr>'}</tbody></table></div>
        </div>
      </div>

      <div class="panel"><div class="dashboard-panel-head"><div><h3>Operational Attention</h3><div class="desc">Signals generated from current HR records for follow-up.</div></div><button class="btn btn-ghost btn-sm" onclick="go('actionCenter')">Open Action Center</button></div>
        <div class="attention-list">${attention.length?attention.slice(0,10).map(a=>`<div class="attention-item ${a.danger?'danger':''}" ${a.action?`onclick="${a.action}" style="cursor:pointer;"`:''}><span class="mark"></span><div class="body"><div class="title">${analyticsEsc(a.title)}</div><div class="meta">${analyticsEsc(a.meta)}</div></div></div>`).join(''):'<div class="analytics-empty">No attention items detected for the current scope.</div>'}</div>
        <div class="analytics-note">Analytics are descriptive summaries of records currently stored in the system. Metrics such as case age and overdue status are operational indicators and do not independently determine legal, disciplinary, or compliance outcomes.</div>
      </div>
    `;
    document.getElementById('content').innerHTML=html;
  }catch(e){
    document.getElementById('content').innerHTML=`<div class="panel"><h3>Management Analytics</h3><div class="notice"><b>Could not load analytics.</b> ${analyticsEsc(e.message||e)}</div></div>`;
  }
}


/* ================================================================
   DATA QUALITY & GOVERNANCE
   Derived checks across current HR records. No record is changed automatically.
   ================================================================ */
function qualitySeverityRank(level){ return level==='error'?0:level==='warning'?1:2; }
function qualityIssue(id,severity,module,title,detail,action,meta=[]){ return {id,severity,module,title,detail,action,meta}; }
function qualityEmployeeMatches(ref){
  const raw=String(ref?.employeeId||'').trim();
  const name=normalizeEmployeeName(ref?.employeeName||ref?.name||'');
  return DB.employees.find(e=>raw && String(e.id)===raw) || DB.employees.find(e=>name && [e.name,employeeDisplayName(e)].some(value=>normalizeEmployeeName(value)===name)) || null;
}
function qualityDateInvalid(value){ return !!value && /^\d{4}-\d{2}-\d{2}$/.test(String(value).slice(0,10))===false; }
function qualityIssues(caseRows=[]){
  const issues=[];
  const add=(...args)=>issues.push(qualityIssue(...args));
  const employees=DB.employees||[];
  const today=todayISO();

  if(!employees.length){
    add('employees-empty','warning','employees','No employee master records found','The HR platform cannot validate cross-module employee relationships until employee master data exists.',"go('employees')",['Employees','Master data']);
  }

  employees.forEach((e,idx)=>{
    const base=`employee:${e.id||idx}`;
    const required=[['employeeNo','Employee No.'],['name','Employee Name'],['position','Position'],['department','Department'],['branchReporting','Branch Reporting'],['dateHired','Date Hired'],['gender','Gender'],['status','Employment Status']];
    required.forEach(([k,label])=>{ if(!String(e[k]??'').trim()) add(`${base}:missing:${k}`,'error','employees',`${label} is missing`,`${e.name||'Employee record'} has incomplete required master data.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','Required field']); });
    if(e.dateHired && e.dateHired>today) add(`${base}:future-hire`,'error','employees','Date Hired is in the future',`${e.name||'Employee'} is recorded as hired on ${fmtDate(e.dateHired)}.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','Date']);
    if(e.birthDate && e.birthDate>today) add(`${base}:future-birth`,'error','employees','Birth Date is in the future',`${e.name||'Employee'} has a Birth Date later than today.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','Date']);
    if(e.statusDate && e.dateHired && e.statusDate<e.dateHired) add(`${base}:status-date`,'error','employees','Status date precedes Date Hired',`${e.name||'Employee'} has ${fmtDate(e.statusDate)} as a status date but was hired on ${fmtDate(e.dateHired)}.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','Timeline']);
    if(['Resigned','Separated','AWOL'].includes(e.status) && !e.statusDate) add(`${base}:status-date-missing`,'warning','employees','Status effective date is missing',`${e.name||'Employee'} is marked ${e.status} without a status effective date.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','Status']);
    if(!Array.isArray(e.employmentHistory)) add(`${base}:history-shape`,'warning','employees','Employment history is missing or invalid',`${e.name||'Employee'} does not have a valid employment-history array.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','History']);
    if(!['Auto','Probationary','Regular'].includes(e.classOverride)) add(`${base}:class-override`,'error','employees','Invalid employee classification override',`${e.name||'Employee'} has an unsupported classification value: ${e.classOverride||'blank'}.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','Classification']);
    if(e.dateHired && qualityDateInvalid(e.dateHired)) add(`${base}:hire-format`,'error','employees','Invalid Date Hired format',`${e.name||'Employee'} does not use the expected YYYY-MM-DD date format.`,e.id?`openEmployeeForm('${e.id}')`:"go('employees')",['Employee Master','Date']);
  });

  const duplicateGroups=new Map();
  employees.forEach(e=>{
    const key=[normalizeEmployeeName(e.name),String(e.dateHired||''),String(e.department||'')].join('|');
    if(key!=='||') duplicateGroups.set(key,[...(duplicateGroups.get(key)||[]),e]);
  });
  duplicateGroups.forEach(group=>{
    if(group.length>1){
      const names=group.map(e=>e.name).join(', ');
      group.forEach(e=>add(`duplicate:${e.id}`,'error','employees','Possible duplicate employee record',`${names} share the same normalized name, Date Hired, and department. Review before keeping both records.`,`openEmployeeForm('${e.id}')`,['Employee Master','Duplicate']));
    }
  });

  const referenceModules=['leaves','disciplinary','nte','memos','nod','oncall','transfers','cvr','incidents','prf','evaluations','atd'];
  referenceModules.forEach(module=>{
    (DB[module]||[]).forEach((r,i)=>{
      const hasRef=String(r.employeeId||r.employeeName||'').trim();
      if(hasRef && !qualityEmployeeMatches(r)){
        const who=r.employeeName||r.employee||r.name||'Unknown employee';
        add(`${module}:orphan:${r.id||i}`,'warning',module,'Record references an unknown employee',`${who} could not be matched to the Employee Master by employee ID or name.`,`go('${module}')`,[caseModuleLabel(module),'Reference']);
      }
    });
  });

  (DB.leaves||[]).forEach((r,i)=>{
    if(r.startDate && r.endDate && r.startDate>r.endDate) add(`leaves:range:${r.id||i}`,'error','leaves','Leave date range is invalid',`${r.employeeName||'Employee'} has a leave start date after the end date.`,"go('leaves')",['Leave','Date range']);
  });
  ['incidents','disciplinary','cvr','memos','nod'].forEach(module=>{
    const candidates={incidents:['dateOfIncident'],disciplinary:['dateOfIncident'],cvr:['dateOfCVR'],memos:['dateOfMemo','dateIssued'],nod:['dateOfNod','dateIssued']}[module]||[];
    (DB[module]||[]).forEach((r,i)=>candidates.forEach(k=>{ if(r[k] && r[k]>today) add(`${module}:future:${r.id||i}:${k}`,'warning',module,'Record date is in the future',`${caseModuleLabel(module)} for ${r.employeeName||'an employee'} uses ${fmtDate(r[k])}.`,"go('"+module+"')",[caseModuleLabel(module),'Date']); }));
  });
  (DB.transfers||[]).forEach((r,i)=>{
    const from=r.fromDate||r.requestDate, to=r.toDate||r.effectiveDate;
    if(from && to && from>to) add(`transfers:range:${r.id||i}`,'error','transfers','Transfer dates are inconsistent',`${r.employeeName||'Employee'} has a transfer/request date after the effective/to date.`,"go('transfers')",['Transfers','Timeline']);
  });
  (DB.atd||[]).forEach((r,i)=>{
    const total=Number(r.totalAmount)||0, paid=atdTotalPaid(r), remaining=atdRemaining(r);
    if(total<0 || paid<0) add(`atd:negative:${r.id||i}`,'error','atd','ATD amount is negative',`${r.employeeName||'Employee'} has an ATD amount/payment below zero.`,"go('atd')",['ATD','Amount']);
    if(paid>total && total>0) add(`atd:paid-over:${r.id||i}`,'error','atd','ATD payments exceed total amount',`${r.employeeName||'Employee'} has ${peso(paid)} paid against ${peso(total)} total.`,`go('atd')`,['ATD','Amount']);
    if(remaining<0) add(`atd:remaining:${r.id||i}`,'error','atd','ATD remaining balance is negative',`${r.employeeName||'Employee'} has a calculated remaining balance below zero.`,`go('atd')`,['ATD','Balance']);
  });

  (DB.documents||[]).forEach((d,i)=>{
    if(String(d.storage||'').toLowerCase()==='google drive' && d.driveUrl && !isGoogleDriveUrl(d.driveUrl)) add(`documents:url:${d.id||i}`,'error','documents','Invalid Google Drive URL',`${d.name||'Document'} is marked as a Google Drive document but the saved URL is not recognized as a Google Drive/Docs URL.`,`openDriveDocumentForm('${d.id||''}')`,['Documents','Google Drive']);
    if(String(d.storage||'').toLowerCase()==='google drive' && !d.driveUrl) add(`documents:missing-url:${d.id||i}`,'error','documents','Google Drive reference is missing',`${d.name||'Document'} is stored as a Google Drive record without a Drive URL.`,`openDriveDocumentForm('${d.id||''}')`,['Documents','Google Drive']);
  });

  (caseRows||[]).forEach((c,i)=>{
    if(!c.case_number) add(`case:number:${c.id||i}`,'error','cases','HR case number is missing',`${c.employee_name||'Case'} does not have a case number.`,"go('cases')",['HR Cases','Required field']);
    if(!c.employee_name) add(`case:employee:${c.id||i}`,'error','cases','HR case employee is missing',`${c.case_number||'Case'} does not identify an employee.`,"go('cases')",['HR Cases','Employee']);
    if(c.employee_name && !qualityEmployeeMatches({employeeName:c.employee_name})) add(`case:orphan:${c.id||i}`,'warning','cases','HR case references an unknown employee',`${c.case_number||'Case'} is linked to ${c.employee_name}, which is not present in Employee Master.`,`openCaseDetails('${c.id}')`,['HR Cases','Reference']);
    if(c.opened_at && c.closed_at && String(c.opened_at)>String(c.closed_at)) add(`case:dates:${c.id||i}`,'error','cases','HR case dates are inconsistent',`${c.case_number||'Case'} has a closed date before its opened date.`,`openCaseDetails('${c.id}')`,['HR Cases','Timeline']);
  });

  return issues.sort((a,b)=>qualitySeverityRank(a.severity)-qualitySeverityRank(b.severity) || a.title.localeCompare(b.title));
}
function dataQualityIssueCount(){
  return qualityIssues([]).length;
}
function qualityFilteredIssues(issues){
  const filter=STATE.qualityFilter||'all', search=String(STATE.qualitySearch||'').toLowerCase().trim();
  return issues.filter(x=>(filter==='all'||x.severity===filter) && (!search || [x.title,x.detail,x.module,...(x.meta||[])].join(' ').toLowerCase().includes(search)));
}
function qualityScore(issues){
  const e=issues.filter(x=>x.severity==='error').length, w=issues.filter(x=>x.severity==='warning').length, i=issues.filter(x=>x.severity==='info').length;
  return Math.max(0,Math.min(100,Math.round(100-(e*5)-(w*2)-(i))));
}
function exportDataQuality(){
  if(!requireExportAccess())return;
  const rows=qualityFilteredIssues(QUALITY_CACHE.issues).map(x=>({severity:x.severity,module:x.module,title:x.title,detail:x.detail,metadata:(x.meta||[]).join(' | ')}));
  downloadCSV('hr_data_quality_report.csv',toCSV(rows,[{label:'Severity',get:r=>r.severity},{label:'Module',get:r=>r.module},{label:'Issue',get:r=>r.title},{label:'Detail',get:r=>r.detail},{label:'Metadata',get:r=>r.metadata}]));
  toast('Data quality report exported.');
}
let QUALITY_CACHE={issues:[]};
async function renderDataQuality(){
  setTitle('Data Quality & Governance','Identify incomplete, inconsistent, duplicated, or disconnected HR records before they become workflow problems.');
  document.getElementById('content').innerHTML='<div class="panel"><div class="desc">Running data quality scan…</div></div>';
  try{
    const {data:caseRows,error}=await supabase.from('hr_cases').select('id,case_number,employee_name,department,status,opened_at,closed_at,updated_at').order('updated_at',{ascending:false}).limit(1000);
    if(error) throw error;
    const issues=qualityIssues(caseRows||[]); QUALITY_CACHE.issues=issues;
    const visible=qualityFilteredIssues(issues).slice(0,120);
    const errors=issues.filter(x=>x.severity==='error').length;
    const warnings=issues.filter(x=>x.severity==='warning').length;
    const infos=issues.filter(x=>x.severity==='info').length;
    const score=qualityScore(issues);
    const moduleMap={}; issues.forEach(x=>moduleMap[x.module]=(moduleMap[x.module]||0)+1);
    const topModules=Object.entries(moduleMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const html=`
      <div class="quality-hero">
        <div><h1>Data Quality &amp; Governance</h1><p>Review the integrity of HR master data and cross-module references before relying on automation or reporting.</p></div>
        <div class="quality-actions"><button class="btn btn-ghost btn-sm" onclick="go('employees')">Employee Master</button>${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportDataQuality()">Export Findings</button>`:''}<button class="btn btn-primary btn-sm" onclick="renderDataQuality()">Run Scan</button></div>
      </div>
      <div class="quality-score-grid">
        <div class="quality-score main" style="--accent:${score>=90?'var(--forest)':score>=70?'var(--amber)':'var(--rust)'}">
          <div class="ring" style="--score:${score}"><b>${score}</b></div>
          <div><div class="k">Data Quality Score</div><div class="v">${issues.length?score+' / 100':'100 / 100'}</div><div class="s">Derived from current validation findings. The scan never changes records automatically.</div></div>
        </div>
        <div class="quality-score"><div class="k">Errors</div><div class="v">${errors}</div><div class="s">Requires correction or review</div></div>
        <div class="quality-score"><div class="k">Warnings</div><div class="v">${warnings}</div><div class="s">Potential integrity issue</div></div>
        <div class="quality-score"><div class="k">Info</div><div class="v">${infos}</div><div class="s">Non-blocking finding</div></div>
      </div>
      <div class="quality-toolbar">
        <input class="search" data-search-key="qualitySearch" type="search" autocomplete="off" placeholder="Search data quality findings…" value="${esc(STATE.qualitySearch||'')}" oninput="queueSearchRender(this,'qualitySearch',renderDataQuality)">
        <select onchange="STATE.qualityFilter=this.value; renderDataQuality()"><option value="all" ${STATE.qualityFilter==='all'?'selected':''}>All findings (${issues.length})</option><option value="error" ${STATE.qualityFilter==='error'?'selected':''}>Errors (${errors})</option><option value="warning" ${STATE.qualityFilter==='warning'?'selected':''}>Warnings (${warnings})</option><option value="info" ${STATE.qualityFilter==='info'?'selected':''}>Info (${infos})</option></select>
      </div>
      <div class="quality-section">
        <div class="panel"><div class="panel-head"><div><h3>Findings</h3><div class="desc">${visible.length} shown${qualityFilteredIssues(issues).length>120?' · first 120 displayed':''}</div></div></div>
          <div class="quality-list">${visible.length?visible.map(x=>`<div class="quality-item ${x.severity}"><span class="dot"></span><div><div class="title">${esc(x.title)}</div><div class="detail">${esc(x.detail)}</div><div class="meta"><span>${esc(x.severity.toUpperCase())}</span><span>${esc(caseModuleLabel(x.module))}</span>${(x.meta||[]).map(m=>`<span>${esc(m)}</span>`).join('')}</div></div><div class="actions">${x.action?`<button class="btn btn-ghost btn-sm" onclick="${x.action};event.stopPropagation();">Review</button>`:''}</div></div>`).join(''):'<div class="quality-empty"><b>Data quality looks clean</b>No findings match the current filter. Keep monitoring as new HR records are added.</div>'}</div>
        </div>
        <div class="quality-side">
          <div class="panel"><h3>Findings by Module</h3><div class="desc">Where the current scan is detecting the most issues.</div><div class="quality-summary-list">${topModules.length?topModules.map(([m,n])=>`<div class="quality-summary-row"><span>${esc(caseModuleLabel(m))}</span><b>${n}</b></div>`).join(''):'<div class="small">No findings.</div>'}</div></div>
          <div class="panel"><h3>Governance Checks</h3><div class="desc">The current scan looks for concrete record-integrity problems.</div><div class="quality-summary-list"><div class="quality-summary-row"><span>Required employee fields</span><b>✓</b></div><div class="quality-summary-row"><span>Duplicate employee candidates</span><b>✓</b></div><div class="quality-summary-row"><span>Cross-module employee references</span><b>✓</b></div><div class="quality-summary-row"><span>Date consistency</span><b>✓</b></div><div class="quality-summary-row"><span>ATD balance consistency</span><b>✓</b></div><div class="quality-summary-row"><span>Google Drive references</span><b>✓</b></div><div class="quality-summary-row"><span>HR case integrity</span><b>✓</b></div></div></div>
          <div class="quality-tip"><b>Why this matters:</b> Workflow automation, approvals, reminders, and management reporting become more reliable when the underlying employee and HR records are complete and correctly connected. Findings are descriptive checks for HR review, not automatic decisions about employees.</div>
        </div>
      </div>`;
    document.getElementById('content').innerHTML=html;
  }catch(e){ document.getElementById('content').innerHTML=`<div class="panel"><h3>Data Quality &amp; Governance</h3><div class="notice"><b>Could not run the data quality scan.</b> ${esc(e.message||e)}</div></div>`; }
}

/* ================================================================
   REPORTS
   ================================================================ */
function reportDateFor(module, rec){
  if(!rec) return '';
  const candidates={
    employees:['dateHired','statusDate'], leaves:['dateReceived','dateApplied','startDate'],
    disciplinary:['dateOfIncident'], nte:['dateIssued','dateReceived'], memos:['dateOfMemo','dateReceived'],
    nod:['dateOfNod','dateReceived'], oncall:['startDate'], transfers:['toDate','fromDate'],
    cvr:['dateOfCVR'], incidents:['dateOfIncident'], prf:['dateOfRequest','dateOfPRF'],
    evaluations:['completedDate'], atd:['atdDate','dateRecorded']
  };
  for(const key of (candidates[module]||[])) if(rec[key]) return String(rec[key]).slice(0,10);
  return '';
}
function reportInRange(date,start,end){ return !!date && date>=start && date<=end; }
function reportDeptMatch(rec,dept){ return !dept || (rec?.department||'Unassigned')===dept; }
function reportFilterRows(module,start,end,dept){
  return (DB[module]||[]).filter(r=>reportInRange(reportDateFor(module,r),start,end) && reportDeptMatch(r,dept));
}
function reportCaseRows(cases,start,end,dept){
  return (cases||[]).filter(c=>reportInRange(String(c.opened_at||c.updated_at||'').slice(0,10),start,end) && (!dept || (c.department||'Unassigned')===dept));
}
function reportDepartments(){
  const set=new Set();
  DB.employees.forEach(e=>e.department&&set.add(e.department));
  ['leaves','disciplinary','nte','memos','nod','oncall','transfers','cvr','incidents','atd'].forEach(m=>(DB[m]||[]).forEach(r=>r.department&&set.add(r.department)));
  return [...set].sort((a,b)=>a.localeCompare(b));
}
function exportReportRows(filename,rows,cols){
  if(!requireExportAccess())return;
  downloadCSV(filename,toCSV(rows,cols));
  toast('Report exported.');
}
function exportReportEmployees(){
  const rows=reportFilterRows('employees',STATE.reportStart,STATE.reportEnd,STATE.reportDept);
  exportReportRows('employees_report.csv',rows,[
    {label:'Employee',get:r=>r.name},{label:'Position',get:r=>r.position},{label:'Department',get:r=>r.department},
    {label:'Date Hired',get:r=>r.dateHired},{label:'Gender',get:r=>r.gender},{label:'Status',get:r=>r.status},{label:'Classification',get:r=>classify(r)}
  ]);
}
function exportReportCases(){
  const rows=reportCaseRows(REPORT_CACHE.cases,STATE.reportStart,STATE.reportEnd,STATE.reportDept);
  exportReportRows('hr_cases_report.csv',rows,[
    {label:'Case',get:r=>r.case_number},{label:'Employee',get:r=>r.employee_name},{label:'Department',get:r=>r.department},
    {label:'Status',get:r=>r.status},{label:'Opened',get:r=>r.opened_at},{label:'Closed',get:r=>r.closed_at},{label:'Updated',get:r=>r.updated_at}
  ]);
}
function exportReportActivity(){
  const mods=[['incidents','Incident Report'],['cvr','CVR'],['disciplinary','Disciplinary'],['nte','NTE'],['memos','Memorandum'],['nod','NOD'],['leaves','Leave'],['oncall','On-Call'],['transfers','Transfer'],['atd','ATD']];
  const rows=[];
  mods.forEach(([m,label])=>reportFilterRows(m,STATE.reportStart,STATE.reportEnd,STATE.reportDept).forEach(r=>rows.push({type:label,employee:r.employeeName||r.name||'',department:r.department||'',date:reportDateFor(m,r),status:r.status||'',detail:r.violation||r.deductionType||r.reason||r.finalAction||''})));
  rows.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  exportReportRows('hr_activity_report.csv',rows,[{label:'Type',get:r=>r.type},{label:'Employee',get:r=>r.employee},{label:'Department',get:r=>r.department},{label:'Date',get:r=>r.date},{label:'Status',get:r=>r.status},{label:'Detail',get:r=>r.detail}]);
}
function exportReportATD(){
  exportReportRows('atd_collection_report.csv',REPORT_CACHE.atdRows,[
    {label:'Employee',get:r=>r.employeeName},{label:'Department',get:r=>r.department},{label:'Category',get:r=>r.category},
    {label:'Deduction Type',get:r=>r.deductionType},{label:'Total Amount',get:r=>r.totalAmount},{label:'Paid',get:r=>atdTotalPaid(r)},{label:'Remaining',get:r=>atdRemaining(r)},{label:'Status',get:r=>r.status}
  ]);
}
async function renderReports(){
  setTitle('Reports','Flexible management reports with date and department filters.');
  const start=STATE.reportStart||addDaysISO(todayISO(),-29), end=STATE.reportEnd||todayISO(), dept=STATE.reportDept||'';
  STATE.reportStart=start; STATE.reportEnd=end;
  if(end<start){
    document.getElementById('content').innerHTML='<div class="panel"><div class="notice"><b>Invalid report period.</b> The end date must be on or after the start date.</div></div>';
    return;
  }
  const departments=reportDepartments();
  document.getElementById('content').innerHTML='<div class="panel"><div class="desc">Loading report data…</div></div>';
  try{
    const {data:cases,error}=await supabase.from('hr_cases').select('id,case_number,employee_name,department,status,opened_at,closed_at,updated_at').order('updated_at',{ascending:false}).limit(1000);
    if(error) throw error;
    if(STATE.view!=='reports') return;
    REPORT_CACHE.cases=cases||[];
    REPORT_CACHE.atdRows=[];
    const caseRows=reportCaseRows(REPORT_CACHE.cases,start,end,dept);
    const employees=reportFilterRows('employees',start,end,dept);
    const leaves=reportFilterRows('leaves',start,end,dept);
    const incidents=reportFilterRows('incidents',start,end,dept);
    const cvr=reportFilterRows('cvr',start,end,dept);
    const disc=reportFilterRows('disciplinary',start,end,dept);
    const nte=reportFilterRows('nte',start,end,dept);
    const memos=reportFilterRows('memos',start,end,dept);
    const nod=reportFilterRows('nod',start,end,dept);
    const transfers=reportFilterRows('transfers',start,end,dept);
    const atdRows=reportFilterRows('atd',start,end,dept);
    REPORT_CACHE.atdRows=atdRows;
    const oncall=reportFilterRows('oncall',start,end,dept);
    const hired=employees.filter(e=>e.dateHired>=start&&e.dateHired<=end).length;
    const transferred=transfers.length;
    const atdTotal=atdRows.reduce((s,r)=>s+(Number(r.totalAmount)||0),0);
    const atdPaid=atdRows.reduce((s,r)=>s+atdTotalPaid(r),0);
    const atdRemainingTotal=atdRows.reduce((s,r)=>s+atdRemaining(r),0);
    const movement=employees.filter(e=>['Resigned','AWOL','Separated'].includes(e.status)&&e.statusDate>=start&&e.statusDate<=end);
    const activityTotal=incidents.length+cvr.length+disc.length+nte.length+memos.length+nod.length+leaves.length+oncall.length+transfers.length+atdRows.length;
    const caseStatus={}; caseRows.forEach(c=>caseStatus[c.status]=(caseStatus[c.status]||0)+1);
    const deptCases={}; caseRows.filter(c=>!['Closed','Cancelled','Resolved'].includes(c.status)).forEach(c=>{const d=c.department||'Unassigned';deptCases[d]=(deptCases[d]||0)+1;});
    const topCaseDepts=Object.entries(deptCases).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const maxDept=Math.max(...topCaseDepts.map(x=>x[1]),1);
    const reportKpis=[
      ['Employees in Period',employees.length,'Records dated in selected period','var(--brass)'],
      ['HR Cases',caseRows.length,'Cases opened/updated in period','var(--forest)'],
      ['HR Activity',activityTotal,'Cross-module activity items','var(--amber)'],
      ['Open NTEs',nte.filter(r=>r.status!=='Resolved').length,'Selected period','var(--rust)'],
      ['ATD Remaining',peso(atdRemainingTotal),'Selected period','var(--brass)']
    ];
    const html=`
      <div class="sectionhead">
        <div><h2>Management Reports</h2><p>${fmtDate(start)} – ${fmtDate(end)}${dept?' · '+esc(dept):' · All Departments'}</p></div>
        ${canExport()?`<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-ghost btn-sm" onclick="exportReportActivity()">${iDownload(14)} Export Activity</button><button class="btn btn-brass btn-sm" onclick="exportReportCases()">${iDownload(14)} Export Cases</button></div>`:''}
      </div>
      <div class="panel" style="margin-bottom:16px;">
        <div class="report-filter-grid" style="display:grid;grid-template-columns:1fr 1fr 1.2fr auto;gap:10px;align-items:end;">
          <div class="field" style="margin-bottom:0;"><label>From</label><input id="report-start" type="date" value="${esc(start)}"></div>
          <div class="field" style="margin-bottom:0;"><label>To</label><input id="report-end" type="date" value="${esc(end)}"></div>
          <div class="field" style="margin-bottom:0;"><label>Department</label><select id="report-dept"><option value="">All Departments</option>${departments.map(d=>`<option value="${esc(d)}" ${dept===d?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
          <button class="btn btn-primary" onclick="applyReportFilters()">Apply Filters</button>
        </div>
      </div>
      <div class="report-kpi-grid" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;">
        ${reportKpis.map(k=>`<div class="metric-card" style="--accent:${k[3]};"><div class="k">${k[0]}</div><div class="v">${k[1]}</div><div class="s">${k[2]}</div></div>`).join('')}
      </div>
      <div class="report-grid" style="display:grid;grid-template-columns:1.05fr .95fr;gap:16px;margin-bottom:16px;">
        <div class="panel"><div class="dashboard-panel-head"><div><h3>HR Case Status</h3><div class="desc">Cases opened or updated within the selected period.</div></div><button class="btn btn-ghost btn-sm" onclick="go('cases')">Open Cases</button></div>
          <div class="chart-list">${Object.keys(CASE_STATUS_MAP).map(st=>{const n=caseStatus[st]||0;return `<div class="chart-row"><div class="label">${esc(st)}</div><div class="chart-track"><div class="chart-fill" style="width:${Math.round(n/Math.max(caseRows.length,1)*100)}%"></div></div><div class="chart-count">${n}</div></div>`;}).join('')||'<div class="empty">No cases in this period.</div>'}</div>
        </div>
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Open Case Load by Department</h3><div class="desc">Current open case distribution from the selected case set.</div></div></div>
          <div class="chart-list">${topCaseDepts.length?topCaseDepts.map(([d,n])=>`<div class="chart-row"><div class="label">${esc(d)}</div><div class="chart-track"><div class="chart-fill alt" style="width:${Math.round(n/maxDept*100)}%"></div></div><div class="chart-count">${n}</div></div>`).join(''):'<div class="empty">No open cases in this period.</div>'}</div>
        </div>
      </div>
      <div class="report-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div class="panel"><div class="dashboard-panel-head"><div><h3>Workforce Movement</h3><div class="desc">Hires and recorded movement in the selected period.</div></div>${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportReportEmployees()">${iDownload(14)} Employees</button>`:''}</div>
          <div class="grid cols-2" style="gap:10px;margin-bottom:12px;"><div class="metric-card"><div class="k">Newly Hired</div><div class="v">${hired}</div></div><div class="metric-card"><div class="k">Transfers</div><div class="v">${transferred}</div></div></div>
          <div class="small">Resigned / AWOL / Separated records require a populated <b>statusDate</b> to appear in the movement count.</div>
          ${movement.length?`<div class="dashboard-list" style="margin-top:10px;">${movement.slice(0,6).map(e=>`<div class="dashboard-list-row"><div><div class="primary">${esc(employeeDisplayName(e))}</div><div class="secondary">${esc(e.department||'Unassigned')} · ${esc(e.status)}</div></div><div class="right">${fmtDate(e.statusDate)}</div></div>`).join('')}</div>`:''}
        </div>
        <div class="panel"><div class="dashboard-panel-head"><div><h3>ATD Collection</h3><div class="desc">Selected-period ATD records and payment progress.</div></div>${canExport()?`<button class="btn btn-ghost btn-sm" onclick="exportReportATD()">${iDownload(14)} Export ATD</button>`:''}</div>
          <div class="grid cols-3" style="gap:10px;"><div class="metric-card"><div class="k">ATD Records</div><div class="v">${atdRows.length}</div></div><div class="metric-card"><div class="k">Total Amount</div><div class="v" style="font-size:20px;">${peso(atdTotal)}</div></div><div class="metric-card"><div class="k">Paid</div><div class="v" style="font-size:20px;">${peso(atdPaid)}</div></div></div>
          <div style="margin-top:12px;"><div class="small" style="display:flex;justify-content:space-between;gap:8px;"><span>Collection progress</span><b>${atdTotal?Math.round(atdPaid/atdTotal*100):0}%</b></div><div class="chart-track" style="height:10px;margin-top:6px;"><div class="chart-fill alt" style="width:${atdTotal?Math.min(100,Math.round(atdPaid/atdTotal*100)):0}%"></div></div></div>
        </div>
      </div>
      <div class="panel">
        <div class="dashboard-panel-head"><div><h3>Activity Breakdown</h3><div class="desc">Operational volume by module for the selected period.</div></div></div>
        <div class="report-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="chart-list">${[['Incidents',incidents.length],['CVR',cvr.length],['Disciplinary',disc.length],['NTE',nte.length],['Memoranda',memos.length]].map(([l,n])=>`<div class="chart-row"><div class="label">${l}</div><div class="chart-track"><div class="chart-fill warn" style="width:${Math.round(n/Math.max(Math.max(incidents.length,cvr.length,disc.length,nte.length,memos.length),1)*100)}%"></div></div><div class="chart-count">${n}</div></div>`).join('')}</div>
          <div class="chart-list">${[['NOD',nod.length],['Leaves',leaves.length],['On-Call',oncall.length],['Transfers',transfers.length],['ATD',atdRows.length]].map(([l,n])=>`<div class="chart-row"><div class="label">${l}</div><div class="chart-track"><div class="chart-fill alt" style="width:${Math.round(n/Math.max(Math.max(nod.length,leaves.length,oncall.length,transfers.length,atdRows.length),1)*100)}%"></div></div><div class="chart-count">${n}</div></div>`).join('')}</div>
        </div>
        <div class="analytics-note">Report values are descriptive summaries of the records stored in the application. They do not independently determine legal, disciplinary, or compliance outcomes.</div>
      </div>`;
    document.getElementById('content').innerHTML=html;
  }catch(e){
    document.getElementById('content').innerHTML=`<div class="panel"><h3>Management Reports</h3><div class="notice"><b>Could not load report data.</b> ${esc(e.message||e)}</div></div>`;
  }
}
function applyReportFilters(){
  const start=document.getElementById('report-start')?.value||todayISO();
  const end=document.getElementById('report-end')?.value||todayISO();
  const dept=document.getElementById('report-dept')?.value||'';
  if(end<start){toast('Report end date cannot be before the start date.',true);return;}
  STATE.reportStart=start; STATE.reportEnd=end; STATE.reportDept=dept; renderReports();
}

/* ================================================================
   USER MANAGEMENT
   ================================================================ */
function renderUsers(){
  setTitle('User Management', 'Manage dashboard profiles and access roles.');
  const rows = DB.users;
  document.getElementById('content').innerHTML = `
    <div class="sectionhead">
      <div><h2>User Management</h2><p>${rows.length} registered profile${rows.length===1?'':'s'}.</p></div>
      ${SESSION.role!=='Administrator'?`<div class="page-header-actions">${informationNoteButton('userAdministration')}</div>`:''}
    </div>
    <div class="tablewrap"><table class="data-table">
      <thead><tr><th>Full Name</th><th>Username</th><th>Email</th><th>Role</th><th>Export Access</th><th>Employee Link</th><th>Manager</th><th>Created</th><th style="text-align:right;">Actions</th></tr></thead>
      <tbody>
      ${rows.map(u=>{const linked=DB.employees.find(employee=>String(employee.id)===String(u.employeeRecordId||''));const manager=DB.users.find(user=>user.id===u.managerProfileId);return `<tr>
        <td><b>${esc(u.fullName)}</b>${u.id===SESSION.id?' <span class="pill">You</span>':''}</td>
        <td class="mono">${esc(u.username||'—')}</td>
        <td>${esc(u.email||'—')}</td>
        <td>${statusBadge(u.role, {'Administrator':'b-blue','HR Staff':'b-green','Manager':'b-amber','Employee':'b-blue','Viewer':'b-grey'})}</td>
        <td>${statusBadge(isHRRole(u.role)?'Included':u.canExport?'Enabled':'Disabled',{'Included':'b-green','Enabled':'b-blue','Disabled':'b-grey'})}</td>
        <td>${linked?`<b>${esc(linked.name)}</b><div class="small">${esc(linked.employeeNo||'—')}</div>`:'<span class="small">Not linked</span>'}</td>
        <td>${esc(manager?.fullName||'—')}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td><div class="rowactions">
          ${SESSION.role==='Administrator'? `<button class="iconbtn" onclick="openUserForm('${u.id}')" title="Edit profile">${iEdit(14)}</button>`:'<span class="small">—</span>'}
        </div></td>
      </tr>`;}).join('')}
      </tbody></table></div>`;
}
function openUserForm(id){
  if(SESSION.role!=='Administrator') return;
  const existing = id? DB.users.find(u=>u.id===id): null;
  if(!existing) return;
  const managers=DB.users.filter(user=>['Administrator','HR Staff','Manager'].includes(user.role)&&user.id!==id);
  openModal(`
    <div class="modal-head"><h3>Edit User Profile</h3><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="formgrid">
        <div class="field"><label>Full Name *</label><input id="u_fullName" value="${esc(existing.fullName||'')}"></div>
        <div class="field"><label>Username *</label><input id="u_username" value="${esc(existing.username||'')}"></div>
        <div class="field full"><label>Email</label><input value="${esc(existing.email||'')}" disabled style="background:var(--paper);"></div>
        <div class="field"><label>Role</label><select id="u_role" onchange="syncUserExportControl()">
          <option ${existing.role==='Administrator'?'selected':''}>Administrator</option>
          <option ${existing.role==='HR Staff'?'selected':''}>HR Staff</option>
          <option ${existing.role==='Manager'?'selected':''}>Manager</option>
          <option ${existing.role==='Employee'?'selected':''}>Employee</option>
          <option ${existing.role==='Viewer'?'selected':''}>Viewer</option>
        </select></div>
        ${employeePickerHTML({id:'u_employee',label:'Linked Employee Record',selectedId:existing.employeeRecordId||'',full:true,placeholder:'Type to link an employee record',autofill:false})}
        <div class="field full"><label>Direct Manager</label><select id="u_manager"><option value="">No manager assigned</option>${managers.map(manager=>`<option value="${manager.id}" ${existing.managerProfileId===manager.id?'selected':''}>${esc(manager.fullName)}</option>`).join('')}</select></div>
        <label class="checklist-complete-toggle full"><input id="u_canExport" type="checkbox" ${existing.canExport?'checked':''} ${isHRRole(existing.role)?'disabled':''}><span><b>Allow data export</b><small id="u_exportHelp">${isHRRole(existing.role)?'Export access is included with Administrator and HR Staff roles.':'This user can download employee, report, analytics, and operational exports.'}</small></span></label>
      </div>
      <div class="computed-note">Link Employee and Manager accounts to employee master records before enabling self-service. Passwords remain managed by Supabase Auth.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveUser('${id}')">Save User</button></div>
  `);
}
function syncUserExportControl(){
  const input=document.getElementById('u_canExport');const help=document.getElementById('u_exportHelp');const builtIn=isHRRole(document.getElementById('u_role')?.value);
  if(input)input.disabled=builtIn;
  if(help)help.textContent=builtIn?'Export access is included with Administrator and HR Staff roles.':'This user can download employee, report, analytics, and operational exports.';
}
async function saveUser(id){
  if(SESSION.role!=='Administrator') return;
  const fullName=document.getElementById('u_fullName').value.trim();
  const username=document.getElementById('u_username').value.trim().toLowerCase();
  const role=document.getElementById('u_role').value;
  const canExportValue=!isHRRole(role)&&document.getElementById('u_canExport')?.checked===true;
  const employeeRecordId=document.getElementById('u_employee').value||null;
  const managerProfileId=document.getElementById('u_manager').value||null;
  if(!fullName||!username){ toast('Please complete all required fields.'); return; }
  const {error}=await supabase.from('profiles').update({full_name:fullName,username,role,can_export:canExportValue,employee_record_id:employeeRecordId,manager_profile_id:managerProfileId}).eq('id',id);
  if(error){ toast('Could not update user: '+(/can_export/i.test(error.message||'')?'Run the Phase 17 export-permissions migration first.':error.message),true); return; }
  await loadProfiles();
  const updated=DB.users.find(u=>u.id===SESSION.id); if(updated) SESSION=updated;
  logAudit(`Updated user profile: ${fullName} · export ${roleCanExport(role,canExportValue)?'enabled':'disabled'}`); await saveDB();
  closeModal(); renderUsers(); toast('User profile saved.');
}

/* ================================================================
   SETTINGS
   ================================================================ */
function settingsCatalogStatus(active){return statusBadge(active?'Active':'Inactive',active?{'Active':'b-green'}:{'Inactive':'b-grey'});}
function settingsOrganizationHTML(canManage){
  const departments=departmentCatalog();
  const positions=positionCatalog();
  return `<div class="settings-section-head"><div><h3>Organization Structure</h3><p>Departments and their approved positions drive employee, applicant, transfer, import, and HR transaction forms.</p></div>${canManage?`<div class="page-header-actions"><button class="btn btn-ghost btn-sm" onclick="openDepartmentSetting()">${iPlus(13)} Department</button><button class="btn btn-primary btn-sm" onclick="openPositionSetting()">${iPlus(13)} Position</button></div>`:''}</div>
    <div class="settings-master-grid">
      <section class="settings-master-block"><div class="settings-master-title"><div><b>Departments</b><span>${departments.filter(item=>item.active).length} active of ${departments.length}</span></div></div><div class="tablewrap"><table class="data-table settings-table"><thead><tr><th>Department</th><th>Employees</th><th>Status</th>${canManage?'<th class="actions-head">Action</th>':''}</tr></thead><tbody>${departments.map((item,index)=>`<tr><td><b>${esc(item.name)}</b></td><td>${DB.employees.filter(employee=>String(employee.department).toLowerCase()===item.name.toLowerCase()).length}</td><td>${settingsCatalogStatus(item.active)}</td>${canManage?`<td class="actions-head"><button class="iconbtn" title="Edit department" onclick="openDepartmentSetting(${index})">${iEdit(14)}</button></td>`:''}</tr>`).join('')}</tbody></table></div></section>
      <section class="settings-master-block"><div class="settings-master-title"><div><b>Positions</b><span>${positions.filter(item=>item.active).length} active of ${positions.length}</span></div></div><div class="tablewrap"><table class="data-table settings-table"><thead><tr><th>Position</th><th>Department</th><th>Employees</th><th>Status</th>${canManage?'<th class="actions-head">Action</th>':''}</tr></thead><tbody>${positions.length?positions.map((item,index)=>`<tr><td><b>${esc(item.name)}</b></td><td>${esc(item.department||'Unassigned')}</td><td>${DB.employees.filter(employee=>String(employee.department).toLowerCase()===item.department.toLowerCase()&&String(employee.position).toLowerCase()===item.name.toLowerCase()).length}</td><td>${settingsCatalogStatus(item.active)}</td>${canManage?`<td class="actions-head"><button class="iconbtn" title="Edit position" onclick="openPositionSetting(${index})">${iEdit(14)}</button></td>`:''}</tr>`).join(''):`<tr><td colspan="${canManage?5:4}"><div class="empty"><b>No positions configured</b><span>Add approved positions before creating or importing employees.</span></div></td></tr>`}</tbody></table></div></section>
    </div>`;
}
function switchSettingsTab(tab){
  STATE.settingsTab=tab;
  document.querySelectorAll('[data-settings-tab]').forEach(button=>{const active=button.dataset.settingsTab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  document.querySelectorAll('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==tab);
}
function openDepartmentSetting(index=-1){
  if(!isHRRole())return;
  const item=index>=0?departmentCatalog()[index]:null;
  openModal(`<div class="modal-head"><div><h3>${item?'Edit Department':'Add Department'}</h3><div class="small">Organization Structure</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="formgrid"><div class="field full"><label>Department Name *</label><input id="os_department_name" value="${esc(item?.name||'')}" maxlength="60" placeholder="e.g. HUMAN RESOURCES"></div>${item?`<div class="field full"><label class="settings-check"><input id="os_department_active" type="checkbox" ${item.active?'checked':''}><span><b>Active department</b><small>Inactive departments remain on historical records but cannot be selected for new transactions.</small></span></label></div>`:''}</div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-confirm-label="Save department and update linked records" onclick="saveDepartmentSetting(${index})">Save Department</button></div>`);
}
async function saveDepartmentSetting(index=-1){
  if(!isHRRole())return;
  const name=document.getElementById('os_department_name')?.value.trim().toUpperCase()||'';
  const active=index<0||document.getElementById('os_department_active')?.checked;
  const catalog=departmentCatalog();const original=index>=0?catalog[index]:null;
  if(!name){toast('Enter a department name.',true);return;}
  if(catalog.some((item,itemIndex)=>itemIndex!==index&&item.name.toLowerCase()===name.toLowerCase())){toast('That department already exists.',true);return;}
  if(!active&&catalog.filter(item=>item.active).length===1&&original?.active){toast('At least one department must remain active.',true);return;}
  const before=JSON.parse(JSON.stringify(DB));
  if(original){
    catalog[index]={name,active};
    if(original.name!==name){
      RECORD_MODULES.forEach(module=>(DB[module]||[]).forEach(record=>['department','fromDepartment','toDepartment'].forEach(key=>{if(String(record[key]||'').toLowerCase()===original.name.toLowerCase())record[key]=name;})));
      DB.settings.positions=positionCatalog().map(position=>position.department.toLowerCase()===original.name.toLowerCase()?{...position,department:name}:position);
    }
  }else catalog.push({name,active:true});
  DB.settings.departments=catalog;
  if(!(await persistOrganizationStructure())){DB=before;return;}
  if(original&&original.name!==name&&!(await saveDB())){DB=before;return;}
  let relatedCaseWarning='';
  if(original&&original.name!==name){
    const {error:caseDepartmentError}=await supabase.from('hr_cases').update({department:name,updated_by:SESSION?.id||null}).ilike('department',original.name);
    if(caseDepartmentError)relatedCaseWarning='Department saved, but linked HR case departments could not be updated: '+caseDepartmentError.message;
  }
  logAudit(`${original?'Updated':'Added'} department: ${name}`);await closeModal();renderSettings();toast(relatedCaseWarning||'Department saved.',!!relatedCaseWarning);
}
function openPositionSetting(index=-1){
  if(!isHRRole())return;
  const item=index>=0?positionCatalog()[index]:null;
  const departments=employeeDepartmentNames(item?.department||'');
  openModal(`<div class="modal-head"><div><h3>${item?'Edit Position':'Add Position'}</h3><div class="small">Organization Structure</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="formgrid"><div class="field"><label>Position Title *</label><input id="os_position_name" value="${esc(item?.name||'')}" maxlength="80" placeholder="e.g. HR Officer"></div><div class="field"><label>Department *</label><select id="os_position_department"><option value="">Select department</option>${departments.map(name=>`<option value="${esc(name)}" ${name===item?.department?'selected':''}>${esc(name)}</option>`).join('')}</select></div>${item?`<div class="field full"><label class="settings-check"><input id="os_position_active" type="checkbox" ${item.active?'checked':''}><span><b>Active position</b><small>Inactive positions stay on existing employee records but are hidden from new employee and applicant forms.</small></span></label></div>`:''}</div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-confirm-label="Save position and update linked records" onclick="savePositionSetting(${index})">Save Position</button></div>`);
}
async function savePositionSetting(index=-1){
  if(!isHRRole())return;
  const name=document.getElementById('os_position_name')?.value.trim()||'';
  const department=document.getElementById('os_position_department')?.value||'';
  const active=index<0||document.getElementById('os_position_active')?.checked;
  const catalog=positionCatalog();const original=index>=0?catalog[index]:null;
  if(!name||!department){toast('Enter a position title and select its department.',true);return;}
  if(catalog.some((item,itemIndex)=>itemIndex!==index&&item.name.toLowerCase()===name.toLowerCase()&&item.department.toLowerCase()===department.toLowerCase())){toast('That position already exists in this department.',true);return;}
  const before=JSON.parse(JSON.stringify(DB));
  if(original){
    catalog[index]={name,department,active};
    if(original.name!==name||original.department!==department){
      RECORD_MODULES.forEach(module=>(DB[module]||[]).forEach(record=>{
        if(String(record.department||'').toLowerCase()!==original.department.toLowerCase())return;
        if(String(record.position||'').toLowerCase()===original.name.toLowerCase()){record.position=name;record.department=department;}
        if(String(record.positionApplied||'').toLowerCase()===original.name.toLowerCase()){record.positionApplied=name;record.department=department;}
      }));
    }
  }else catalog.push({name,department,active:true});
  DB.settings.positions=catalog;
  if(!(await persistOrganizationStructure())){DB=before;return;}
  if(original&&(original.name!==name||original.department!==department)&&!(await saveDB())){DB=before;return;}
  logAudit(`${original?'Updated':'Added'} position: ${name} · ${department}`);await closeModal();renderSettings();toast('Position saved.');
}
function renderSettings(){
  if(!isHRRole()){go('dashboard',{skipUnsaved:true});return;}
  const admin=SESSION?.role==='Administrator';
  setTitle(admin?'Settings':'Organization Structure',admin?'Organization preferences and audit log.':'Manage approved departments and positions.');
  const provider=attachmentStorageProvider();
  const activeTab=admin?(STATE.settingsTab||'general'):'organization';
  STATE.settingsTab=activeTab;
  document.getElementById('content').innerHTML = `
    <div class="settings-shell">
      <div class="settings-tabs" role="tablist" aria-label="Settings sections">
        ${(admin?[['general','General'],['organization','Organization Structure'],['workforce','Branches & Compensation'],['storage','File Storage'],['audit','Audit Trail']]:[['organization','Organization Structure']]).map(([key,label])=>`<button type="button" role="tab" data-settings-tab="${key}" class="${activeTab===key?'active':''}" aria-selected="${activeTab===key}" onclick="switchSettingsTab('${key}')">${label}</button>`).join('')}
      </div>
      ${admin?`<section class="settings-panel" data-settings-panel="general" ${activeTab==='general'?'':'hidden'}>
        <div class="settings-section-head"><div><h3>General</h3><p>Core organization identity and employment defaults.</p></div>${admin?'<button class="btn btn-primary btn-sm" onclick="saveSettings()">Save Changes</button>':''}</div>
        <div class="field"><label>Organization Name</label><input id="s_org" value="${esc(DB.settings.orgName)}" ${admin?'':'disabled'}></div>
        <div class="field"><label>Probation → Regularization Threshold (days)</label><input id="s_prob" type="number" value="${DB.settings.probationDays}" ${admin?'':'disabled'}><div class="computed-note">Employee classification recalculates automatically wherever it is displayed.</div></div>
      </section>`:''}
      <section class="settings-panel" data-settings-panel="organization" ${activeTab==='organization'?'':'hidden'}>${settingsOrganizationHTML(true)}</section>
      ${admin?`
      <section class="settings-panel" data-settings-panel="workforce" ${activeTab==='workforce'?'':'hidden'}>
        <div class="settings-section-head"><div><h3>Branches &amp; Compensation</h3><p>Reporting locations and configurable employee allowance fields.</p></div>${admin?'<button class="btn btn-primary btn-sm" onclick="saveSettings()">Save Changes</button>':''}</div>
        <div class="settings-form-grid"><div class="field"><label>Branch Locations (one per line)</label><textarea id="s_branches" rows="10" ${admin?'':'disabled'}>${esc(employeeBranchLocations().join('\n'))}</textarea><div class="computed-note">Every employee must be assigned to one configured reporting branch.</div></div><div class="field"><label>Allowance Types (one per line)</label><textarea id="s_allowances" rows="10" ${admin?'':'disabled'} placeholder="Meal Allowance&#10;Transportation Allowance">${esc(employeeAllowanceTypes().join('\n'))}</textarea><div class="computed-note">Each type becomes an employee amount field and an import-template column.</div></div></div>
      </section>
      <section class="settings-panel" data-settings-panel="storage" ${activeTab==='storage'?'':'hidden'}>
        <div class="settings-section-head"><div><h3>File Storage</h3><p>One administrator-controlled destination for all new HR uploads.</p></div>${admin?'<button class="btn btn-primary btn-sm" onclick="saveSettings()">Save Changes</button>':''}</div>
        <div class="field"><label>Default File Storage</label><select id="s_file_storage" onchange="storageSettingsChanged()" ${admin?'':'disabled'}><option value="supabase" ${provider==='supabase'?'selected':''}>Supabase Storage</option><option value="google-drive" ${provider==='google-drive'?'selected':''}>Google Drive</option></select><div class="computed-note">Existing attachments remain in their original storage.</div></div>
        <div id="s_drive_settings" class="storage-settings-group" style="display:${provider==='google-drive'?'grid':'none'}">
          <div class="field"><label>Google Drive Root Folder URL</label><input id="s_drive_root" type="url" value="${esc(DB.settings.googleDriveRootUrl||'')}" placeholder="https://drive.google.com/drive/folders/..." ${admin?'':'disabled'}><div class="computed-note">Module folders such as leave, atd, cvr, and onboarding are created inside this root.</div></div>
          <div class="field"><label>Google OAuth Web Client ID</label><input id="s_drive_client" value="${esc(DB.settings.googleDriveClientId||'')}" placeholder="000000000000-….apps.googleusercontent.com" autocomplete="off" ${admin?'':'disabled'}><div class="computed-note">OAuth client IDs are identifiers, not secrets. Tokens stay in browser memory and are never saved.</div></div>
          ${admin?`<button type="button" class="btn btn-ghost btn-sm storage-test-button" onclick="testGoogleDriveConnection()">${iCheck(14)} Test Drive Connection</button>`:''}
        </div>
        <div class="notice notice-soft"><b>Current upload destination:</b> ${provider==='google-drive'?`Google Drive · module folders are created below the configured root.`:'Private Supabase Storage · files are organized by user and HR module.'}</div>
      </section>
      <section class="settings-panel" data-settings-panel="audit" ${activeTab==='audit'?'':'hidden'}>
        <div class="settings-section-head"><div><h3>Audit Trail</h3><p>Most recent system configuration and record activity.</p></div></div>
        <div class="settings-audit-list">
        ${DB.audit.length? DB.audit.map(a=>`<div class="cal-list-item"><span>${esc(a.action)}</span><span class="small">${esc(a.user)} · ${new Date(a.ts).toLocaleString()}</span></div>`).join('') : '<div class="small">No activity yet.</div>'}
        </div>
      </section>`:''}
    </div>
  `;
}
function storageSettingsChanged(){
  const group=document.getElementById('s_drive_settings');
  if(group) group.style.display=document.getElementById('s_file_storage')?.value==='google-drive'?'grid':'none';
}
async function testGoogleDriveConnection(){
  if(SESSION?.role!=='Administrator') return;
  const rootUrl=document.getElementById('s_drive_root')?.value.trim()||'';
  const clientId=document.getElementById('s_drive_client')?.value.trim()||'';
  const rootId=documentDriveFileId(rootUrl);
  if(!rootId||!clientId){toast('Enter a valid Drive root folder URL and OAuth Web Client ID first.',true);return;}
  const previous={root:DB.settings.googleDriveRootUrl||'',client:DB.settings.googleDriveClientId||''};
  DB.settings.googleDriveRootUrl=rootUrl;DB.settings.googleDriveClientId=clientId;
  GOOGLE_DRIVE_TOKEN={accessToken:'',expiresAt:0};
  try{
    await requestGoogleDriveAccessToken(true);
    const folder=await googleDriveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootId)}?fields=id,name,mimeType&supportsAllDrives=true`);
    if(folder?.mimeType!=='application/vnd.google-apps.folder') throw new Error('The configured URL does not point to a Drive folder.');
    toast(`Connected to Google Drive folder: ${folder.name}`);
  }catch(error){toast('Google Drive connection failed: '+error.message,true);}
  finally{DB.settings.googleDriveRootUrl=previous.root;DB.settings.googleDriveClientId=previous.client;}
}
async function saveSettings(){
  if(SESSION?.role!=='Administrator'){toast('Only the System Administrator can change settings.',true);return;}
  const provider=document.getElementById('s_file_storage')?.value||'supabase';
  const driveRoot=document.getElementById('s_drive_root')?.value.trim()||'';
  const driveClient=document.getElementById('s_drive_client')?.value.trim()||'';
  if(provider==='google-drive'&&(!documentDriveFileId(driveRoot)||!driveClient.endsWith('.apps.googleusercontent.com'))){toast('Google Drive storage requires a valid root folder URL and OAuth Web Client ID.',true);return;}
  const branchLocations=uniqueSettingNames((document.getElementById('s_branches')?.value||'').split(/\r?\n/));
  const allowanceTypes=uniqueSettingNames((document.getElementById('s_allowances')?.value||'').split(/\r?\n/));
  if(!branchLocations.length){toast('Add at least one Branch Location.',true);return;}
  if(branchLocations.length>50||allowanceTypes.length>50){toast('Branch and allowance lists can contain up to 50 entries each.',true);return;}
  if([...branchLocations,...allowanceTypes].some(name=>name.length>60)){toast('Branch and allowance names cannot exceed 60 characters.',true);return;}
  const unavailableBranches=uniqueSettingNames(DB.employees.map(employee=>employee.branchReporting).filter(Boolean)).filter(branch=>!branchLocations.some(value=>value.toLowerCase()===branch.toLowerCase()));
  if(unavailableBranches.length){toast(`Cannot remove assigned branch locations: ${unavailableBranches.join(', ')}. Reassign those employees first.`,true);return;}
  const previousClient=DB.settings.googleDriveClientId||'';
  DB.settings.orgName = document.getElementById('s_org').value.trim()||'SCPA';
  DB.settings.probationDays = parseInt(document.getElementById('s_prob').value,10)||180;
  DB.settings.fileStorageProvider=provider;
  DB.settings.googleDriveRootUrl=driveRoot;
  DB.settings.googleDriveClientId=driveClient;
  DB.settings.branchLocations=branchLocations;
  DB.settings.allowanceTypes=allowanceTypes;
  if(previousClient!==driveClient) GOOGLE_DRIVE_TOKEN={accessToken:'',expiresAt:0};
  logAudit(`Updated system settings · ${branchLocations.length} branches · ${allowanceTypes.length} allowance types · file storage: ${provider==='google-drive'?'Google Drive':'Supabase Storage'}`);
  if(!(await saveDB())){PENDING_PAGE_NAVIGATION=null;return;}
  const destination=PENDING_PAGE_NAVIGATION||'settings';
  PENDING_PAGE_NAVIGATION=null;
  PAGE_EDIT_STATE=null;
  toast('Settings saved.');
  enterApp(destination);
}

/* ================================================================
   DOCUMENT CENTER / GOOGLE DRIVE READY ARCHITECTURE
   Supabase continues to hold application metadata. Actual files can live
   outside the database (Google Drive). Existing Supabase Storage files remain
   visible for backward compatibility while Drive-linked documents use the
   documents record set below.
   ================================================================ */
const DOCUMENT_MODULES = ['employees','leaves','disciplinary','nte','memos','nod','oncall','transfers','cvr','incidents','prf','evaluations','atd'];
const DOCUMENT_CATEGORIES = ['Employment','Identity','Leave','Attendance','Incident','Disciplinary','Case','Evaluation','Transfer','Payroll / ATD','Other'];
const DOCUMENT_STATUS = ['Active','Pending','Expired','Archived'];

function documentDriveFileId(url){
  const value=String(url||'').trim();
  if(!value) return '';
  const patterns=[/\/file\/d\/([a-zA-Z0-9_-]+)/i,/id=([a-zA-Z0-9_-]+)/i,/\/folders\/([a-zA-Z0-9_-]+)/i];
  for(const re of patterns){ const m=value.match(re); if(m) return m[1]; }
  return '';
}
function isGoogleDriveUrl(url){
  try{
    const host=new URL(String(url||'')).hostname.toLowerCase();
    return host==='drive.google.com' || host==='docs.google.com' || host.endsWith('.googleusercontent.com');
  }catch(e){ return false; }
}
function documentExpiryInfo(doc){
  if(!doc?.expirationDate) return {label:'No expiry',cls:'b-grey'};
  const t=todayISO(), d=String(doc.expirationDate).slice(0,10), n=addDaysISO(t,30);
  if(d<t) return {label:`Expired ${fmtDate(d)}`,cls:'b-red'};
  if(d<=n) return {label:`Expires ${fmtDate(d)}`,cls:'b-amber'};
  return {label:`Expires ${fmtDate(d)}`,cls:'b-green'};
}
function documentOwner(doc){
  const emp=DB.employees.find(e=>String(e.id)===String(doc?.employeeId));
  return emp?.name || doc?.employeeName || '—';
}
function documentSourceLabel(doc){
  if(!doc?.sourceModule) return 'Employee file';
  const source=caseModuleLabel(doc.sourceModule);
  return doc.sourceRecordId ? `${source} · ${doc.sourceRecordId}` : source;
}
function documentRecordById(id){ return (DB.documents||[]).find(d=>String(d.id)===String(id)); }
function countDriveDocuments(){ return (DB.documents||[]).length; }
function collectStoredDocuments(){
  const docs=[];
  DOCUMENT_MODULES.forEach(module=>{
    (DB[module]||[]).forEach(rec=>{
      Object.keys(rec||{}).forEach(key=>{
        if(!key.endsWith('Data') || (key==='attachmentData' && !rec[key])) return;
        const path=rec[key];
        if(typeof path!=='string' || !path) return;
        const name=rec[key.slice(0,-4)];
        if(typeof name!=='string' || !name) return;
        const provider=storageRefProvider(path);
        docs.push({
          id:`${module}:${rec.id}:${key}`, storage:provider==='google-drive'?'Google Drive':'Supabase', managedAttachment:true, module, moduleLabel:caseModuleLabel(module),
          recordId:String(rec.id), name, path, employee:rec.employeeName||rec.name||'—',
          employeeId:rec.employeeId||'', department:rec.department||'—', date:caseRecordDate(module,rec)||rec.updated_at||'',
          label:caseRecordLabel(module,rec), category:'HR Attachment', expirationDate:'',
          driveUrl:provider==='google-drive'?googleDriveFileUrl(path):'', driveFileId:provider==='google-drive'?googleDriveFileIdFromRef(path):''
        });
      });
      if(module==='atd'){
        (rec.payments||[]).forEach(payment=>{
          if(payment.payslipData && payment.payslip){
            const provider=storageRefProvider(payment.payslipData);
            docs.push({id:`atd:${rec.id}:payment:${payment.id}:payslip`,storage:provider==='google-drive'?'Google Drive':'Supabase',managedAttachment:true,module:'atd',moduleLabel:'ATD Monitoring',recordId:String(rec.id),name:payment.payslip,path:payment.payslipData,employee:rec.employeeName||'—',employeeId:rec.employeeId||'',department:rec.department||'—',date:payment.dateRecorded||rec.atdDate||'',label:`ATD payment — ${payment.month||''} ${payment.cutoff||''}`.trim(),category:'Payroll / ATD',expirationDate:'',driveUrl:provider==='google-drive'?googleDriveFileUrl(payment.payslipData):'',driveFileId:provider==='google-drive'?googleDriveFileIdFromRef(payment.payslipData):''});
          }
        });
      }
    });
  });
  const seen=new Set();
  return docs.filter(d=>{if(seen.has(d.id)) return false;seen.add(d.id);return true;}).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.name.localeCompare(b.name));
}
function collectDocumentIndex(){
  const legacy=collectStoredDocuments();
  const drive=(DB.documents||[]).map(d=>({
    ...d, storage:'Google Drive', module:d.sourceModule||'employees', moduleLabel:caseModuleLabel(d.sourceModule||'employees'),
    recordId:d.sourceRecordId||'', name:d.name||'Untitled document', employee:documentOwner(d),
    department:(DB.employees.find(e=>String(e.id)===String(d.employeeId))?.department)||d.department||'—',
    label:d.description||'Google Drive document', category:d.category||'Other', date:d.createdAt||d.updatedAt||'',
    driveFileId:d.driveFileId||documentDriveFileId(d.driveUrl||''), path:'', expirationDate:d.expirationDate||'', driveUrl:d.driveUrl||''
  }));
  return [...legacy,...drive].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.name.localeCompare(b.name));
}
function countStoredDocuments(){ return collectDocumentIndex().length; }
function documentFileType(name){
  const ext=(String(name||'').split('.').pop()||'').toLowerCase();
  if(ext==='pdf') return 'PDF';
  if(['jpg','jpeg','png','webp','gif'].includes(ext)) return 'Image';
  if(['doc','docx'].includes(ext)) return 'Word';
  if(['xls','xlsx'].includes(ext)) return 'Excel';
  if(['ppt','pptx'].includes(ext)) return 'PowerPoint';
  return ext ? ext.toUpperCase() : 'File';
}
async function openStoredDocument(path,name){
  if(!path){toast('No stored file is attached to this document.',true);return;}
  await downloadAttachment(path,name);
}
function openDriveDocument(url){
  if(!url){toast('No Google Drive URL is available.',true);return;}
  if(!isGoogleDriveUrl(url)){toast('The saved URL is not recognized as a Google Drive/Docs URL.',true);return;}
  window.open(url,'_blank','noopener,noreferrer');
}
function documentEmployeeOptions(selected=''){
  return DB.employees.slice().sort((a,b)=>employeeDisplayName(a).localeCompare(employeeDisplayName(b))).map(e=>`<option value="${esc(e.id)}" ${String(e.id)===String(selected)?'selected':''}>${esc(e.employeeNo||'—')} · ${esc(employeeDisplayName(e))}</option>`).join('');
}
function documentSourceModuleOptions(selected=''){
  const modules=['employees','cases','leaves','disciplinary','nte','memos','nod','cvr','incidents','prf','evaluations','atd','transfers','oncall'];
  return modules.map(m=>{const label=m==='cases'?'HR Case':caseModuleLabel(m); return `<option value="${esc(m)}" ${String(m)===String(selected)?'selected':''}>${esc(label)}</option>`;}).join('');
}
function openDriveDocumentForm(id=''){
  if(SESSION?.role==='Viewer') return;
  const rec=id?documentRecordById(id):null;
  const title=rec?'Edit Google Drive Document':'Register Google Drive Document';
  const driveFolder=(DB.settings?.googleDriveRootUrl||'');
  openModal(`
    <div class="modal-head"><div><h3>${title}</h3><div class="small">Store document metadata in Supabase and keep the actual file in Google Drive.</div></div><button onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="panel" style="padding:13px;margin-bottom:14px;background:#FBFCFE;"><div class="doc-drive-badge">Google Drive metadata</div><div class="small" style="margin-top:7px;line-height:1.5;">This records the Drive file reference, employee/case relationship, category, and expiration date. The actual file is not stored in the HR database.</div></div>
      <div class="formgrid">
        <div class="field full"><label>Document Name *</label><input id="gd_name" value="${esc(rec?.name||'')}" placeholder="e.g. Signed Employment Contract"></div>
        ${employeePickerHTML({id:'gd_employee',label:'Employee',selectedId:rec?.employeeId||'',required:true,autofill:false})}
        <div class="field"><label>Category</label><select id="gd_category">${DOCUMENT_CATEGORIES.map(x=>`<option value="${esc(x)}" ${x===(rec?.category||'Other')?'selected':''}>${esc(x)}</option>`).join('')}</select></div>
        <div class="field"><label>Related Module</label><select id="gd_module">${documentSourceModuleOptions(rec?.sourceModule||'employees')}</select></div>
        <div class="field"><label>Source Record ID</label><input id="gd_source_record" value="${esc(rec?.sourceRecordId||'')}" placeholder="Optional record ID / case ID"></div>
        <div class="field full"><label>Google Drive URL *</label><input id="gd_url" type="url" value="${esc(rec?.driveUrl||'')}" placeholder="https://drive.google.com/..." autocomplete="off"></div>
        <div class="field"><label>Expiration Date</label><input id="gd_expiry" type="date" value="${esc(rec?.expirationDate||'')}"></div>
        <div class="field"><label>Status</label><select id="gd_status">${DOCUMENT_STATUS.map(x=>`<option value="${esc(x)}" ${x===(rec?.status||'Active')?'selected':''}>${esc(x)}</option>`).join('')}</select></div>
        <div class="field full"><label>Description / Notes</label><textarea id="gd_notes" rows="3" placeholder="Optional document context, retention note, or instructions">${esc(rec?.description||'')}</textarea></div>
      </div>
      ${driveFolder?`<div class="notice" style="margin-top:10px;"><b>Configured Drive workspace:</b> <a href="${esc(driveFolder)}" target="_blank" rel="noopener noreferrer">Open root folder</a></div>`:''}
      <div class="notice" style="margin-top:10px;"><b>Access control:</b> Keep sensitive HR files restricted in Google Drive. This application stores the URL/reference, not the file contents.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveDriveDocument('${esc(id)}')">Save Document</button></div>
  `);
}
async function saveDriveDocument(id=''){
  if(SESSION?.role==='Viewer') return;
  const name=document.getElementById('gd_name')?.value.trim();
  const employeeId=document.getElementById('gd_employee')?.value||'';
  const driveUrl=document.getElementById('gd_url')?.value.trim();
  if(!name||!employeeId||!driveUrl){toast('Document name, employee, and Google Drive URL are required.',true);return;}
  if(!isGoogleDriveUrl(driveUrl)){toast('Enter a valid Google Drive or Google Docs URL.',true);return;}
  const before=documentRecordById(id);
  const now=new Date().toISOString();
  const employee=DB.employees.find(e=>String(e.id)===String(employeeId));
  const payload={
    id:id||uid(), name, employeeId, employeeName:employee?.name||'', department:employee?.department||'',
    category:document.getElementById('gd_category').value, sourceModule:document.getElementById('gd_module').value,
    sourceRecordId:document.getElementById('gd_source_record').value.trim(), driveUrl, driveFileId:documentDriveFileId(driveUrl),
    expirationDate:document.getElementById('gd_expiry').value||'', status:document.getElementById('gd_status').value,
    description:document.getElementById('gd_notes').value.trim(), createdAt:before?.createdAt||now, updatedAt:now, createdBy:before?.createdBy||SESSION?.id||null, updatedBy:SESSION?.id||null
  };
  if(before) Object.assign(before,payload); else (DB.documents||(DB.documents=[])).push(payload);
  logAudit(`${before?'Updated':'Registered'} Google Drive document: ${name}`);
  if(!(await saveDB())) return;
  await closeModal();
  renderDocuments(); renderNav(); refreshNotificationBadge();
  toast(before?'Document updated.':'Google Drive document registered.');
}
async function deleteDriveDocument(id){
  if(SESSION?.role==='Viewer') return;
  const rec=documentRecordById(id); if(!rec) return;
  DB.documents=DB.documents.filter(d=>String(d.id)!==String(id));
  logAudit(`Removed Google Drive document reference: ${rec.name||'Document'}`);
  if(!(await saveDB())) return;
  renderDocuments(); renderNav(); refreshNotificationBadge(); toast('Document reference removed.');
}
function renderDocuments(){
  setTitle('Document Center','Central document index for employee and case files across Google Drive and Supabase Storage.');
  const docs=collectDocumentIndex();
  const q=(STATE.search||'').toLowerCase();
  const storageFilter=STATE.documentStorage||'';
  const categoryFilter=STATE.documentCategory||'';
  const expiryFilter=STATE.documentExpiry||'';
  const statusFilter=STATE.documentStatus||'';
  const filtered=docs.filter(d=>{
    const searchHit=!q || [d.name,d.employee,d.department,d.moduleLabel,d.label,d.category,d.sourceRecordId].some(v=>String(v||'').toLowerCase().includes(q));
    const storageHit=!storageFilter || d.storage===storageFilter;
    const categoryHit=!categoryFilter || d.category===categoryFilter;
    const statusHit=!statusFilter || (d.storage==='Google Drive' ? (d.status||'Active')===statusFilter : statusFilter==='Active');
    let expiryHit=true;
    if(expiryFilter){
      const info=documentExpiryInfo(d);
      expiryHit=expiryFilter==='expired'?info.cls==='b-red':expiryFilter==='soon'?info.cls==='b-amber':expiryFilter==='noexpiry'&&info.cls==='b-grey';
    }
    return searchHit&&storageHit&&categoryHit&&statusHit&&expiryHit;
  });
  const driveDocs=docs.filter(d=>d.storage==='Google Drive');
  const expired=driveDocs.filter(d=>documentExpiryInfo(d).cls==='b-red').length;
  const expiring=driveDocs.filter(d=>documentExpiryInfo(d).cls==='b-amber').length;
  const uniqueEmployees=new Set(docs.filter(d=>d.employee&&d.employee!=='—').map(d=>d.employee)).size;
  const html=`
  <div class="sectionhead"><div><h2>Document Center</h2><p>${docs.length} indexed document${docs.length===1?'':'s'} across employee and HR records.</p></div><div class="doc-toolbar-extra">${canEdit()?`<button class="btn btn-primary btn-sm" onclick="openDriveDocumentForm()">${iDoc(13)} Register Drive Document</button>`:''}${DB.settings?.googleDriveRootUrl?`<button class="btn btn-ghost btn-sm" onclick="openDriveWorkspace()">Open Drive Workspace</button>`:''}</div></div>
  <div class="doc-stats">
    <div class="doc-stat"><div class="k">Indexed Documents</div><div class="v">${docs.length}</div><div class="s">Drive references + existing attachments</div></div>
    <div class="doc-stat"><div class="k">Google Drive</div><div class="v">${driveDocs.length}</div><div class="s">Metadata records using external file storage</div></div>
    <div class="doc-stat"><div class="k">Employees with Files</div><div class="v">${uniqueEmployees}</div><div class="s">Employees represented in the document index</div></div>
  </div>
  <div class="toolbar">
    <div class="search">${iSearch(15)}<input data-search-key="search" type="search" autocomplete="off" placeholder="Search document, employee, case, or category…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderDocuments)"></div>
    <select onchange="STATE.documentStorage=this.value; renderDocuments()"><option value="">All Storage</option><option value="Google Drive" ${storageFilter==='Google Drive'?'selected':''}>Google Drive</option><option value="Supabase" ${storageFilter==='Supabase'?'selected':''}>Supabase Storage</option></select>
    <select onchange="STATE.documentCategory=this.value; renderDocuments()"><option value="">All Categories</option>${[...DOCUMENT_CATEGORIES,'Legacy Attachment'].map(x=>`<option value="${esc(x)}" ${categoryFilter===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
    <select onchange="STATE.documentStatus=this.value; renderDocuments()"><option value="">All Status</option>${DOCUMENT_STATUS.map(x=>`<option value="${esc(x)}" ${statusFilter===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
    <select onchange="STATE.documentExpiry=this.value; renderDocuments()"><option value="">All Expiry</option><option value="expired" ${expiryFilter==='expired'?'selected':''}>Expired</option><option value="soon" ${expiryFilter==='soon'?'selected':''}>Expiring ≤ 30 days</option><option value="noexpiry" ${expiryFilter==='noexpiry'?'selected':''}>No expiry</option></select>
  </div>
  ${driveDocs.length && (expired||expiring)?`<div class="notice" style="margin-top:10px;"><b>Document attention:</b> ${expired?`${expired} expired`:''}${expired&&expiring?' · ':''}${expiring?`${expiring} expiring within 30 days`:''}. Use the filters above to review them.</div>`:''}
  <div class="tablewrap"><table class="data-table"><thead><tr><th>Document</th><th>Employee</th><th>Category</th><th>Storage</th><th>Source</th><th>Status</th><th>Expiry</th><th style="text-align:right;">Actions</th></tr></thead><tbody>
    ${filtered.length?filtered.map(d=>{const expiry=documentExpiryInfo(d);const storedAttachment=d.managedAttachment;return `<tr><td><div class="doc-row"><div class="doc-icon">${iDoc(17)}</div><div class="doc-main"><div class="doc-name" title="${esc(d.name)}">${esc(d.name)}</div><div class="doc-meta">${esc(documentFileType(d.name))}${d.driveFileId?' · Drive ID linked':''}</div></div></div></td><td>${esc(d.employee)}</td><td>${esc(d.category||'Other')}</td><td>${statusBadge(d.storage,{'Google Drive':'b-blue','Supabase':'b-grey'})}</td><td><div class="doc-source">${esc(d.moduleLabel||'—')}${d.recordId?' · '+esc(d.recordId):''}</div></td><td>${statusBadge(d.storage==='Google Drive'?(d.status||'Active'):'Active',{'Active':'b-green','Pending':'b-amber','Expired':'b-red','Archived':'b-grey'})}</td><td><div class="doc-expiry">${statusBadge(expiry.label, {[expiry.label]:expiry.cls})}</div></td><td><div class="doc-actions rowactions">${storedAttachment?`<button class="btn btn-ghost btn-sm" onclick="openStoredDocument('${esc(d.path)}','${esc(d.name).replace(/'/g,"\\'")}')">Open</button>`:d.storage==='Google Drive'?`${canEdit()?`<button class="btn btn-ghost btn-sm" onclick="openDriveDocumentForm('${esc(d.id)}')">Edit</button>`:''}<button class="btn btn-ghost btn-sm" onclick="openDriveDocument('${esc(d.driveUrl).replace(/'/g,"\\'")}')">Open</button>${canEdit()?`<button class="btn btn-danger btn-sm" onclick="deleteDriveDocument('${esc(d.id)}')">Remove</button>`:''}`:`<button class="btn btn-ghost btn-sm" onclick="openStoredDocument('${esc(d.path)}','${esc(d.name).replace(/'/g,"\\'")}')">Open</button>`}</div></td></tr>`;}).join(''):`<tr><td colspan="8"><div class="empty"><b>No documents found</b>${docs.length?'Try another search or filter.':'Register a Google Drive document or attach a file to an existing HR record.'}</div></td></tr>`}
  </tbody></table></div>
  <div class="doc-note">New uploads follow the System Administrator's storage setting. Existing Google Drive and Supabase attachments remain available from this index.</div>`;
  document.getElementById('content').innerHTML=html;
}
function openDriveWorkspace(){
  const url=DB.settings?.googleDriveRootUrl||'';
  if(url && isGoogleDriveUrl(url)) window.open(url,'_blank','noopener,noreferrer');
  else toast('Configure a Google Drive workspace URL in Settings first.',true);
}

/* ================================================================
   HR CASES (central case tracking + linked HR records)
   ================================================================ */
const CASE_STATUS_MAP = {
  'Open':'b-blue','NTE Issued':'b-amber','Memo Issued':'b-amber',
  'For Decision':'b-blue','Resolved':'b-green','Closed':'b-grey','Cancelled':'b-red'
};
const CASE_MODULE_LABELS = {
  employees:'Employee', leaves:'Leave Record', disciplinary:'Disciplinary Action', nte:'Notice to Explain',
  memos:'Memorandum of Offense', nod:'Notice of Decision', oncall:'On-Call / Replacement', transfers:'Department Transfer',
  cvr:'CVR / Violation Report', incidents:'Incident Report', prf:'PRF / Replacement', evaluations:'Probationary Evaluation', atd:'ATD Record'
};
function caseModuleLabel(module){ return CASE_MODULE_LABELS[module] || module; }
function caseRecordLabel(module,r){
  if(!r) return 'Record not found';
  switch(module){
    case 'employees': return `${r.name||'Employee'}${r.position?' — '+r.position:''}`;
    case 'leaves': return `${r.employeeName||'Employee'} — ${r.leaveType||'Leave Record'}`;
    case 'disciplinary': return `${r.employeeName||'Employee'} — ${r.violation||'Disciplinary Action'}`;
    case 'nte': return `${r.employeeName||'Employee'} — ${r.subject||r.title||'Notice to Explain'}`;
    case 'memos': return `${r.employeeName||'Employee'} — ${r.subject||r.title||'Memorandum of Offense'}`;
    case 'nod': return `${r.employeeName||'Employee'} — ${r.subject||r.title||'Notice of Decision'}`;
    case 'oncall': return `${r.employeeName||'Employee'} — ${r.reason||'On-Call / Replacement'}`;
    case 'transfers': return `${r.employeeName||'Employee'} — ${r.fromDepartment||''} → ${r.toDepartment||''}`;
    case 'cvr': return `${r.employeeName||'Employee'} — ${((r.offenses||[])[0]||r.otherOffense||'CVR / Violation Report')}`;
    case 'incidents': return `${r.employeeName||'Employee'} — ${((r.incidentTypes||[])[0]||r.otherType||'Incident Report')}`;
    case 'prf': return `${r.employeeName||'Employee'}${r.prfNumber?' — '+r.prfNumber:''}`;
    case 'evaluations': return `${r.milestone||'Probationary Evaluation'}`;
    case 'atd': return `${r.employeeName||'Employee'} — ${r.deductionType||'ATD Record'}`;
    default: return r.employeeName||r.name||r.title||r.subject||'Linked Record';
  }
}
function caseRecordDate(module,r){
  if(!r) return '';
  return r.dateOfIncident||r.dateOfCVR||r.dateOfApplication||r.atdDate||r.startDate||r.dateRecorded||r.dateHired||r.createdAt||r.completedDate||'';
}

async function openRecordCaseDialog(module,recordId){
  if(SESSION?.role==='Viewer') return;
  const rec=(DB[module]||[]).find(r=>String(r.id)===String(recordId));
  if(!rec){toast('Record could not be found.',true);return;}
  try{
    const [{data:links,error:linkError},{data:cases,error:caseError}]=await Promise.all([
      supabase.from('hr_case_links').select('case_id,label,linked_at').eq('module',module).eq('record_id',String(recordId)).order('linked_at',{ascending:false}),
      supabase.from('hr_cases').select('id,case_number,employee_name,subject,status,opened_at').order('updated_at',{ascending:false}).limit(200)
    ]);
    if(linkError) throw linkError;
    if(caseError) throw caseError;
    const linkedIds=new Set((links||[]).map(x=>String(x.case_id)));
    const linkedCases=(cases||[]).filter(c=>linkedIds.has(String(c.id)));
    const availableCases=(cases||[]).filter(c=>!linkedIds.has(String(c.id)));
    openModal(`<div class="modal-head"><div><h3>${esc(caseModuleLabel(module))} — HR Case</h3><div class="small">${esc(caseRecordLabel(module,rec))}</div></div><button onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="panel" style="padding:14px;margin-bottom:14px;">
          <h3>Linked Case${linkedCases.length===1?'':'s'}</h3>
          <div class="desc">This record can belong to one or more HR case files.</div>
          ${linkedCases.length?linkedCases.map(c=>`<div class="case-link" style="margin-bottom:8px;"><div class="stage">${iDoc(13)}</div><div class="body"><div class="title">${esc(c.case_number)}</div><div class="meta">${esc(c.subject||'HR Case')} · ${statusBadge(c.status,CASE_STATUS_MAP)}</div></div><div class="actions"><button class="btn btn-ghost btn-sm" onclick="openCaseDetails('${c.id}')">Open</button></div></div>`).join(''):'<div class="empty"><b>Not linked to a case yet</b>Create a new case or link this record to an existing one.</div>'}
        </div>
        <div class="panel" style="padding:14px;">
          <h3>Attach to Case</h3>
          <div class="desc">Choose an existing case or create a new case from this record.</div>
          ${availableCases.length?`<div class="field"><label>Existing HR Case</label><select id="record-case-select"><option value="">Select a case…</option>${availableCases.map(c=>`<option value="${esc(c.id)}">${esc(c.case_number)} — ${esc(c.employee_name)}${c.subject?' — '+esc(c.subject):''}</option>`).join('')}</select></div><button class="btn btn-ghost btn-sm" onclick="linkRecordToExistingCase('${module}','${recordId}')">Link to Selected Case</button>`:'<div class="small">No other existing cases are available for linking.</div>'}
          <div style="height:10px"></div>
          <button class="btn btn-brass btn-sm" onclick="createCaseFromRecord('${module}','${recordId}')">${iPlus(13)} Create New Case from This Record</button>
        </div>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`);
    document.getElementById('modal').classList.add('case-modal');
  }catch(e){toast('Could not load case links: '+e.message,true);}
}
async function createCaseFromRecord(module,recordId){
  if(SESSION?.role==='Viewer') return;
  const rec=(DB[module]||[]).find(r=>String(r.id)===String(recordId));
  if(!rec){toast('Record could not be found.',true);return;}
  const employeeName=rec.employeeName||rec.name||'';
  const emp=employeeName?DB.employees.find(e=>String(e.name).toLowerCase()===String(employeeName).toLowerCase()):null;
  const department=rec.department||emp?.department||'';
  const openedAt=caseRecordDate(module,rec)||todayISO();
  const subject=caseRecordLabel(module,rec);
  try{
    const caseNumber=await nextCaseNumber();
    const {data,error}=await supabase.from('hr_cases').insert({
      case_number:caseNumber,employee_record_id:emp?.id||null,employee_name:employeeName||'Unassigned',department,subject,status:'Open',
      opened_at:openedAt,assigned_to:SESSION?.id||null,created_by:SESSION?.id||null,updated_by:SESSION?.id||null
    }).select('id').single();
    if(error) throw error;
    const {error:linkError}=await supabase.from('hr_case_links').insert({case_id:data.id,module,record_id:String(recordId),label:subject,linked_by:SESSION?.id||null});
    if(linkError){await supabase.from('hr_cases').delete().eq('id',data.id);throw linkError;}
    logAudit(`Created HR case ${caseNumber} from ${caseModuleLabel(module)}`);
    toast(`HR case ${caseNumber} created and linked.`);
    await openCaseDetails(data.id);
  }catch(e){toast('Could not create HR case: '+e.message,true);}
}
async function linkRecordToExistingCase(module,recordId){
  if(SESSION?.role==='Viewer') return;
  const caseId=document.getElementById('record-case-select')?.value;
  if(!caseId){toast('Please select an existing HR case first.');return;}
  const rec=(DB[module]||[]).find(r=>String(r.id)===String(recordId));
  if(!rec){toast('Record could not be found.',true);return;}
  const label=caseRecordLabel(module,rec);
  const {error}=await supabase.from('hr_case_links').insert({case_id:caseId,module,record_id:String(recordId),label,linked_by:SESSION?.id||null});
  if(error){toast(error.code==='23505'?'That record is already linked to this case.':'Could not link record: '+error.message,true);return;}
  logAudit(`Linked ${caseModuleLabel(module)} to existing HR case`);
  toast('Record linked to HR case.');
  await openCaseDetails(caseId);
}
async function nextCaseNumber(){
  const year=new Date().getFullYear();
  const prefix=`CASE-${year}-`;
  const {data,error}=await supabase.from('hr_cases').select('case_number,created_at').like('case_number',`${prefix}%`).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error;
  const match=String(data?.case_number||'').match(/-(\d+)$/);
  const next=(match?parseInt(match[1],10):0)+1;
  return `${prefix}${String(next).padStart(4,'0')}`;
}
function casePriorityBadge(priority){
  const p=priority||'Normal';
  const cls=p==='Urgent'?'urgent':p==='High'?'high':'';
  return `<span class="case-priority ${cls}"><span class="dot"></span>${esc(p)}</span>`;
}
function caseDeadlineInfo(dueDate,status){
  if(!dueDate || ['Closed','Cancelled','Resolved'].includes(status)) return {label:'No deadline',cls:''};
  const today=new Date(todayISO()+'T00:00:00');
  const due=new Date(dueDate+'T00:00:00');
  const days=Math.ceil((due-today)/86400000);
  if(days<0) return {label:`Overdue ${Math.abs(days)}d`,cls:'overdue'};
  if(days===0) return {label:'Due today',cls:'overdue'};
  if(days<=7) return {label:`Due in ${days}d`,cls:'soon'};
  return {label:`Due in ${days}d`,cls:'ok'};
}
function caseWorkflowSteps(status){
  const steps=['Open','NTE Issued','Memo Issued','For Decision','Resolved','Closed'];
  const idx=Math.max(0,steps.indexOf(status));
  return `<div class="case-progress">${steps.map((st,i)=>`<div class="case-progress-step ${i<=idx?'active':''} ${i===idx?'current':''}"><div class="dot"></div><div class="label">${esc(st)}</div></div>`).join('')}</div>`;
}
function caseActivityLabel(a){
  const labels={created:'Case Created',updated:'Case Updated',status:'Status Changed',linked:'Record Linked',unlinked:'Record Unlinked',note:'Case Note',deadline:'Deadline Updated',assignment:'Assignment Updated',priority:'Priority Updated'};
  return labels[a.activity_type] || a.activity_type || 'Case Activity';
}
function caseActivityIcon(a){
  const m={created:iPlus(12),updated:iEdit(12),status:iShield(12),linked:iDoc(12),unlinked:iTrash(12),note:iDoc(12),deadline:iCal(12),assignment:iUser(12),priority:iShield(12)};
  return m[a.activity_type] || iDoc(12);
}
async function addCaseActivity(caseId,activityType,note='',statusFrom=null,statusTo=null,dueDate=null){
  if(!caseId||!SESSION?.id) return false;
  const {error}=await supabase.from('hr_case_activity').insert({case_id:caseId,activity_type:activityType,note:note||null,status_from:statusFrom||null,status_to:statusTo||null,due_date:dueDate||null,created_by:SESSION.id});
  if(error){ console.warn('Case activity save failed',error); return false; }
  return true;
}
async function addCaseNote(caseId){
  if(SESSION?.role==='Viewer') return;
  const el=document.getElementById('case-note-input');
  const note=(el?.value||'').trim();
  if(!note){toast('Enter a case note first.');return;}
  if(await addCaseActivity(caseId,'note',note)){
    logAudit('Added a case note');
    await openCaseDetails(caseId);
  }
}
async function renderCases(){
  setTitle('HR Cases','Central case file linking incidents, violations, notices, decisions, and related HR records.');
  const q=(STATE.search||'').toLowerCase();
  let query=supabase.from('hr_cases').select('id,case_number,employee_record_id,employee_name,department,subject,status,opened_at,closed_at,assigned_to,priority,due_date,remarks,updated_at').order('updated_at',{ascending:false});
  if(STATE.filter) query=query.eq('status',STATE.filter);
  const {data:cases,error}=await query;
  if(error){ document.getElementById('content').innerHTML=`<div class="notice"><b>Could not load HR cases.</b> ${esc(error.message)}</div>`; return; }
  const rows=(cases||[]).filter(c=>!q || [c.case_number,c.employee_name,c.department,c.subject,c.status,c.priority].some(v=>String(v||'').toLowerCase().includes(q)));
  document.getElementById('content').innerHTML=`
    <div class="sectionhead"><div><h2>HR Cases</h2><p>${rows.length} case${rows.length===1?'':'s'} shown${STATE.filter?' · filtered by status':''}.</p></div>${canEdit()?`<button class="btn btn-brass" onclick="openCaseForm()">${iPlus(15)} New HR Case</button>`:''}</div>
    <div class="notice"><b>Case file:</b> A case groups related HR records into one trackable matter. Priority and deadlines help HR staff focus follow-ups before opening the full case file.</div>
    <div class="toolbar"><div class="search">${iSearch(15)}<input data-search-key="search" type="search" autocomplete="off" placeholder="Search case number, employee, subject…" value="${esc(STATE.search)}" oninput="queueSearchRender(this,'search',renderCases)"></div><select onchange="STATE.filter=this.value; renderCases()"><option value="">All Statuses</option>${Object.keys(CASE_STATUS_MAP).map(x=>`<option value="${esc(x)}" ${STATE.filter===x?'selected':''}>${esc(x)}</option>`).join('')}</select><div class="spacer"></div></div>
    <div class="tablewrap"><table class="data-table"><thead><tr><th>Case No.</th><th>Employee</th><th>Priority</th><th>Status</th><th>Due</th><th>Assigned To</th><th style="text-align:right;">Actions</th></tr></thead>
    <tbody>${rows.length?rows.map(c=>{const ass=DB.users.find(u=>u.id===c.assigned_to);const dl=caseDeadlineInfo(c.due_date,c.status); return `<tr><td><b class="mono">${esc(c.case_number)}</b><div class="small">${esc(c.subject||'HR Case')}</div></td><td><b>${esc(c.employee_name)}</b><div class="small">${esc(c.department||'Unassigned')}</div></td><td>${casePriorityBadge(c.priority)}</td><td>${statusBadge(c.status,CASE_STATUS_MAP)}</td><td><span class="case-deadline ${dl.cls}">${dl.label}</span><div class="small">${c.due_date?fmtDate(c.due_date):'No date'}</div></td><td>${esc(ass?.fullName||'Unassigned')}</td><td><div class="rowactions"><button class="iconbtn" title="Open case" onclick="openCaseDetails('${c.id}')">${iDoc(14)}</button>${canEdit()?`<button class="iconbtn" title="Edit case" onclick="openCaseForm('${c.id}')">${iEdit(14)}</button><button class="iconbtn" title="Delete case" onclick="deleteCase('${c.id}')">${iTrash(14)}</button>`:''}</div></td></tr>`;}).join(''):`<tr><td colspan="8"><div class="empty"><b>No HR cases yet</b>${canEdit()?'Create your first case to begin linking HR records.':'No cases are available for viewing.'}</div></td></tr>`}</tbody></table></div>`;
}
function openCaseForm(id){
  if(SESSION?.role==='Viewer'){ toast('Viewer accounts have read-only access.',true); return; }
  if(!id){ openCaseFormMarkup(null); return; }
  supabase.from('hr_cases').select('*').eq('id',id).maybeSingle().then(({data,error})=>{ if(error||!data){toast('Could not load the case for editing.',true);return;} openCaseFormMarkup(data); });
}
function openCaseFormMarkup(existing){
  const assigned=DB.users.filter(u=>u.role==='Administrator'||u.role==='HR Staff');
  openModal(`<div class="modal-head"><h3>${existing?'Edit':'Create'} HR Case</h3><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="formgrid">
    ${employeePickerHTML({id:'case_employee',label:'Employee',selectedId:existing?.employee_record_id||'',required:true,full:true,autofill:false})}
    <div class="field"><label>Case Number</label><input value="${esc(existing?.case_number||'Generated on save')}" disabled style="background:var(--paper);"></div>
    <div class="field"><label>Status</label><select id="case_status">${Object.keys(CASE_STATUS_MAP).map(x=>`<option ${existing?.status===x||(!existing&&x==='Open')?'selected':''}>${esc(x)}</option>`).join('')}</select></div>
    <div class="field"><label>Priority</label><select id="case_priority">${['Low','Normal','High','Urgent'].map(x=>`<option ${existing?.priority===x||(!existing&&x==='Normal')?'selected':''}>${esc(x)}</option>`).join('')}</select></div>
    <div class="field"><label>Opened Date *</label><input type="date" id="case_opened" value="${esc(existing?.opened_at||todayISO())}"></div>
    <div class="field"><label>Due Date</label><input type="date" id="case_due" value="${esc(existing?.due_date||'')}"></div>
    <div class="field"><label>Closed Date</label><input type="date" id="case_closed" value="${esc(existing?.closed_at||'')}"></div>
    <div class="field"><label>Assigned To</label><select id="case_assigned"><option value="">Unassigned</option>${assigned.map(u=>`<option value="${esc(u.id)}" ${existing?.assigned_to===u.id?'selected':''}>${esc(u.fullName)} · ${esc(u.role)}</option>`).join('')}</select></div>
    <div class="field full"><label>Subject / Matter</label><input id="case_subject" value="${esc(existing?.subject||'')}" placeholder="e.g. Attendance violation — repeated unauthorized absence"></div>
    <div class="field full"><label>Remarks</label><textarea id="case_remarks" rows="3" placeholder="Case notes, context, or internal remarks…">${esc(existing?.remarks||'')}</textarea></div>
  </div><div class="computed-note">Case numbers are generated sequentially per calendar year. Priority and due date drive the Action Center and case deadline indicators.</div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveCase('${existing?.id||''}')">Save Case</button></div>`);
}
async function saveCase(id){
  if(SESSION?.role==='Viewer') return;
  const employee=employeePickerSelected('case_employee');
  const employeeRecordId=employee?.id||''; const employeeName=employee?.name||''; const department=employee?.department||'';
  const status=document.getElementById('case_status').value; const priority=document.getElementById('case_priority').value;
  const openedAt=document.getElementById('case_opened').value; const dueDate=document.getElementById('case_due').value||null; const closedAt=document.getElementById('case_closed').value||null;
  const subject=document.getElementById('case_subject').value.trim(); const remarks=document.getElementById('case_remarks').value.trim(); const assignedTo=document.getElementById('case_assigned').value||null;
  if(!employeeRecordId||!employeeName||!openedAt){toast('Please select an employee and opened date.');return;}
  if(dueDate&&dueDate<openedAt){toast('Due date cannot be before the opened date.');return;}
  if(closedAt&&closedAt<openedAt){toast('Closed date cannot be before the opened date.');return;}
  if(status==='Closed'&&!closedAt){toast('Please enter the closed date for a Closed case.');return;}
  if(dueDate&&closedAt&&closedAt<dueDate&&status!=='Closed'){toast('An open case cannot have a closed date earlier than its due date.');return;}
  try{
    if(id){
      const {data:before,error:beforeError}=await supabase.from('hr_cases').select('status,priority,due_date,assigned_to,remarks').eq('id',id).maybeSingle(); if(beforeError) throw beforeError;
      const {error}=await supabase.from('hr_cases').update({employee_record_id:employeeRecordId,employee_name:employeeName,department,subject,status,opened_at:openedAt,closed_at:closedAt,assigned_to:assignedTo,priority,due_date:dueDate,updated_by:SESSION?.id||null,remarks}).eq('id',id); if(error) throw error;
      if(before?.status!==status) await addCaseActivity(id,'status',`Status changed from ${before?.status||'—'} to ${status}.`,before?.status||null,status,dueDate);
      if(before?.priority!==priority) await addCaseActivity(id,'priority',`Priority changed to ${priority}.`,null,null,dueDate);
      if((before?.due_date||null)!==(dueDate||null)) await addCaseActivity(id,'deadline',dueDate?`Case deadline set to ${fmtDate(dueDate)}.`:'Case deadline cleared.',null,null,dueDate);
      if((before?.assigned_to||null)!==(assignedTo||null)){ const ass=DB.users.find(u=>u.id===assignedTo); await addCaseActivity(id,'assignment',assignedTo?`Assigned to ${ass?.fullName||'HR staff'}.`:'Case assignment cleared.'); }
      if((before?.remarks||'')!==remarks && remarks) await addCaseActivity(id,'updated','Case remarks updated.');
      logAudit('Updated an HR case'); closeModal(); toast('HR case updated.'); await renderCases();
    }else{
      const caseNumber=await nextCaseNumber();
      const {data,error}=await supabase.from('hr_cases').insert({case_number:caseNumber,employee_record_id:employeeRecordId,employee_name:employeeName,department,subject,status,opened_at:openedAt,closed_at:closedAt,assigned_to:assignedTo,priority,due_date:dueDate,created_by:SESSION?.id||null,updated_by:SESSION?.id||null,remarks}).select('id').single(); if(error) throw error;
      await addCaseActivity(data.id,'created',`Case created for ${employeeName}.`,null,status,dueDate);
      if(assignedTo){ const ass=DB.users.find(u=>u.id===assignedTo); await addCaseActivity(data.id,'assignment',`Assigned to ${ass?.fullName||'HR staff'}.`); }
      if(dueDate) await addCaseActivity(data.id,'deadline',`Case deadline set to ${fmtDate(dueDate)}.`,null,null,dueDate);
      if(priority!=='Normal') await addCaseActivity(data.id,'priority',`Case priority set to ${priority}.`);
      logAudit(`Created HR case ${caseNumber}`); closeModal(); toast(`HR case ${caseNumber} created.`); await openCaseDetails(data.id);
    }
  }catch(e){toast('Could not save HR case: '+e.message,true);}
}
async function openCaseDetails(id){
  const [{data:caseRec,error:caseError},{data:links,error:linkError},{data:activity,error:activityError}]=await Promise.all([
    supabase.from('hr_cases').select('*').eq('id',id).maybeSingle(),
    supabase.from('hr_case_links').select('case_id,module,record_id,label,linked_at').eq('case_id',id).order('linked_at',{ascending:true}),
    supabase.from('hr_case_activity').select('*').eq('case_id',id).order('created_at',{ascending:false})
  ]);
  if(caseError||!caseRec){toast('Could not load case details.',true);return;}
  if(linkError){toast('Could not load linked records: '+linkError.message,true);return;}
  if(activityError){toast('Could not load case activity. Please run the Phase 9 SQL first: '+activityError.message,true);return;}
  const assigned=DB.users.find(u=>u.id===caseRec.assigned_to);
  const deadline=caseDeadlineInfo(caseRec.due_date,caseRec.status);
  const age=analyticsDaysOpen(caseRec.opened_at,caseRec.closed_at);
  const linkRows=(links||[]).map((ln,i)=>{const rec=(DB[ln.module]||[]).find(r=>String(r.id)===String(ln.record_id));const label=ln.label||caseRecordLabel(ln.module,rec);const date=caseRecordDate(ln.module,rec);return `<div class="case-link"><div class="stage">${i+1}</div><div class="body"><div class="title">${esc(caseModuleLabel(ln.module))}</div><div class="meta">${esc(label)}${date?' · '+esc(fmtDate(date)):''} · Linked ${new Date(ln.linked_at).toLocaleString()}</div></div><div class="actions">${canEdit()?`<button class="iconbtn" title="Remove link" onclick="unlinkCaseRecord('${id}','${esc(ln.module)}','${esc(ln.record_id)}')">${iTrash(13)}</button>`:''}</div></div>`;}).join('');
  const activityRows=(activity||[]).map(a=>{const actor=DB.users.find(u=>u.id===a.created_by); return `<div class="case-activity-item"><div class="case-activity-dot">${caseActivityIcon(a)}</div><div class="case-activity-body"><div class="case-activity-head"><div><div class="case-activity-title">${esc(caseActivityLabel(a))}</div><div class="case-activity-meta">${esc(actor?.fullName||'System')} · ${new Date(a.created_at).toLocaleString()}</div></div>${a.status_to?statusBadge(a.status_to,CASE_STATUS_MAP):''}</div>${a.note?`<div class="case-activity-note">${esc(a.note)}</div>`:''}</div></div>`;}).join('');
  const currentStep=['Open','NTE Issued','Memo Issued','For Decision','Resolved','Closed'].includes(caseRec.status)?caseRec.status:'Open';
  openModal(`<div class="modal-head"><div><h3>${esc(caseRec.case_number)}</h3><div class="small">${esc(caseRec.subject||'HR Case File')}</div></div><button onclick="closeModal()">&times;</button></div><div class="modal-body">
    <div class="case-summary"><div class="mini"><div class="k">Employee</div><div class="v">${esc(caseRec.employee_name)}</div></div><div class="mini"><div class="k">Department</div><div class="v">${esc(caseRec.department||'—')}</div></div><div class="mini"><div class="k">Status</div><div class="v">${statusBadge(caseRec.status,CASE_STATUS_MAP)}</div></div><div class="mini"><div class="k">Assigned To</div><div class="v">${esc(assigned?.fullName||'Unassigned')}</div></div></div>
    ${caseWorkflowSteps(currentStep)}
    <div class="case-intel-grid">
      <div class="panel" style="padding:14px;"><div class="dashboard-panel-head"><div><h3>Case Intelligence</h3><div class="desc">Key tracking details for this case.</div></div></div><div class="case-intel-cards"><div class="case-intel-card"><div class="k">Priority</div><div class="v">${casePriorityBadge(caseRec.priority)}</div></div><div class="case-intel-card"><div class="k">Age</div><div class="v">${age} day${age===1?'':'s'}</div></div><div class="case-intel-card"><div class="k">Deadline</div><div class="v"><span class="case-deadline ${deadline.cls}">${esc(deadline.label)}</span><div class="small" style="margin-top:3px;">${caseRec.due_date?fmtDate(caseRec.due_date):'No deadline'}</div></div></div><div class="case-intel-card"><div class="k">Opened</div><div class="v">${fmtDate(caseRec.opened_at)}</div></div><div class="case-intel-card"><div class="k">Updated</div><div class="v">${fmtDate(String(caseRec.updated_at).slice(0,10))}</div></div><div class="case-intel-card"><div class="k">Records</div><div class="v">${links?.length||0}</div></div></div></div>
      <div class="panel" style="padding:14px;"><h3>Internal Case Note</h3><div class="desc">Append a dated note to the case timeline.</div>${canEdit()?`<div class="case-note-box"><textarea id="case-note-input" placeholder="Add investigation notes, follow-up details, reminders, or handover information…"></textarea><button class="btn btn-primary" onclick="addCaseNote('${id}')">Add Note</button></div>`:'<div class="small">Viewer accounts can read case notes but cannot add them.</div>'}</div>
    </div>
    ${canEdit()?`<div class="panel" style="padding:14px;margin-bottom:14px;"><div class="sectionhead" style="margin-bottom:10px;"><div><h3>Case Workflow</h3><div class="desc" style="margin-bottom:0;">Create the next HR document directly from this case. New records are automatically linked back to this case.</div></div></div><div style="display:flex;flex-wrap:wrap;gap:8px;"><button class="btn btn-ghost btn-sm" onclick="openWorkflowRecordForm('nte','${id}')">${iPlus(13)} New NTE</button><button class="btn btn-ghost btn-sm" onclick="openWorkflowRecordForm('memos','${id}')">${iPlus(13)} New Memorandum</button><button class="btn btn-ghost btn-sm" onclick="openWorkflowRecordForm('nod','${id}')">${iPlus(13)} New NOD</button><button class="btn btn-ghost btn-sm" onclick="openWorkflowATDForm('${id}')">${iPlus(13)} New ATD</button><button class="btn btn-ghost btn-sm" onclick="openCaseLinkForm('${id}')">${iPlus(13)} Link Existing Record</button><button class="btn btn-ghost btn-sm" onclick="setCaseWorkflowStatus('${id}','Resolved')">Mark Resolved</button><button class="btn btn-ghost btn-sm" onclick="setCaseWorkflowStatus('${id}','Closed')">Close Case</button></div></div>`:''}
    <div class="analytics-grid equal">
      <div class="panel" style="padding:14px;"><div class="sectionhead" style="margin-bottom:10px;"><div><h2 style="font-size:16px;">Linked HR Records</h2><p>${links?.length||0} linked record${(links?.length||0)===1?'':'s'}.</p></div></div><div class="case-links">${linkRows||'<div class="empty"><b>No records linked yet</b>Use the workflow buttons or link an existing record to build the case history.</div>'}</div></div>
      <div class="panel" style="padding:14px;"><div class="sectionhead" style="margin-bottom:10px;"><div><h2 style="font-size:16px;">Activity Timeline</h2><p>Chronological case actions and internal notes.</p></div></div><div class="case-activity">${activityRows||'<div class="empty"><b>No activity yet</b>Case activity will appear here as the file progresses.</div>'}</div></div>
    </div>
    <div style="margin-top:14px;" class="panel"><h3>Case Information</h3><div class="small" style="margin-top:6px;line-height:1.7;">Opened: <b>${fmtDate(caseRec.opened_at)}</b> · Due: <b>${fmtDate(caseRec.due_date)}</b> · Closed: <b>${fmtDate(caseRec.closed_at)}</b><br>Priority: <b>${esc(caseRec.priority||'Normal')}</b> · Assigned: <b>${esc(assigned?.fullName||'Unassigned')}</b><br>Remarks: ${esc(caseRec.remarks||'—')}</div></div>
  </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal(); renderCases();">Close</button>${canEdit()?`<button class="btn btn-primary" onclick="openCaseForm('${id}')">Edit Case</button>`:''}</div>`);
  document.getElementById('modal').classList.add('case-modal');
}
async function openWorkflowATDForm(caseId){
  if(SESSION?.role==='Viewer') return;
  CASE_WORKFLOW_CONTEXT = {caseId, module:'atd'};
  openATDForm();
  const {data,error}=await supabase.from('hr_cases').select('employee_record_id,employee_name,department,subject').eq('id',caseId).maybeSingle();
  if(error||!data) return;
  employeePickerSet('f_employeeName',data.employee_record_id||data.employee_name||'');
  const dept=document.getElementById('f_department'); if(dept && !dept.value) dept.value=data.department||'';
  const deduction=document.getElementById('f_deductionType'); if(deduction && !deduction.value && data.subject) deduction.value=data.subject;
}

async function setCaseWorkflowStatus(caseId,status){
  if(SESSION?.role==='Viewer') return;
  const {data:before,error:beforeError}=await supabase.from('hr_cases').select('status,due_date').eq('id',caseId).maybeSingle();
  if(beforeError){toast('Could not load case status: '+beforeError.message,true);return;}
  const closed_at=status==='Closed'?todayISO():null;
  const {error}=await supabase.from('hr_cases').update({status,closed_at,updated_by:SESSION?.id||null}).eq('id',caseId);
  if(error){toast('Could not update case status: '+error.message,true);return;}
  await addCaseActivity(caseId,'status',`Status changed from ${before?.status||'—'} to ${status}.`,before?.status||null,status,before?.due_date||null);
  logAudit(`Changed HR case status to ${status}`);
  await openCaseDetails(caseId);
}

function openCaseLinkForm(caseId){
  if(SESSION?.role==='Viewer') return;
  const allowed=['incidents','cvr','disciplinary','nte','memos','nod','atd','employees','leaves','oncall','transfers','prf','evaluations'];
  openModal(`<div class="modal-head"><h3>Link Existing HR Record</h3><button onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="field"><label>Record Type *</label><select id="case-link-module" onchange="populateCaseRecordOptions(this.value)">${allowed.map((m,i)=>`<option value="${m}" ${i===0?'selected':''}>${esc(caseModuleLabel(m))}</option>`).join('')}</select></div><div class="field"><label>Record *</label><select id="case-link-record"><option value="">Select a record…</option></select></div><div class="computed-note">The record remains in its original module. This action creates only a relationship to the case file.</div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="linkCaseRecord('${caseId}')">Link Record</button></div>`);
  populateCaseRecordOptions(allowed[0]);
}
function populateCaseRecordOptions(module){const sel=document.getElementById('case-link-record');if(!sel)return;const rows=(DB[module]||[]).slice().sort((a,b)=>caseRecordLabel(module,a).localeCompare(caseRecordLabel(module,b)));sel.innerHTML='<option value="">Select a record…</option>'+rows.map(r=>`<option value="${esc(r.id)}">${esc(caseRecordLabel(module,r))}</option>`).join('');}
async function linkCaseRecord(caseId){
  if(SESSION?.role==='Viewer') return;
  const module=document.getElementById('case-link-module').value; const recordId=document.getElementById('case-link-record').value;
  if(!module||!recordId){toast('Please select both a record type and record.');return;}
  const rec=(DB[module]||[]).find(r=>String(r.id)===String(recordId)); const label=caseRecordLabel(module,rec);
  const {error}=await supabase.from('hr_case_links').insert({case_id:caseId,module,record_id:String(recordId),label,linked_by:SESSION?.id||null});
  if(error){toast(error.code==='23505'?'That record is already linked to this case.':'Could not link record: '+error.message,true);return;}
  const newStatus=module==='nte'?'NTE Issued':module==='memos'?'Memo Issued':module==='nod'?'For Decision':null;
  if(newStatus){const {data:beforeCase}=await supabase.from('hr_cases').select('status,due_date').eq('id',caseId).maybeSingle(); const {error:statusError}=await supabase.from('hr_cases').update({status:newStatus,updated_by:SESSION?.id||null}).eq('id',caseId);if(statusError){console.warn('Case status update failed',statusError);} else await addCaseActivity(caseId,'status',`Status changed from ${beforeCase?.status||'—'} to ${newStatus} after linking ${caseModuleLabel(module)}.`,beforeCase?.status||null,newStatus,beforeCase?.due_date||null);}
  await addCaseActivity(caseId,'linked',`Linked ${caseModuleLabel(module)}: ${label}.`);
  logAudit(`Linked ${caseModuleLabel(module)} to HR case`); await openCaseDetails(caseId);
}
async function unlinkCaseRecord(caseId,module,recordId){
  if(SESSION?.role==='Viewer') return;
  const {error}=await supabase.from('hr_case_links').delete().eq('case_id',caseId).eq('module',module).eq('record_id',recordId);
  if(error){toast('Could not remove link: '+error.message,true);return;}
  await addCaseActivity(caseId,'unlinked',`Unlinked ${caseModuleLabel(module)}: ${caseRecordLabel(module,(DB[module]||[]).find(r=>String(r.id)===String(recordId)))}.`);
  logAudit(`Unlinked ${caseModuleLabel(module)} from HR case`); await openCaseDetails(caseId);
}
async function deleteCase(id){
  if(SESSION?.role==='Viewer') return;
  const {error}=await supabase.from('hr_cases').delete().eq('id',id);
  if(error){toast('Could not delete case: '+error.message,true);return;}
  logAudit('Deleted an HR case');toast('HR case deleted.');await renderCases();
}

/* ================================================================
   Professional data-table pagination + interaction layer
   ================================================================ */
const TABLE_ENHANCER=installTableEnhancer({getState:()=>STATE,getContent:()=>document.getElementById('content')});
const {enhanceDataTables,tablePageGo,tablePageSize,resetAllTablePages}=TABLE_ENHANCER;

/* ================================================================
   RENDERERS map + boot
   ================================================================ */
const RENDERERS = {
  selfService: renderSelfService,
  teamApprovals: renderTeamApprovals,
  lifecycleChecklists: renderLifecycleChecklists,
  dashboard: renderDashboard,
  actionCenter: renderActionCenter,
  workflow: renderWorkflowCenter,
  automation: renderAutomationCenter,
  operations: renderOperationsWorkspace,
  analytics: renderAnalytics,
  cases: renderCases,
  documents: renderDocuments,
  employees: renderEmployees,
  onboarding: renderOnboarding,
  employeeLifecycle: renderEmployeeLifecycle,
  leaves: renderLeaves,
  disciplinary: renderDisciplinary,
  nte: ()=>renderModuleView('nte'),
  memos: ()=>renderModuleView('memos'),
  nod: ()=>renderModuleView('nod'),
  oncall: ()=>renderModuleView('oncall'),
  transfers: ()=>renderModuleView('transfers'),
  cvr: renderCVR,
  incidents: renderIncidents,
  atd: renderATD,
  weeklyReport: renderWeeklyReport,
  prf: ()=>renderModuleView('prf'),
  evaluations: renderEvaluations,
  offenseSummary: renderOffenseSummary,
  offenseCatalog: ()=>renderModuleView('offenseCatalog'),
  reports: renderReports,
  dataQuality: renderDataQuality,
  users: renderUsers,
  settings: renderSettings,
};

document.addEventListener('click', e=>{
  const wrap=document.getElementById('notification-wrap');
  if(wrap && !wrap.contains(e.target)) closeNotificationPanel();
  const navPanel=document.getElementById('navgroup-popover');
  if(navPanel&&!navPanel.contains(e.target)&&!e.target.closest('.navgroup-head'))closeNavGroupPanel();
  document.querySelectorAll('.employee-picker').forEach(picker=>{
    if(!picker.contains(e.target)) employeePickerClose(picker.id.replace(/_picker$/,''));
  });
});
document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  closeNotificationPanel();
  closeNavGroupPanel();
  document.querySelectorAll('.employee-picker').forEach(picker=>employeePickerClose(picker.id.replace(/_picker$/,'')));
});
window.addEventListener('resize',()=>{
  const panel=document.getElementById('navgroup-popover');
  const trigger=document.querySelector('.navgroup-head[aria-expanded="true"]');
  if(panel&&trigger)positionNavGroupPanel(panel,trigger);
});
document.getElementById('login-form').addEventListener('keydown', e=>{ if(document.getElementById('auth-error').style.display==='block') document.getElementById('auth-error').style.display='none'; });
const ROW_ACTION_OBSERVER=new MutationObserver(()=>requestAnimationFrame(enhanceRowActionMenus));
['content','modal'].forEach(id=>{
  const root=document.getElementById(id);
  if(root) ROW_ACTION_OBSERVER.observe(root,{childList:true,subtree:true});
});
let PAGE_INTRO_FRAME=0;
const PAGE_INTRO_OBSERVER=new MutationObserver(()=>{
  cancelAnimationFrame(PAGE_INTRO_FRAME);
  PAGE_INTRO_FRAME=requestAnimationFrame(()=>compactRedundantPageIntros(
    document.getElementById('content'),
    document.getElementById('tb-title')?.textContent
  ));
});
PAGE_INTRO_OBSERVER.observe(document.getElementById('content'),{childList:true,subtree:true});

// The app is an ES module, while the existing UI uses inline onclick/onsubmit
// handlers. Expose the application handlers on window so GitHub Pages/Vercel
// can execute those handlers normally.
Object.assign(window, {
  STATE,
  addDaysISO, atdComputeStatus, atdFillEmployee, atdPayslipCellHTML, atdRemaining, atdToggleCategory, atdTotalPaid,
  addCaseActivity, addCaseNote, caseActivityIcon, caseActivityLabel, caseDeadlineInfo, casePriorityBadge, caseWorkflowSteps, caseModuleLabel, caseRecordLabel, createCaseFromRecord, deleteCase, linkCaseRecord, linkNewRecordToCase, linkRecordToExistingCase, openCaseDetails, openCaseForm, openCaseLinkForm, openRecordCaseDialog, openWorkflowATDForm, openWorkflowRecordForm, populateCaseRecordOptions, renderCases, saveCase, setCaseWorkflowStatus, buildNotificationItems, closeNotificationPanel, markAllNotificationsRead, openNotification, goFromNotifications, refreshNotificationBadge, renderNotificationPanel, toggleNotificationPanel, analyticsApplyFilters, analyticsSetPreset, exportAnalyticsSnapshot,
  renderSelfService, renderTeamApprovals, openProfileChangeRequest, saveProfileChangeRequest, openLeaveRequest, saveLeaveRequest, cancelSelfServiceRequest, openServiceRequestReview, reviewServiceRequest,
  renderLifecycleChecklists, openLifecycleChecklistForm, saveLifecycleChecklist, openLifecycleChecklist, openLifecycleChecklistItem, returnToLifecycleChecklist, saveLifecycleChecklistItem, cancelLifecycleChecklist, lifecycleTemplateChanged,
  workflowSyncTasks, workflowPendingCount, workflowFindTask, workflowOpenSource, workflowSaveTaskNote, saveWorkflowTaskNote, workflowAssignTask, workflowSaveAssignment, workflowCompleteTask, workflowDecideTask, openWorkflowTask, openWorkflowCreateForm, saveWorkflowManualTask, renderWorkflowCenter, workflowActionButtons, workflowPriorityBadge, workflowDueText, workflowPageGo, workflowPageSize, workflowSetQuickFilter, workflowResetFilters, automationPageGo, automationPageSize,
  AUTOMATION_RULES, automationPendingCount, ensureAutomationSettings, automationRuleEnabled, runAutomationEngine, toggleAutomationRule, automationOpenTask, renderAutomationCenter,
  countStoredDocuments, renderDocuments, openStoredDocument, collectStoredDocuments, collectDocumentIndex, openDriveDocument, openDriveDocumentForm, saveDriveDocument, deleteDriveDocument, countDriveDocuments, documentExpiryInfo, openDriveWorkspace,
  attachCellHTML, attachPreviewHTML, authErr, bootAuthenticated, calShift, canEdit, classify, clearFileField, closeModal,
  consequenceFor, cvrOffenseLevel, cvrOffenseSummaryHTML, daysBetweenInclusive, defaultOffenseCatalog, deleteATDPayment,
  deleteATDRecord, deleteCVR, deleteEmployee, deleteIncident, deleteRecord, doLogin, doLogout, doRegister, donut,
  downloadATDPayslip, downloadAttachment, downloadCSV, downloadRecordAttachment, enterApp, esc, evalDueDate,
  evalStatusInfo, exportATDCSV, exportCVRCSV, exportEmployeesCSV, exportIncidentsCSV, exportModuleCSV, exportWeeklyCSV, openEmployeeImport, handleEmployeeImportFile, renderEmployeeImportPreview, commitEmployeeImport, downloadEmployeeImportTemplate,
  fieldHTML, fmtDate, formatGovernmentIdInput, getEvalRecord, go, handleFileInput, incidentTypeOccurrence, incidentTypeSummaryHTML,
  toggleSidebar, closeSidebar, applyReportFilters, exportReportEmployees, exportReportActivity, exportReportATD, exportReportCases,
  loadDB, loadProfiles, logAudit, mondayOf, nextEmployeeNumber, normalizeEmployeeMasterData, nthLabel, offenseLevelFor, employeeCompleteness, employeeTenureText, openEmployeeStatusForm, saveEmployeeStatus, openATDForm, openATDPaymentForm,
  openATDPayments, openCVRForm, openEmployeeForm, openEmployeeLifecycleEventForm, openEmployeeProfile, openEmployeeStatusForm, openEvalForm, openIncidentForm, openModal, openRecordForm,
  openTransferForEmployee, openUserForm, overlapsRange, peso, readFields, renderATD, renderAnalytics, renderCVR, renderDashboard, dashboardOpenEmployees, dashboardOpenCases,
  renderDisciplinary, renderEmployees, employeeSearchInput, resetEmployeeDirectoryFilters, selectEmployeeDirectoryRow, openEmployeeColumnManager, saveEmployeeColumnPreferences, resetEmployeeColumnPreferences, renderOnboarding, openOnboardingForm, saveOnboardingCandidate, openOnboardingDetails, openOnboardingHire, convertOnboardingCandidate, queueSearchRender, cancelSearchRender, employeePickerOpen, employeePickerInput, employeePickerClose, employeePickerChoose, employeePickerClear, employeePickerSet, employeePickerSelected, employeePickerKeydown, renderEvaluations, renderIncidents, renderDataQuality, exportDataQuality, openEmployeeProfile, renderLeaveCalendar, renderLeaveRecords, lifecycleEmployeePreview, lifecycleEventTypeChanged, saveEmployeeLifecycleEvent, unlinkCaseRecord, opsHistoryOpenAction,
  renderLeaveSummary, renderLeaves, renderModuleView, renderNav, closeNavGroupPanel, renderEmployeeLifecycle, renderOffenseSummary, renderReports, renderSettings, renderActionCenter, actionCenterItems, actionCenterCounts, actionCenterSetLevel, actionCenterResetFilters, actionCenterPageGo, actionCenterPageSize,
  renderUsers, renderWeeklyReport, renderOperationsWorkspace, openEmployeeOperation, saveATDPayment, saveATDRecord, saveCVR, saveDB, saveEmployee, saveEmployeeTransfer,
  saveEval, saveIncident, saveRecord, saveSettings, saveUser, saveDepartmentSetting, savePositionSetting, setTitle, shiftDate, statusBadge, storageSettingsChanged, testGoogleDriveConnection, switchAuthTab, switchSettingsTab, syncPositionSelect, syncUserExportControl, toggleCatalogQuickAdd, catalogQuickAddKeydown, saveCatalogQuickAdd, openDepartmentSetting, openPositionSetting, toCSV,
  toast, todayISO, togglePasswordVisibility, toggleWeeklyCat, uid, uploadAttachment, weeklyShiftWeek, tablePageGo, tablePageSize, serverTablePageGo, serverTablePageSize, resetAllTablePages, enhanceDataTables, enhanceRowActionMenus, openRowActionMenu, runRowAction, openInformationNote, paginationMeta, paginationHTML, paginationReset, paginateRows,
  addressAutocompleteFocus, addressAutocompleteInput, addressAutocompleteBlur, addressAutocompleteKeydown, addressSelectOption, addressCopyFrom
});

(async function initSupabase(){
  const {data}=await supabase.auth.getSession();
  if(data.session) await bootAuthenticated(data.session.user);
})();
