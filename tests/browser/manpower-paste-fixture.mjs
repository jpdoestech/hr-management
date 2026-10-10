// Local-only browser fixture. Uses the real editor/handlers but never contacts Supabase.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(resolve(root,'js/app.js'),'utf8');
const handlers=source.slice(source.indexOf('function manpowerDraftCloseReview(){'),source.indexOf('async function saveManpowerDraft(){'));
const names=[...handlers.matchAll(/(?:async )?function (\w+)\(/g)].map(match=>match[1]);
const page=readFileSync(resolve(root,'index.html'),'utf8');
const confirmationHTML=page.slice(page.indexOf('<div class="data-confirm-overlay"'),page.indexOf('<div class="toast"'));
const confirmationHandlers=source.slice(source.indexOf('function confirmDataChange('),source.indexOf("document.addEventListener('click',async event=>{",source.indexOf('function confirmDataChange(')));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manpower paste fixture</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"></head><body>
<main style="padding:16px;overflow:auto;height:100dvh"><h2>Manpower Fulfillment / Edit Draft</h2><div id="content"></div><div id="fixture_status" role="status"></div></main>
${confirmationHTML}<script src="/js/vendor/xlsx.full.min.js"></script><script type="module">
import {newManpowerDraft} from '/js/core/manpower-draft.js';
import {reviewManpowerSubmission,manpowerSubmissionReviewHTML,manpowerSubmissionError} from '/js/manpower/submission-review.js';
import {manpowerDraftEditorHTML,manpowerDraftLinesHTML,manpowerDraftPositionOptionsHTML,readManpowerDraft} from '/js/manpower/draft-editor.js';
import {readManpowerPaste,detectManpowerPasteMapping,previewManpowerPaste} from '/js/core/manpower-paste.js';
import {manpowerPasteMappingHTML,manpowerPastePreviewHTML} from '/js/manpower/paste-preview.js';
import {installTableEnhancer} from '/js/core/table-enhancer.js';
const SESSION={id:'fixture-user'};const STATE={view:'manpowerDraftEditor'};
const hasPermission=()=>true;
let DATA_CONFIRM_PENDING=null;let DATA_CONFIRM_TRIGGER=null;
${confirmationHandlers}
const MANPOWER_DRAFT_UI={saving:false,draft:newManpowerDraft('fixture-request',crypto.randomUUID()),catalogs:{clients:[{id:'client',name:'Fixture Client',active:true}],departments:[{name:'Production',active:true},{name:'Sales',active:true}],positions:[{name:'Operator',department:'Production',active:true},{name:'Clerk',department:'Sales',active:true}],branches:['Davao','Manila']}};
if(location.search.includes('submission')){
  Object.assign(MANPOWER_DRAFT_UI.draft.request,{revision:2,state:'Draft',prf_number:'PRF Fixture',client_id:'client',branch_reporting:'Davao',requested_by:'Synthetic HR',date_requested:'2026-10-09',target_date:'2026-10-20'});
  Object.assign(MANPOWER_DRAFT_UI.draft.lines[0],{department:'Production',position:'Operator',current_authorized:1000});
}
MANPOWER_DRAFT_UI.saved=structuredClone(MANPOWER_DRAFT_UI.draft);
let PAGE_EDIT_STATE=null,PENDING_PAGE_NAVIGATION=null;
const supabase={rpc:async()=>({error:{code:'PGRST202'}})};
function toast(message){document.getElementById('fixture_status').textContent=message;}
${handlers}
function saveManpowerDraft(){document.getElementById('fixture_status').textContent='Fixture only: no database writes.';}
function go(){document.getElementById('fixture_status').textContent='Fixture Back / Cancel selected.';}
Object.assign(window,{${names.join(',')},saveManpowerDraft,go});
document.getElementById('content').innerHTML=manpowerDraftEditorHTML(MANPOWER_DRAFT_UI.draft,MANPOWER_DRAFT_UI.catalogs);
installTableEnhancer({getState:()=>STATE,getContent:()=>document.getElementById('content')});
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
server.listen(4181,'127.0.0.1',()=>console.log('Local-only fixture: http://127.0.0.1:4181/ (stop via /shutdown).'));
