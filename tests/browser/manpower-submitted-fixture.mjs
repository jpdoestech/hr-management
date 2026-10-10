// Local-only fixture with synthetic records. No credentials or real database calls.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(resolve(root,'js/app.js'),'utf8');
const handlers=source.slice(source.indexOf('const MANPOWER_SUBMITTED_UI='),source.indexOf('function openManpowerRequestForm('));
const names=[...handlers.matchAll(/(?:async )?function (\w+)\(/g)].map(match=>match[1]);
const html=String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Submitted request fixture</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"></head><body>
<main style="height:100dvh;overflow:auto;padding:16px"><h2 id="fixture_title">Submitted Requests</h2><div id="content"></div><div id="fixture_status" role="status"></div></main><script type="module">
import {loadSubmittedRequests,loadSubmittedRequest,loadSubmittedRows,submittedListRowsHTML,submittedHeaderHTML,submittedTableHTML} from '/js/manpower/submitted-workspace.js';
import {paginationMeta,paginationHTML} from '/js/core/pagination.js';
import {quantityAmendmentPayload,quantityAmendmentHTML,quantityAmendmentError} from '/js/manpower/quantity-editor.js';
import {LIFECYCLE_LABELS,lifecycleOperations,lifecycleActionsHTML,lifecyclePayload,lifecycleEditorHTML,lifecycleResultValid,lifecycleError} from '/js/manpower/lifecycle-editor.js';
import {HEADER_AMENDMENT_FIELDS,readHeaderAmendment,headerAmendmentPayload,headerEditorHTML,headerAmendmentResultValid,headerAmendmentError} from '/js/manpower/header-editor.js';
import {loadLineCapacity,lineCapacityHTML,capacityErrorHTML} from '/js/manpower/capacity-summary.js';
import {loadLineWorkers,workerTableHTML,workerFiltersHTML} from '/js/manpower/worker-monitoring.js';
const SESSION={id:'fixture-user'};const STATE={view:'manpowerSubmitted'};const hasPermission=()=>true;
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const iSearch=()=>'';const iInfo=()=>'<span aria-hidden="true">i</span>';
const fmtDate=value=>value||'Not recorded';const employeeBranchLocations=()=>['Davao','Manila'];
const uniqueSettingNames=values=>[...new Set(values.filter(Boolean))];
const setTitle=value=>document.getElementById('fixture_title').textContent=value;
const requestPageNavigation=async()=>true;
let PAGE_EDIT_STATE=null,PENDING_PAGE_NAVIGATION=null;
const serializeEditor=()=>'';
const toast=message=>document.getElementById('fixture_status').textContent=message;
let confirmationChoice='confirm';
const confirmDataChange=async()=>confirmationChoice;
const openModal=()=>document.getElementById('fixture_status').textContent='Information requested (local fixture).';
const requests=Array.from({length:31},(_,index)=>({id:'request'+index,prf_number:'PRF '+String(index+1).padStart(4,'0'),branch_reporting:index%2?'Manila':'Davao',date_requested:'2026-10-09',target_date:'2026-10-20',updated_at:'2026-10-10',state:'Open',requested_by:'Fixture HR',priority:'Normal',revision:2,submitted_at:'2026-10-10',remarks:'Synthetic requisition, not a real employee record.',hr_manpower_clients:{name:'Fixture Client'}}));
const lines=Array.from({length:31},(_,index)=>({id:'line'+index,request_id:'request0',ordinal:index,department:'Production',position:'Operator',original_requested:1000,current_authorized:1000,cancelled_unfilled:0,demand_type:index%2?'Replacement':'Expansion',site:'Davao',purpose:'Synthetic line detail '+(index+1)}));
const history=lines.map(line=>({...line,line_id:line.id,event_type:'Submitted',request_revision:2,hr_manpower_lines:{request_id:line.request_id,ordinal:line.ordinal,department:line.department,position:line.position}}));
const amendments=history.map((row,index)=>({...row,previous_authorized:1000,current_authorized:1025,request_revision:index+3,reason:'Additional client demand. '+('Synthetic reason with sufficient detail for responsive wrapping. '.repeat(5))}));
requests[0].state='Closed';requests[1].state='Cancelled';
if(location.search.includes('quantity')||location.search.includes('lifecycle-open')||location.search.includes('header'))requests[0].state='Open';
requests.forEach(request=>{request.client_id='synthetic-client';request.submitted_by='fixture-user';});
const headerAmendments=[];
const lifecycle=Array.from({length:31},(_,index)=>({request_id:'request0',request_revision:index+3,
  operation:index%2?'Reopen':'Close',previous_state:index%2?'Closed':'Open',current_state:index%2?'Open':'Closed',
  reason:'Synthetic lifecycle reason '+(index+1)+'. '+('Historical fulfillment is preserved. '.repeat(8))}));
const supabase={rpc:async(name,payload)=>{
  if(name==='manpower_line_workers'){
    if(location.search.includes('missing-workers'))return {error:{code:'PGRST202'}};
    const rows=Array.from({length:31},(_,index)=>({id:'synthetic-reservation-'+index,candidate_id:'synthetic-applicant-'+index,name:'SYNTHETIC, Worker '+String(index).padStart(2,'0'),hiring_category:'New Hire',state:index%2?'Scheduled':'Reserved',created_at:'2026-10-01T00:00:00Z',scheduled_date:index%2?'2026-10-20':null})).filter(row=>(!payload.p_state||row.state===payload.p_state)&&(!payload.p_search||row.name.toLowerCase().includes(payload.p_search.toLowerCase())));
    return {data:{data:rows.slice((payload.p_page-1)*payload.p_size,payload.p_page*payload.p_size),count:rows.length}};
  }
  if(name==='manpower_line_capacity'){
    if(location.search.includes('missing-capacity'))return {error:{code:'PGRST202'}};
    const line=lines.find(row=>row.id===payload.p_line);
    if(!line)return {error:{code:'42501'}};
    return {data:{original_requested:line.original_requested,current_authorized:line.current_authorized,cancelled_unfilled:line.cancelled_unfilled,effective_capacity:line.current_authorized-line.cancelled_unfilled,reserved:3,scheduled:1,fulfilled:2,active_deployed:1,available:line.current_authorized-line.cancelled_unfilled-5}};
  }
  if(name==='amend_manpower_header'){
    if(location.search.includes('missing-header-rpc'))return {error:{code:'PGRST202'}};
    if(location.search.includes('duplicate-header'))return {error:{code:'23505'}};
    const request=requests.find(row=>row.id===payload.p_id);
    if(!request||request.revision!==payload.p_expected_revision)return {error:{code:'40001'}};
    const before=Object.fromEntries(Object.keys(HEADER_AMENDMENT_FIELDS).map(key=>[key,request[key]]));
    Object.assign(request,payload.p_header);request.revision++;
    headerAmendments.unshift({request_id:request.id,request_revision:request.revision,before_header:before,after_header:Object.fromEntries(Object.keys(HEADER_AMENDMENT_FIELDS).map(key=>[key,request[key]])),reason:payload.p_reason});
    return {data:{request:{...request}}};
  }
  if(name==='change_manpower_lifecycle'){
    if(location.search.includes('missing-lifecycle-rpc'))return {error:{code:'PGRST202'}};
    if(location.search.includes('reservation-block'))return {error:{code:'23514',message:'Release or reassign all reservations on affected lines before cancellation or closure.'}};
    const request=requests.find(row=>row.id===payload.p_id);
    if(!request||request.revision!==payload.p_expected_revision)return {error:{code:'40001'}};
    const previous=request.state,changes=[];
    if(payload.p_operation!=='Reopen')for(const line of lines.filter(row=>row.request_id===request.id&&(payload.p_operation!=='CancelLine'||row.id===payload.p_line_id))){
      const delta=payload.p_operation==='CancelLine'?payload.p_cancel_quantity:line.current_authorized-line.cancelled_unfilled;
      if(!delta)continue;
      const before=line.cancelled_unfilled;line.cancelled_unfilled+=delta;
      changes.push({line_id:line.id,previous_cancelled:before,current_cancelled:line.cancelled_unfilled,current_authorized:line.current_authorized,original_requested:line.original_requested});
    }
    request.state={Close:'Closed',Cancel:'Cancelled',Reopen:'Open',CancelLine:'Open'}[payload.p_operation];request.revision++;
    lifecycle.unshift({request_id:request.id,request_revision:request.revision,operation:payload.p_operation,previous_state:previous,current_state:request.state,reason:payload.p_reason});
    return {data:{request:{...request},line_changes:changes}};
  }
  if(name!=='amend_manpower_quantity')return {error:{code:'PGRST202'}};
  if(location.search.includes('missing-amendment-rpc'))return {error:{code:'PGRST202'}};
  if(location.search.includes('capacity-block'))return {error:{code:'23514',message:'Quantity would undercut reserved or fulfilled commitments. Release or reassign reservations first.'}};
  const request=requests.find(row=>row.id===payload.p_id),line=lines.find(row=>row.id===payload.p_line_id);
  if(!request||request.revision!==payload.p_expected_revision)return {error:{code:'40001'}};
  const previous=line.current_authorized;line.current_authorized=payload.p_quantity;request.revision++;
  amendments.unshift({...line,line_id:line.id,previous_authorized:previous,request_revision:request.revision,reason:payload.p_reason,hr_manpower_lines:{request_id:request.id,ordinal:line.ordinal,department:line.department,position:line.position}});
  return {data:{request:{...request},line:{...line}}};
},from(table){let predicates=[],sorts=[],first=0,last=9,single=false;
  const query={select(){return query;},in(key,values){predicates.push(row=>values.includes(row[key]));return query;},eq(key,value){predicates.push(row=>(key==='hr_manpower_lines.request_id'?row.hr_manpower_lines?.request_id:row[key])===value);return query;},order(key,options={}){sorts.push([key,options.ascending!==false]);return query;},range(start,end){first=start;last=end;return query;},single(){single=true;return query;},ilike(key,pattern){const text=pattern.slice(1,-1).replace(/\\([\\%_])/g,'$1').toLowerCase();predicates.push(row=>String(row[key]).toLowerCase().includes(text));return query;},then(resolve){
    if(table==='hr_manpower_quantity_history'&&location.search.includes('missing-history'))return Promise.resolve(resolve({error:{code:'42P01',message:'Missing history'}}));
    if(table==='hr_manpower_quantity_amendments'&&location.search.includes('missing-amendments'))return Promise.resolve(resolve({error:{code:'42P01',message:'Missing amendments'}}));
    if(table==='hr_manpower_lifecycle_history'&&location.search.includes('missing-lifecycle'))return Promise.resolve(resolve({error:{code:'42P01',message:'Missing lifecycle'}}));
    if(table==='hr_manpower_header_amendments'&&location.search.includes('missing-header-history'))return Promise.resolve(resolve({error:{code:'42P01',message:'Missing header history'}}));
    const rows=(table==='hr_manpower_requests'?requests:table==='hr_manpower_lines'?lines:table==='hr_manpower_quantity_amendments'?amendments:table==='hr_manpower_lifecycle_history'?lifecycle:table==='hr_manpower_header_amendments'?headerAmendments:history).filter(row=>predicates.every(predicate=>predicate(row))).sort((a,b)=>{for(const [key,ascending] of sorts){if(a[key]!==b[key])return (a[key]>b[key]?1:-1)*(ascending?1:-1);}return 0;});
    return Promise.resolve(resolve(single?{data:rows[0],error:rows.length?null:{message:'Request unavailable'}}:{data:rows.slice(first,last+1),count:rows.length}));
  }};return query;
}};
let searchTimer;
function queueSearchRender(input,key,render){STATE[key]=input.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{STATE.tablePages={};render();},460);}
${handlers}
async function go(view){STATE.view=view;if(view==='manpowerSubmitted')await renderManpowerSubmitted();else if(view==='manpowerSubmittedDetails')await renderManpowerSubmittedDetails();else document.getElementById('fixture_status').textContent='Navigation: '+view;}
Object.assign(window,{STATE,${names.join(',')},go,queueSearchRender});
await renderManpowerSubmitted();
</script></body></html>`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Fixture stopped.');server.close();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!/^\/(js|css)\//.test(path)){res.writeHead(404);res.end();return;}
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!['js','css'].some(folder=>file.startsWith(resolve(root,folder)+sep))){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4182,'127.0.0.1',()=>console.log('Local-only submitted fixture: http://127.0.0.1:4182/ (stop via /shutdown).'));
