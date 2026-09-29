import fs from 'node:fs';
import path from 'node:path';
import {paginationHTML,paginationMeta} from '../js/core/pagination.js';

const root=process.cwd();
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
  'index.html','css/app.css','css/professional.css','js/app.js',
  'js/core/pagination.js','js/core/table-enhancer.js','js/core/content-layout.js','supabase-config.js',
  'supabase/phase10-self-service.sql','supabase/phase11-lifecycle-checklists.sql',
  'database/migrations/phase11-lifecycle-checklists.sql','supabase/phase12-user-preferences.sql',
  'database/migrations/phase12-user-preferences.sql'
];
const missing=required.filter(f=>!fs.existsSync(path.join(root,f)));
if(missing.length){
  console.error('Missing required files:', missing.join(', '));
  process.exit(1);
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
  const source=feature.endsWith('_request')?fs.readFileSync(path.join(root,'supabase/phase10-self-service.sql'),'utf8'):app;
  if(!source.includes(feature)){
    console.error(`Self-service feature contract is missing: ${feature}`);
    process.exit(1);
  }
}
const lifecycleMigration=fs.readFileSync(path.join(root,'supabase/phase11-lifecycle-checklists.sql'),'utf8');
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
const lifecycleMigrationCopy=fs.readFileSync(path.join(root,'database/migrations/phase11-lifecycle-checklists.sql'),'utf8');
if(lifecycleMigration!==lifecycleMigrationCopy){
  console.error('Lifecycle checklist migration copies are out of sync.');
  process.exit(1);
}
const preferencesMigration=fs.readFileSync(path.join(root,'supabase/phase12-user-preferences.sql'),'utf8');
const preferencesMigrationCopy=fs.readFileSync(path.join(root,'database/migrations/phase12-user-preferences.sql'),'utf8');
if(preferencesMigration!==preferencesMigrationCopy || !preferencesMigration.includes('hr_user_preferences')){
  console.error('User preference migration copies are missing or out of sync.');
  process.exit(1);
}
for(const feature of ['openEmployeeColumnManager','persistUserPreferences','DB.employees.push(rec)','PRF Number']){
  if(!app.includes(feature)){
    console.error(`Employee directory contract is missing: ${feature}`);
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
if(!professionalCss.includes('.employee-picker-options')||!professionalCss.includes('max-height:calc(100dvh - 190px)')){
  console.error('Employee picker or sticky table styling is missing.');
  process.exit(1);
}
if(!app.includes('employee-directory-workspace')||!professionalCss.includes('#content.employee-directory-content')){
  console.error('The viewport-bound employee data workspace is missing.');
  process.exit(1);
}
console.log('SLSC HR Platform structural validation passed.');
