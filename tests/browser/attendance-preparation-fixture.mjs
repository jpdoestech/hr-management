// Actual vanilla UI module with synthetic RPC responses. No real HR data or external requests.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic attendance preparation</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"><link rel="stylesheet" href="/css/attendance.css"></head><body><main id="content"></main><p id="fixture-notice" role="status"></p><div id="overlay" class="overlay"><div id="modal" class="modal"></div></div><script type="module">
import {createAttendancePreparation} from '/js/core/attendance-preparation.js';
import {cutoffDates} from '/js/core/attendance-matrix.js';
const client='00000000-0000-0000-0000-000000000021',actor={id:'00000000-0000-0000-0000-000000000011',tenantId:'00000000-0000-0000-0000-000000000001',isSuperAdmin:true};
const cutoff={id:'synthetic-cutoff',data:{start:'2024-01-01',end:'2024-01-10',branch:'Synthetic Branch',clientId:client}};
const records=new Map(),duties=[{start:480,end:720,breakMinutes:0},{start:780,end:1020,breakMinutes:0}];
let version=0,mode='present';
const supabase={rpc:async(name,args)=>{
 if(name==='attendance_preparation_options')return {data:{clients:[{id:client,name:'Synthetic Client'}]}};
 if(name==='query_attendance_matrix'){
  let rows=[{id:'synthetic-a',name:'SYNTHETIC, ALPHA',employeeNo:'EMP-000001'},{id:'synthetic-b',name:'SYNTHETIC, BETA',employeeNo:'EMP-000002'}].filter(r=>String(args.p_search||'').toLowerCase().replaceAll(',',' ').split(/\\s+/).every(word=>r.name.toLowerCase().includes(word)));
  rows=rows.map(row=>({...row,days:Object.fromEntries(cutoffDates(args.p_cutoff.start,args.p_cutoff.end).map(date=>{const key=row.id+':'+date,saved=records.get(key);return [date,{employeeId:row.id,date,hash:saved?.hash||'',record:saved?.data||null,posted:date==='2024-01-10',context:{ready:true,hash:'source-v1',holiday:date==='2024-01-06'?'regular_holiday':'ordinary',restDay:date==='2024-01-07',segments:duties,reason:''}}];}))}));return {data:{rows,total:rows.length}};
 }
 if(name==='save_attendance_matrix'){
  if(args.p_reference==='FAIL')return {error:{code:'40001',message:'Synthetic concurrent edit'}};
  for(const row of args.p_edits){const key=row.employeeId+':'+row.workDate;if((records.get(key)?.hash||'')!==row.expectedHash)return {error:{code:'40001'}};}
  for(const row of args.p_edits)records.set(row.employeeId+':'+row.workDate,{hash:'saved-'+(++version),data:{...row,reviewState:'Draft'}});return {data:{saved:args.p_edits.length}};
 }
 if(name==='review_attendance_matrix')return {data:null};return {error:{message:'Synthetic configuration operation is not connected'}};
},from(table){return {select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},range(){return this;},async maybeSingle(){return {data:{blank_mode:mode}};},async upsert(value){mode=value.blank_mode;return {error:null};},then(resolve){resolve({data:table==='hr_attendance_cutoffs'?[cutoff]:[],count:1});}};}};
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
window.closeModal=async()=>document.getElementById('overlay').classList.remove('on');
const controller=createAttendancePreparation({supabase,esc,permission:()=>true,actor:()=>actor,today:()=> '2024-01-10',confirm:async()=>true,toast:(text)=>document.getElementById('fixture-notice').textContent=text,
 content:()=>document.getElementById('content'),records:()=>document.getElementById('fixture-notice').textContent='Back to original attendance records',departments:()=>['Synthetic Department'],positions:()=>['Synthetic Position'],
 openModal:markup=>{document.getElementById('modal').innerHTML=markup;document.getElementById('overlay').classList.add('on');},closeModal:window.closeModal,employeePicker:()=>'<div>Synthetic employee selector</div>',selectedEmployee:()=>({id:'synthetic-a'}),
 icons:{back:'Back',search:'',plus:'+',settings:'Settings',refresh:'Reload',undo:'Undo',redo:'Redo',save:'Save',lock:'Locked'}
});await controller.open();
</script></body></html>`;
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/shutdown'){res.end('Stopped');server.close();server.closeAllConnections();return;}
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const file=resolve(root,'.'+decodeURIComponent(path));if(![resolve(root,'css')+sep,resolve(root,'js/core')+sep].some(base=>file.startsWith(base))){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});server.listen(4189,'127.0.0.1',()=>console.log('Synthetic attendance preparation: http://127.0.0.1:4189/'));
