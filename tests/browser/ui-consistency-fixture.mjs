// Real record renderers with synthetic data. No authentication or database calls.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(resolve(root,'js/app.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const shell=readFileSync(resolve(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('class="session-pending"','');
const icons=[...source.matchAll(/^function i[A-Z]\w*\(s\)\{.*$/gm)].map(match=>match[0]).join('\n');
const script=String.raw`<script type="module">
import {paginateRows,paginationHTML} from '/js/core/pagination.js';
import {installTableEnhancer} from '/js/core/table-enhancer.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const STATE={view:'employees',employeeSearch:'',tablePages:{},tablePageSizes:{}};
const params=new URLSearchParams(location.search);STATE.employeeFiltersExpanded=params.has('filters');
const SESSION={role:params.has('admin')?'Administrator':'Viewer'},EMPLOYMENT_TYPES=['Probationary'],REVIEW_TYPE='Needs HR Review';
const fixtureRowCount=params.get('rows')==='10000'?10000:250;
const DB={employees:Array.from({length:fixtureRowCount},(_,i)=>({id:'synthetic-'+i,employeeNo:'EMP-'+String(i+1).padStart(6,'0'),name:'SYNTHETIC, Employee '+String(i+1).padStart(3,'0'),department:i%2?'Operations':'Administration',branchReporting:'Synthetic Branch',position:'Synthetic Position',status:'Active'})),leaves:[{employeeName:'Synthetic Employee',department:'Operations',startDate:'2026-10-01',endDate:'2026-10-02',leaveType:'Vacation',status:'Approved'}]};
DB.employees[0].name='SYNTHETIC-LONG-FAMILY-NAME, Sample Employee With A Long Given Name';
const EMPLOYEE_DIRECTORY_PAGE_CACHE=new Map();
const canEdit=()=>params.has('admin'),canExport=()=>false,employeeDisplayName=e=>e.name;
const columns=[['employeeNo','Employee No.',120],['name','Name',220],['department','Department',160],['position','Position',180],['branchReporting','Branch',160],['status','Status',110]].map(([key,label,width])=>({key,label,width,cell:e=>key==='employeeNo'?'<span class="mono">'+esc(e[key])+'</span>':key==='status'?'<span class="badge b-green">'+esc(e[key])+'</span>':esc(e[key])}));
const employeeDirectoryQueryState=()=>({columns,pageScope:'employees'}),employeeDirectorySignature=()=> 'synthetic';
let employeeDirectoryMetadata=()=>({departments:['Operations','Administration'],branches:['Synthetic Branch'],statuses:['Active']});
if(params.has('long')){
  STATE.employeeDepartmentFilter='Synthetic Department With A Deliberately Long Name For Readability';
  const basicMetadata=employeeDirectoryMetadata();
  basicMetadata.departments.push(STATE.employeeDepartmentFilter);
  employeeDirectoryMetadata=()=>basicMetadata;
}
const localEmployeeDirectoryRows=()=>DB.employees.filter(e=>(!STATE.employeeSearch||e.name.toLowerCase().includes(STATE.employeeSearch.toLowerCase()))&&(!STATE.employeeDepartmentFilter||params.has('long')||e.department===STATE.employeeDepartmentFilter));
const refreshEmployeeDirectoryPage=()=>{},employeeDirectoryStatus=()=>{},LEAVE_STATUS=['Approved','Pending'];
const fmtDate=v=>v,daysBetweenInclusive=()=>2,attachCellHTML=()=> '—',statusBadge=value=>'<span class="badge b-green">'+esc(value)+'</span>',LEAVE_STATUS_MAP={};
const setTitle=(title,sub)=>{document.getElementById('tb-title').textContent=title;document.getElementById('tb-sub').textContent=sub;};
${icons}
${section('const FILTER_SELECTORS=','let ROW_ACTION_MENU_ID=')}
const SEARCH_RENDER_TIMERS=new Map();
${section('function queueSearchRender(','/* ---------------- searchable employee picker')}
${section('function employeeSearchInput(','const EMPLOYEE_COLUMN_DEFS = [')}
${section('function employeeDirectoryRowsHTML(','function applyEmployeeDirectoryPage(')}
${section('function renderEmployees(){','function openEmployeeWorkspaceModal(')}
${section('function renderLeaveRecords(','function renderLeaveSummary(')}
function serverTablePageGo(key,page){STATE.tablePages[key]={...STATE.tablePages[key],page};renderEmployees();}
function serverTablePageSize(key,size){STATE.tablePageSizes[key]=Number(size);STATE.tablePages[key]={page:1,size:Number(size)};renderEmployees();}
const content=document.getElementById('content');
const view=new URLSearchParams(location.search).get('view')||'employees';
document.getElementById('auth-screen').style.display='none';document.getElementById('app').style.display='grid';document.getElementById('session-splash')?.remove();
document.getElementById('notification-bell-icon').innerHTML=iBell(18);document.getElementById('tb-name').textContent='Sample HR';document.getElementById('tb-role').textContent=SESSION.role;document.getElementById('tb-av').textContent='SH';
document.getElementById('nav').innerHTML='<button class="navitem active">'+iUsers(18)+' Employees</button>';
content.classList.add('data-focused-content');
function tableGallery(){
  STATE.view='table-gallery';content.className='data-focused-content';setTitle('Table consistency','Synthetic records only');
  const variants=['data-table','data-table settings-table','data-table access-users-table','data-table legacy-review-table','data-table onboarding-table','data-table manpower-slot-table','data-table tda-table','analytics-table','dashboard-mini-table','permission-matrix','permission-overrides'];
  content.innerHTML=variants.map((type,index)=>'<section class="panel"><h3>'+type+'</h3><div class="tablewrap"><table class="'+type+'" data-table-key="gallery-'+index+'"><thead><tr><th>Reference</th><th>Description</th><th>Status</th></tr></thead><tbody><tr><td>SAMPLE-001</td><td>Synthetic record</td><td>'+(type==='permission-matrix'?'<input type="checkbox" aria-label="Synthetic permission">':'Active')+'</td></tr><tr><td>SAMPLE-002</td><td>'+('Long synthetic explanation '.repeat(12))+'</td><td>Pending</td></tr></tbody></table></div></section>').join('');
  content.insertAdjacentHTML('beforeend','<section class="panel"><h3>Editable table</h3><div class="tablewrap"><table class="data-table"><thead><tr><th>Day</th><th>Worked basis points</th><th>Unworked basis points</th></tr></thead><tbody><tr><td>Regular day</td><td><input type="number" aria-label="Worked basis points" value="10000"></td><td><input type="number" aria-label="Unworked basis points" value="0"></td></tr></tbody></table></div></section>');
}
function portalTable(){
  STATE.view='portal';content.className='data-focused-content';setTitle('My requests','Synthetic request layout');
  const headers=['Request','Details','Submitted','Status','Reviewer remarks','Actions'];
  const values=['Certificate request','Synthetic request with a deliberately long explanation '.repeat(4),'Oct 29, 2026','Pending','Not recorded','<div class="rowactions"><button class="btn btn-ghost btn-sm">Cancel request</button></div>'];
  content.innerHTML='<section class="portal-history"><div class="tablewrap"><table class="data-table portal-request-table"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody><tr>'+values.map((value,index)=>'<td data-label="'+headers[index]+'">'+value+'</td>').join('')+'</tr></tbody></table></div></section>';
}
if(view==='portal')portalTable();else if(view==='tables')tableGallery();else if(view==='leaves'){STATE.view='leaves';STATE.search='';setTitle('Leave Tracker','Synthetic records');content.innerHTML='<div id="leave-sub"></div>';renderLeaveRecords();}else renderEmployees();
const tableEnhancer=installTableEnhancer({getState:()=>STATE,getContent:()=>content});tableEnhancer.enhanceDataTables();
Object.assign(window,{STATE,employeeSearchInput,toggleEmployeeDirectoryFilters,resetEmployeeDirectoryFilters,renderEmployees,renderLeaveRecords,queueSearchRender,cancelSearchRender,serverTablePageGo,serverTablePageSize});
// These assertions use the final cascade, rather than searching CSS source text.
await document.fonts.ready;
enhanceFilterVisibility();
const failures=[];const check=(ok,message)=>{if(!ok)failures.push(message);};
const mobile=innerWidth<=720,table=content.querySelector('.data-table'),cell=table.querySelector('tbody td');
check(document.documentElement.scrollWidth<=innerWidth,'Document must not scroll horizontally');
check(parseFloat(getComputedStyle(cell).fontSize)>=13,'Record text must remain readable');
if(view==='portal'&&mobile){
  check(getComputedStyle(table).display==='block','Mobile requests retain cards');
  check(parseFloat(getComputedStyle(cell).fontSize)===13,'Request cards retain readable record text');
  check(content.querySelector('.rowactions .btn').getBoundingClientRect().height>=44,'Request actions retain touch targets');
}
if(view==='tables'){
  content.querySelectorAll('table').forEach(table=>{
    const row=table.tBodies[0].rows[0],td=row.cells[0],th=table.tHead.rows[0].cells[0],host=table.closest('.tablewrap');
    check(getComputedStyle(td).fontSize==='13px','Uniform record font: '+table.className);
    check(getComputedStyle(th).fontSize==='12px','Uniform header font: '+table.className);
    check(parseFloat(getComputedStyle(td).paddingTop)===6,'Uniform cell spacing: '+table.className);
    check(host.getBoundingClientRect().right<=innerWidth+1,'Contained table scroller: '+table.className);
    if(innerWidth>=1920)check(table.getBoundingClientRect().width<host.clientWidth-100,'Columns must not stretch: '+table.className);
    check(getComputedStyle(th).position==='sticky','Sticky column headers: '+table.className);
    const checkbox=table.querySelector('input[type="checkbox"]');if(checkbox)check(checkbox.getBoundingClientRect().width===(mobile?44:24),'Permission targets follow the selection token');
    const longCell=table.tBodies[0].rows[1]?.cells[1];
    if(longCell)check(longCell.scrollWidth<=longCell.clientWidth+1,'Long text wraps within its cell: '+table.className);
  });
}
if(view==='employees'){
  check(table.tBodies[0].rows.length===25,'Employee page must stay bounded to 25 rows');
  check(getComputedStyle(table).tableLayout==='auto','Employee columns must size to their contents');
  check(!table.querySelector('col[style*="width"]'),'Employee columns must not have fixed widths');
  const nameCell=table.querySelector('tbody [data-column="name"]');
  check(nameCell.scrollWidth<=nameCell.clientWidth+1,'Full employee names must fit their column');
  check(getComputedStyle(content.querySelector('.employee-directory-search svg')).opacity==='1','Employee search icon must remain visible');
  const rowHeight=table.tBodies[0].rows[0].getBoundingClientRect().height;
  check(rowHeight<=(mobile?60:42),'Employee rows must remain compact');
  check(parseFloat(getComputedStyle(document.getElementById('employee-directory-search')).fontSize)>=(mobile?16:13),'Search size must follow its breakpoint');
  check(document.querySelector('.table-pagination-wrap').getBoundingClientRect().bottom<=innerHeight+1,'Pagination must fit the viewport');
  if(innerWidth>900)check(Math.abs(document.querySelector('#sidebar .brand').getBoundingClientRect().bottom-document.getElementById('topbar').getBoundingClientRect().bottom)<1,'Logo and header dividers must align');
  if(innerWidth>720&&!params.has('long')){
    const toolbar=content.querySelector('.employee-directory-toolbar').getBoundingClientRect();
    const search=content.querySelector('.employee-directory-search').getBoundingClientRect();
    const actions=content.querySelector('.employee-toolbar-actions').getBoundingClientRect();
    check(toolbar.height<=64,'Desktop employee toolbar must stay one compact row');
    check(search.width<=480.5,'Desktop searches must not stretch on wide screens');
    check(Math.abs(search.y-actions.y)<1,'Search and actions must align on desktop');
    if(innerWidth>=1500){
      const filters=[...content.querySelectorAll('.employee-filter-set select')].map(e=>e.getBoundingClientRect());
      check(filters.every(rect=>Math.abs(rect.width-filters[0].width)<1&&Math.abs(rect.y-search.y)<1),'Wide desktop filters must have equal widths in one row');
    }else check(getComputedStyle(content.querySelector('.employee-filter-toggle')).display!=='none','Laptop filters must have a compact disclosure');
  }
  content.querySelectorAll('.employee-filter-set select').forEach(select=>{
    if(!select.getClientRects().length)return;
    const style=getComputedStyle(select),context=document.createElement('canvas').getContext('2d');context.font=style.font;
    const value=select.selectedOptions[0].textContent.trim();
    const fits=context.measureText(value).width<=select.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-20;
    check(fits||select.parentElement.querySelector('.filter-value-summary')?.textContent.includes(value),'Filter text must fit or be displayed in full');
  });
}
const result=document.createElement('output');result.id='fixture-checks';result.hidden=true;result.textContent=failures.length?'FAIL: '+failures.join('; '):'PASS: computed styles, density, pagination, responsive bounds and header alignment';document.body.appendChild(result);
console.assert(!failures.length,failures.join('; '));
</script>`;
new Script('(async()=>{'+script.slice(script.indexOf('>')+1,script.lastIndexOf('</script>')).replace(/^import .*$/gm,'')+'})()');
const html=shell.replace('</body>',script+'</body>');
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Stopped');server.close();server.closeAllConnections();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!['css','assets','js/core'].some(dir=>file.startsWith(resolve(root,dir)+sep))){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4194,'127.0.0.1',()=>console.log('Synthetic UI consistency: http://127.0.0.1:4194/'));
