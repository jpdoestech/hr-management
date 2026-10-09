import fs from 'node:fs';
import path from 'node:path';
import {paginationHTML,paginationMeta} from '../js/core/pagination.js';

const root=process.cwd();
const migrationFiles={
  'phase10-self-service.sql':'0007_self_service.sql',
  'phase11-lifecycle-checklists.sql':'0008_lifecycle_checklists.sql',
  'phase12-user-preferences.sql':'0009_user_preferences.sql',
  'phase13-onboarding.sql':'0010_onboarding_access.sql',
  'phase14-admin-storage-settings.sql':'0011_admin_storage_settings.sql',
  'phase15-organization-structure.sql':'0012_organization_structure.sql',
  'phase20-access-control.sql':'0017_access_control.sql',
  'phase23-employee-relations-case-foundation.sql':'0020_employee_relations_case_foundation.sql',
  'phase24-employee-relations-due-process.sql':'0021_employee_relations_due_process.sql',
  'phase25-disciplinary-history.sql':'0022_disciplinary_history.sql',
  'phase26-employee-relations-legacy-migration.sql':'0023_employee_relations_legacy_migration.sql',
  'phase27-employee-relations-monitoring.sql':'0024_employee_relations_monitoring.sql',
  'phase28-employee-relations-validation.sql':'0025_employee_relations_validation.sql',
  'phase29-employee-relations-evidence.sql':'0026_employee_relations_evidence.sql',
  'phase30-employee-relations-intake.sql':'0027_employee_relations_intake.sql',
  'phase31-employee-relations-revisions.sql':'0028_employee_relations_revisions.sql',
};
const orderedMigrations=[
  '0001_initial_schema.sql','0002_username_auth_lookup.sql','0003_role_permissions.sql','0004_case_workflow.sql','0005_attachment_lifecycle.sql','0006_case_intelligence.sql',
  '0007_self_service.sql','0008_lifecycle_checklists.sql','0009_user_preferences.sql','0010_onboarding_access.sql','0011_admin_storage_settings.sql','0012_organization_structure.sql',
  '0013_server_record_pagination.sql','0014_user_export_permissions.sql','0015_employee_directory_performance.sql','0016_tenant_scale_foundation.sql','0017_access_control.sql',
  '0018_employee_name_sort.sql','0019_hr_case_attachments.sql','0020_employee_relations_case_foundation.sql','0021_employee_relations_due_process.sql','0022_disciplinary_history.sql',
  '0023_employee_relations_legacy_migration.sql','0024_employee_relations_monitoring.sql','0025_employee_relations_validation.sql','0026_employee_relations_evidence.sql',
  '0027_employee_relations_intake.sql','0028_employee_relations_revisions.sql','0029_employee_relations_confidentiality.sql',
  '0030_employee_number_six_digits.sql',
  '0031_workforce_attendance.sql',
  '0032_employee_employment_model.sql',
  '0033_manpower_client_catalog.sql',
  '0034_manpower_draft_transactions.sql',
];
const migrationPath=name=>path.join(root,'supabase','migrations',migrationFiles[name]||name);
const readMigration=name=>fs.readFileSync(migrationPath(name),'utf8');
function existsWithExactCase(filePath){
  const relative=path.relative(root,filePath);
  if(!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  let current=root;
  for(const segment of relative.split(path.sep)){
    const match=fs.readdirSync(current).find(entry=>entry===segment);
    if(!match) return false;
    current=path.join(current,match);
  }
  return fs.existsSync(current);
}
const required=[
  'index.html','css/app.css','css/professional.css','js/app.js','js/vendor/xlsx.full.min.js','js/vendor/SHEETJS-LICENSE.txt',
  'js/address/address-component.js','js/address/address-index.js','js/address/address-models.js','js/address/address-validation.js',
  'assets/data/philippine-address/regions.json','assets/data/philippine-address/provinces.json','assets/data/philippine-address/cities.json',
  'js/core/pagination.js','js/core/table-enhancer.js','js/core/content-layout.js','js/core/employee-number.js','supabase-config.js','supabase/config.toml','supabase/README.md','.github/workflows/supabase.yml',
  ...orderedMigrations.map(name=>`supabase/migrations/${name}`),
  'supabase/maintenance/reset_hr_data_preserve_users.sql','supabase/verification/verify_employee_relations_security.sql',
  'js/core/access-control.js','docs/ACCESS-CONTROL-SETUP.md','docs/DATABASE-PORTABILITY.md','js/core/employee-relations.js','docs/EMPLOYEE-RELATIONS-REDESIGN-PHASE-A.md',
  'docs/EMPLOYEE-RELATIONS-PHASE-D.md','docs/EMPLOYEE-RELATIONS-PHASE-E.md','docs/EMPLOYEE-RELATIONS-PHASE-F.md','docs/EMPLOYEE-RELATIONS-PHASE-G.md','docs/EMPLOYEE-RELATIONS-PHASE-H.md','docs/EMPLOYEE-RELATIONS-PHASE-I.md','docs/EMPLOYEE-RELATIONS-PHASE-J.md'
];
const missing=required.filter(f=>!fs.existsSync(path.join(root,f)));
if(missing.length){
  console.error('Missing required files:', missing.join(', '));
  process.exit(1);
}
const actualMigrations=fs.readdirSync(path.join(root,'supabase','migrations')).filter(name=>name.endsWith('.sql')).sort();
if(JSON.stringify(actualMigrations)!==JSON.stringify(orderedMigrations)){
  console.error('Supabase migration history is missing, duplicated, or out of order.');
  process.exit(1);
}
if(actualMigrations.some(name=>!/^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name))){
  console.error('Supabase migrations must use the numeric CLI filename format.');
  process.exit(1);
}
const deployWorkflow=fs.readFileSync(path.join(root,'.github/workflows/supabase.yml'),'utf8');
for(const contract of ['supabase db push','baseline_existing_database','SUPABASE_MIGRATIONS_BASELINED','SUPABASE_ACCESS_TOKEN','SUPABASE_PROJECT_REF','SUPABASE_DB_PASSWORD']){
  if(!deployWorkflow.includes(contract)){
    console.error(`Supabase deployment workflow is incomplete: ${contract}`);
    process.exit(1);
  }
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const attr of ['href','src']){
  const re=new RegExp(`${attr}="([^"]+)"`,'g');
  let m;
  while((m=re.exec(html))){
    const ref=m[1];
    if(/^(https?:|#|data:)/.test(ref)) continue;
    const localRef=ref.split(/[?#]/,1)[0];
    if(!existsWithExactCase(path.join(root,localRef))){
      console.error(`Broken ${attr} reference: ${ref}`);
      process.exit(1);
    }
  }
}
const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
if(!app.includes('SUPABASE_PUBLISHABLE_KEY')){
  console.error('Publishable Supabase key reference is missing.');
  process.exit(1);
}
if(app.includes('SUPABASE_ANON_KEY')){
  console.error('Legacy SUPABASE_ANON_KEY reference found.');
  process.exit(1);
}
for(const feature of ['renderSelfService','renderTeamApprovals','submit_hr_service_request','review_hr_service_request']){
  const source=feature.endsWith('_request')?readMigration('phase10-self-service.sql'):app;
  if(!source.includes(feature)){
    console.error(`Self-service feature contract is missing: ${feature}`);
    process.exit(1);
  }
}
const lifecycleMigration=readMigration('phase11-lifecycle-checklists.sql');
for(const feature of ['renderLifecycleChecklists','saveLifecycleChecklistItem','lifecycleChecklistPendingCount']){
  if(!app.includes(feature)){
    console.error(`Lifecycle checklist feature contract is missing: ${feature}`);
    process.exit(1);
  }
}
if(!lifecycleMigration.includes('update_lifecycle_checklist_item')||!lifecycleMigration.includes("'lifecycleChecklists'")){
  console.error('Lifecycle checklist database contract is missing.');
  process.exit(1);
}
const preferencesMigration=readMigration('phase12-user-preferences.sql');
if(!preferencesMigration.includes('hr_user_preferences')){
  console.error('User preference migration is incomplete.');
  process.exit(1);
}
const selfServiceMigration=readMigration('phase10-self-service.sql');
if(!selfServiceMigration.includes("'homeAddress','presentAddress','presentAddressText'")){
  console.error('Self-service address migration is incomplete.');
  process.exit(1);
}
for(const feature of ['openEmployeeColumnManager','persistUserPreferences','DB.employees.push(rec)','PRF Number']){
  if(!app.includes(feature)){
    console.error(`Employee directory contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['employee-directory-row','employee-workspace-modal','employeeWorkspaceHeader','employeeWorkspaceNav','renderEmployeeOrigin','selectEmployeeDirectoryRow','EMP_FORM_SECTIONS','employeeFormSectionsHTML']){
  if(!app.includes(feature)){
    console.error(`Employee workspace interaction contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['recordHistory','createdByName','updatedByName','Record History','appendEmployeeRecordHistory']){
  if(!app.includes(feature)){
    console.error(`Employee audit history contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['employeeNameSimilarity','levenshteinDistance','Continue and save']){
  if(!app.includes(feature)){
    console.error(`Employee duplicate warning contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['EMPLOYEE_IMPORT_COLUMNS','downloadEmployeeImportTemplate','parseEmployeeImportWorksheet','validateEmployeeImportRow','commitEmployeeImport','Only a System Administrator can import employees','Employment History','Record History']){
  if(!app.includes(feature)){
    console.error(`Employee spreadsheet import/export contract is missing: ${feature}`);
    process.exit(1);
  }
}
if(!/header:'Remarks',key:'remarks'/.test(app) || !/key:'remarks', label:'Remarks', type:'textarea'/.test(app)){
  console.error('Employee import remarks must persist in the editable employee master record.');
  process.exit(1);
}
for(const feature of ['employeeBranchLocations','employeeAllowanceTypes','Branch Reporting','Daily Rate','Allowance Types (one per line)','employeeAllowanceFieldsHTML','employeeAllowanceTotal','Allowance - ${name}']){
  if(!app.includes(feature)){
    console.error(`Employee assignment or compensation contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['addressComponentHTML','readAddressComponent','emp_home','emp_present','homeAddress','presentAddress','initializeAddressComponents']){
  if(!app.includes(feature)){
    console.error(`Philippine address entry contract is missing: ${feature}`);
    process.exit(1);
  }
}
if(/Member Records|renderMembers|DB\.members/.test(app)){
  console.error('Address work must not introduce a Member Records module into this application.');
  process.exit(1);
}
if(!/header:'Branch Reporting',key:'branchReporting',required:true/.test(app) || !/key:'branchReporting', label:'Branch Reporting'[^\n]*required:true/.test(app)){
  console.error('Branch Reporting must be required for employee forms and imports.');
  process.exit(1);
}
if(!html.includes('js/vendor/xlsx.full.min.js?v=0.20.3')){
  console.error('Pinned local SheetJS browser build is missing.');
  process.exit(1);
}
if(!app.includes("trigger.innerHTML=iEdit(15)")){
  console.error('Consolidated table actions must use the pencil icon trigger.');
  process.exit(1);
}
const onboardingMigration=readMigration('phase13-onboarding.sql');
if(!onboardingMigration.includes("module <> 'onboardingCandidates'")){
  console.error('Onboarding access migration is incomplete.');
  process.exit(1);
}
const storageSettingsMigration=readMigration('phase14-admin-storage-settings.sql');
if(!storageSettingsMigration.includes("current_profile_role() = 'Administrator'")){
  console.error('Admin-only storage settings migration is incomplete.');
  process.exit(1);
}
const organizationMigration=readMigration('phase15-organization-structure.sql');
if(!organizationMigration.includes("current_profile_role() not in ('Administrator', 'HR Staff')") || !organizationMigration.includes("grant execute on function public.save_organization_structure")){
  console.error('Delegated Organization Structure migration is incomplete or unsafe.');
  process.exit(1);
}
const accessMigration=readMigration('phase20-access-control.sql');
if(!accessMigration.includes('get_effective_access') || !accessMigration.includes('current_user_has_permission')){
  console.error('Access Control migration is incomplete.');
  process.exit(1);
}
const employeeRelationsMigration=readMigration('phase23-employee-relations-case-foundation.sql');
if(!employeeRelationsMigration.includes('hr_case_allegations') || !employeeRelationsMigration.includes("current_user_has_permission('employee_relations.view')")){
  console.error('Employee Relations case-foundation migration is incomplete.');
  process.exit(1);
}
const dueProcessMigration=readMigration('phase24-employee-relations-due-process.sql');
if(!dueProcessMigration.includes('hr_case_responses') || !dueProcessMigration.includes('hr_case_hearings') || !dueProcessMigration.includes('hr_case_decisions') || !dueProcessMigration.includes("current_user_has_permission('employee_relations.approve')")){
  console.error('Employee Relations due-process migration is incomplete.');
  process.exit(1);
}
const disciplinaryHistoryMigration=readMigration('phase25-disciplinary-history.sql');
if(!disciplinaryHistoryMigration.includes('hr_disciplinary_history') || !disciplinaryHistoryMigration.includes('generate_case_disciplinary_history') || !disciplinaryHistoryMigration.includes("current_user_has_permission('employee_relations.view')")){
  console.error('Employee Relations disciplinary-history migration is incomplete.');
  process.exit(1);
}
const legacyMigration=readMigration('phase26-employee-relations-legacy-migration.sql');
if(!legacyMigration.includes('hr_case_correspondence') || !legacyMigration.includes('review_legacy_disciplinary_history') || !legacyMigration.includes('protect_legacy_disciplinary_history')){
  console.error('Employee Relations legacy migration is incomplete.');
  process.exit(1);
}
for(const migrationFile of [
  'phase23-employee-relations-case-foundation.sql',
  'phase24-employee-relations-due-process.sql',
  'phase25-disciplinary-history.sql',
  'phase26-employee-relations-legacy-migration.sql',
  'phase27-employee-relations-monitoring.sql',
  'phase28-employee-relations-validation.sql',
  'phase29-employee-relations-evidence.sql',
  'phase30-employee-relations-intake.sql',
  'phase31-employee-relations-revisions.sql',
]){
  const source=readMigration(migrationFile);
  if(!/^\s*begin;/i.test(source) || !/commit;\s*$/i.test(source)){
    console.error(`Employee Relations migration is not transaction-wrapped: ${migrationFile}`);
    process.exit(1);
  }
  if(/\btruncate\b/i.test(source) || /\bdrop\s+table\b/i.test(source) || /\bdelete\s+from\s+public\.hr_/i.test(source)){
    console.error(`Employee Relations migration contains a destructive data operation: ${migrationFile}`);
    process.exit(1);
  }
}
const validationMigration=readMigration('phase28-employee-relations-validation.sql');
for(const safeguard of ['validate_case_decision_notice_timeline','validate_case_response_timeline','validate_case_implementation_timeline']){
  if(!validationMigration.includes(safeguard)){
    console.error(`Employee Relations validation safeguard is missing: ${safeguard}`);
    process.exit(1);
  }
}
const evidenceMigration=readMigration('phase29-employee-relations-evidence.sql');
for(const safeguard of ['hr_case_evidence','protect_case_evidence_identity',"current_user_has_permission('employee_relations.view')",'current_user_scope_allows']){
  if(!evidenceMigration.includes(safeguard)){
    console.error(`Employee Relations evidence safeguard is missing: ${safeguard}`);
    process.exit(1);
  }
}
const intakeMigration=readMigration('phase30-employee-relations-intake.sql');
for(const safeguard of ['hr_case_intake','validate_case_intake_link',"source_module in ('incidents','cvr','intake')","current_user_has_permission('employee_relations.view')",'current_user_scope_allows']){
  if(!intakeMigration.includes(safeguard)){
    console.error(`Employee Relations intake safeguard is missing: ${safeguard}`);
    process.exit(1);
  }
}
const revisionMigration=readMigration('phase31-employee-relations-revisions.sql');
for(const safeguard of ['hr_case_revisions','controlled_case_revision','prevent_material_hr_case_delete','preserve_amended_history_occurrence',"current_user_has_permission('employee_relations.approve')",'replacement_decision_id']){
  if(!revisionMigration.includes(safeguard)){
    console.error(`Employee Relations controlled-revision safeguard is missing: ${safeguard}`);
    process.exit(1);
  }
}
for(const feature of ['renderCorrespondence','loadCaseCorrespondence','openLegacyDisciplinaryReview','saveLegacyDisciplinaryReview','exportLegacyDisciplinaryHistoryCSV']){
  if(!app.includes(feature)){
    console.error(`Employee Relations Phase E contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['CASE_WORKFLOW_STAGES','caseTransitionValidation','createCaseAllegationFromReport','openCaseAllegationForm','Report / allegation']){
  if(!app.includes(feature)){
    console.error(`Employee Relations case-domain contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['openCaseResponseForm','openCaseHearingForm','openCaseDecisionForm','saveCaseDecisionReview','finalizationStatus','Approve Decision']){
  if(!app.includes(feature)){
    console.error(`Employee Relations due-process contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['loadDisciplinaryHistory','qualifyingDisciplinaryHistory(DISCIPLINARY_HISTORY_CACHE','Verified History','Legacy Review','exportDisciplinaryHistoryCSV']){
  if(!app.includes(feature)){
    console.error(`Employee Relations disciplinary-history contract is missing: ${feature}`);
    process.exit(1);
  }
}
if(/module==='memos'\?'Memo Issued'/.test(app) || /\['incidents','cvr','disciplinary'\]/.test(app)){
  console.error('Legacy memo advancement or disciplinary-as-allegation behavior is still active.');
  process.exit(1);
}
for(const feature of ['renderUsers','openEffectiveAccess','save_user_access','requestPasswordRecovery','openAccountSecurity','ACCESS_MODULES']){
  if(!app.includes(feature)){
    console.error(`Access Control feature contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['catalog-add-button','saveCatalogQuickAdd','persistOrganizationStructure',"roles:['Administrator','HR Staff']"]){
  if(!app.includes(feature)){
    console.error(`Organization Structure access or inline catalog control is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['NAV_PANEL_SECTION','toggleNavGroup','positionNavGroupPanel','NAV_SECTION_ICONS','navgroup-head-main']){
  if(!app.includes(feature)){
    console.error(`Compact side navigation contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['fileStorageProvider','uploadGoogleDriveAttachment','googleDriveModuleFolder','requestGoogleDriveAccessToken','storageSettingsChanged','testGoogleDriveConnection','GOOGLE_DRIVE_PREFIX']){
  if(!app.includes(feature)){
    console.error(`Configurable attachment storage contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['managedUploadFilename','uploadDocumentType','informationNoteButton','openInformationNote']){
  if(!app.includes(feature)){
    console.error(`Managed document UI contract is missing: ${feature}`);
    process.exit(1);
  }
}
const driveSetupGuide=fs.readFileSync(path.join(root,'docs/GOOGLE-DRIVE-STORAGE-SETUP.md'),'utf8');
for(const requirement of ['Error 403: access_denied','Authorized JavaScript origins','Dela Cruz, Juan_0001_Production_nod.pdf']){
  if(!driveSetupGuide.includes(requirement)){
    console.error(`Google Drive setup guide is incomplete: ${requirement}`);
    process.exit(1);
  }
}
if(app.includes('PRF Number is already assigned to another employee.') || app.includes("blockers.push('PRF Number')") || /key:'prfNumber'[^}\n]*required:true/.test(app)){
  console.error('PRF numbers must remain optional and reusable across employees.');
  process.exit(1);
}
for(const feature of ['onboardingApplicantReference','warning:true',"classList.toggle('warning'"]){
  if(!app.includes(feature)){
    console.error(`Applicant identity or duplicate-warning contract is missing: ${feature}`);
    process.exit(1);
  }
}
for(const feature of ['departmentCatalog','positionCatalog','openDepartmentSetting','openPositionSetting','settings-tabs','dynamicOptions:\'departments\'']){
  if(!app.includes(feature)){
    console.error(`Configurable organization-structure contract is missing: ${feature}`);
    process.exit(1);
  }
}
if(/const\s+DEPT_OPTIONS\s*=/.test(app)){
  console.error('Departments must come from administrator-managed settings, not a fixed option list.');
  process.exit(1);
}
const resetSql=fs.readFileSync(path.join(root,'supabase/maintenance/reset_hr_data_preserve_users.sql'),'utf8');
if(!resetSql.includes('update public.profiles') || resetSql.includes('delete from public.profiles') || resetSql.includes('delete from auth.users')){
  console.error('User-preserving HR data reset script is missing or unsafe.');
  process.exit(1);
}
if(!resetSql.includes("where bucket_id = 'hr-documents'") || resetSql.includes('delete from storage.objects')){
  console.error('HR data reset must guard Storage cleanup without deleting storage metadata through SQL.');
  process.exit(1);
}
if(!resetSql.includes("to_regclass('public.' || target_table)") || !resetSql.includes("'{dataResetAt}'") || resetSql.includes('create temporary table')){
  console.error('HR data reset must tolerate optional migration tables and report reset results.');
  process.exit(1);
}
for(const safeguard of ['enforce_hr_record_reset_epoch','hr_records_reset_epoch','remaining_hr_records','remaining_legacy_states']){
  if(!resetSql.includes(safeguard)){
    console.error(`HR data reset stale-session safeguard is missing: ${safeguard}`);
    process.exit(1);
  }
}
if(!resetSql.includes('on conflict (tenant_id,id) do update')&&!resetSql.includes('on conflict (id) do update')){
  console.error('HR data reset stale-session safeguard is missing a settings upsert conflict target.');
  process.exit(1);
}
if(!app.includes('serverResetAt') || !app.includes('clientResetAt') || !app.includes('_dataResetAt:clientResetAt') || !app.includes('delete record._dataResetAt')){
  console.error('Database saves must reject stale browser state after an HR data reset.');
  process.exit(1);
}
if(!selfServiceMigration.includes("'_dataResetAt',coalesce((select data->>'dataResetAt'")){
  console.error('Self-service inserts must carry the current reset epoch.');
  process.exit(1);
}
if(!app.includes('let DB = blankDB();') || /DB\s*=\s*seedDB\(\)/.test(app)){
  console.error('The application must not restore demo data after an intentional database reset.');
  process.exit(1);
}
for(const feature of ['renderOnboarding','saveOnboardingCandidate','convertOnboardingCandidate','formatGovernmentId','onboardingCandidates']){
  if(!app.includes(feature)){
    console.error(`Onboarding feature contract is missing: ${feature}`);
    process.exit(1);
  }
}
const paginationState={tablePages:{},tablePageSizes:{}};
paginationState.tablePageSizes['qa:list']=25;
paginationState.tablePages['qa:list']={page:2,size:25,signature:'qa'};
const paginationMetaResult=paginationMeta(paginationState,'qa:list',37,10);
if(paginationMetaResult.size!==25||paginationMetaResult.page!==2||paginationMetaResult.start!==26||paginationMetaResult.end!==37){
  console.error('Pagination state calculation failed.');
  process.exit(1);
}
const paginationMarkup=paginationHTML(paginationMetaResult,'qa:list',{go:'qaPageGo',size:'qaPageSize'});
if(!paginationMarkup.includes('requestAnimationFrame(()=>qaPageSize')||!paginationMarkup.includes('requestAnimationFrame(()=>qaPageGo')){
  console.error('Pagination controls must defer rerendering until their UI event completes.');
  process.exit(1);
}
const tableEnhancer=fs.readFileSync(path.join(root,'js/core/table-enhancer.js'),'utf8');
if(!tableEnhancer.includes('dataset.paginationState')){
  console.error('Pagination footer stability guard is missing.');
  process.exit(1);
}
for(const feature of ['employeePickerHTML','employeePickerChoose','employeePickerKeydown','search-pending']){
  if(!app.includes(feature)){
    console.error(`Search interaction contract is missing: ${feature}`);
    process.exit(1);
  }
}
if(/<select[^>]+id=["'`](?:u_employee|gd_employee|case_employee|lc_employee|f_employeeName)["'`]/.test(app)){
  console.error('An employee entry field has regressed to a dropdown.');
  process.exit(1);
}
const professionalCss=fs.readFileSync(path.join(root,'css/professional.css'),'utf8');
if(!professionalCss.includes('.navgroup-head-main')||!professionalCss.includes('.navgroup-popover')||!professionalCss.includes('@keyframes nav-sheet-in')){
  console.error('Compact side navigation styling is missing.');
  process.exit(1);
}
if(!professionalCss.includes('.employee-picker-options')||!professionalCss.includes('max-height:calc(100dvh - 190px)')||!professionalCss.includes('.employee-workspace-modal')){
  console.error('Employee picker or sticky table styling is missing.');
  process.exit(1);
}
if(!app.includes('employee-directory-workspace')||!professionalCss.includes('#content.employee-directory-content')){
  console.error('The viewport-bound employee data workspace is missing.');
  process.exit(1);
}
console.log('SLSC HR Platform structural validation passed.');
