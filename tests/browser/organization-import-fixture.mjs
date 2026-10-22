// Synthetic controller/layout harness; authorization and backend are stubs.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(resolve(root,'js/app.js'),'utf8');
const handlers=source.slice(source.indexOf('let ORGANIZATION_IMPORT='),source.indexOf('function settingsOrganizationHTML('));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic organization import</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"><link rel="stylesheet" href="/css/workspace.css"></head><body><div class="overlay on" id="overlay"><div class="modal" id="modal"></div></div><script src="/js/vendor/xlsx.full.min.js"></script><script type="module">
import {parseOrganizationImport} from '/js/core/organization-import.js';
const SESSION={id:'synthetic'},DB={settings:{}},hasPermission=()=>true,employeeSpreadsheetReady=()=>true;
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const iDownload=()=>'',openModal=html=>document.getElementById('modal').innerHTML=html,closeModal=()=>{},renderSettings=()=>{},toast=console.log,confirmDataChange=async()=>true;
const count=Number(new URLSearchParams(location.search).get('clients')??2);
const supabase={rpc:async name=>({data:name==='organization_import_clients'?Array.from({length:count},(_,i)=>({id:'client-'+i,name:'Synthetic client '+i})):{settings:{},departmentsAdded:1,positionsAdded:1,departmentsSkipped:1,positionsSkipped:1,assignmentsAdded:0}})};
${handlers}
Object.assign(window,{openOrganizationImport,readOrganizationImport,commitOrganizationImport,downloadOrganizationTemplate});
await openOrganizationImport();
</script></body></html>`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Stopped');server.close();server.closeAllConnections();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!['js','css'].some(folder=>file.startsWith(resolve(root,folder)+sep))){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4184,'127.0.0.1',()=>console.log('Synthetic import fixture: http://127.0.0.1:4184/'));
