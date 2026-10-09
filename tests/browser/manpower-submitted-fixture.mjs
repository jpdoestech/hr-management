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
const SESSION={id:'fixture-user'};const STATE={view:'manpowerSubmitted'};const hasPermission=()=>true;
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const iSearch=()=>'';const iInfo=()=>'<span aria-hidden="true">i</span>';
const fmtDate=value=>value||'Not recorded';const employeeBranchLocations=()=>['Davao','Manila'];
const uniqueSettingNames=values=>[...new Set(values.filter(Boolean))];
const setTitle=value=>document.getElementById('fixture_title').textContent=value;
const requestPageNavigation=async()=>true;
const openModal=()=>document.getElementById('fixture_status').textContent='Information requested (local fixture).';
const requests=Array.from({length:31},(_,index)=>({id:'request'+index,prf_number:'PRF '+String(index+1).padStart(4,'0'),branch_reporting:index%2?'Manila':'Davao',date_requested:'2026-10-09',target_date:'2026-10-20',updated_at:'2026-10-10',state:'Open',requested_by:'Fixture HR',priority:'Normal',revision:2,submitted_at:'2026-10-10',remarks:'Synthetic requisition, not a real employee record.',hr_manpower_clients:{name:'Fixture Client'}}));
const lines=Array.from({length:31},(_,index)=>({id:'line'+index,request_id:'request0',ordinal:index,department:'Production',position:'Operator',original_requested:1000,current_authorized:1000,cancelled_unfilled:0,demand_type:index%2?'Replacement':'Expansion',site:'Davao',purpose:'Synthetic line detail '+(index+1)}));
const history=lines.map(line=>({...line,line_id:line.id,event_type:'Submitted',request_revision:2,hr_manpower_lines:{request_id:line.request_id,ordinal:line.ordinal,department:line.department,position:line.position}}));
const supabase={from(table){let predicates=[],sorts=[],first=0,last=9,single=false;
  const query={select(){return query;},eq(key,value){predicates.push(row=>(key==='hr_manpower_lines.request_id'?row.hr_manpower_lines?.request_id:row[key])===value);return query;},order(key,options={}){sorts.push([key,options.ascending!==false]);return query;},range(start,end){first=start;last=end;return query;},single(){single=true;return query;},ilike(key,pattern){const text=pattern.slice(1,-1).replace(/\\([\\%_])/g,'$1').toLowerCase();predicates.push(row=>String(row[key]).toLowerCase().includes(text));return query;},then(resolve){
    if(table==='hr_manpower_quantity_history'&&location.search.includes('missing-history'))return Promise.resolve(resolve({error:{code:'42P01',message:'Missing history'}}));
    const rows=(table==='hr_manpower_requests'?requests:table==='hr_manpower_lines'?lines:history).filter(row=>predicates.every(predicate=>predicate(row))).sort((a,b)=>{for(const [key,ascending] of sorts){if(a[key]!==b[key])return (a[key]>b[key]?1:-1)*(ascending?1:-1);}return 0;});
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
