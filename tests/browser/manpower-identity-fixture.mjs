// Synthetic modal/controller harness. Picker/auth/confirmation/backend are stubs, not live acceptance.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(resolve(root,'js/app.js'),'utf8');
const handlers=source.slice(source.indexOf('const ONBOARDING_IDENTITY_UI='),source.indexOf('function openOnboardingHire('));
const names=[...handlers.matchAll(/(?:async )?function (\w+)\(/g)].map(match=>match[1]);
const html=String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic identity review</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/professional.css"></head><body><div class="overlay on" id="overlay"><div class="modal" id="modal"></div></div><p id="status" role="status"></p><script type="module">
import {identityPreviewValid,identityReviewPayload,identityComparisonHTML,identityReviewResultValid,identityReviewError} from '/js/manpower/identity-review.js';
const SESSION={id:'synthetic-actor'},DB={onboardingCandidates:[{id:'candidate'}]};const hasPermission=()=>true;
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const transitionModal=async callback=>callback();const openModal=html=>document.getElementById('modal').innerHTML=html;
const employeePickerHTML=()=>'<div class="field"><label for="oi_employee_search">Compare with employee</label><input id="oi_employee_search" value="Synthetic Employee" readonly><input type="hidden" id="oi_employee" value="employee"></div>';
const openOnboardingDetails=id=>openModal('<div class="modal-head"><h3>Synthetic Applicant Overview</h3></div><div class="modal-body">Returned to '+esc(id)+'</div>');
const requestCloseModal=async()=>{if(!ONBOARDING_IDENTITY_UI.busy)openOnboardingDetails(ONBOARDING_IDENTITY_UI.candidate);};
const toast=message=>document.getElementById('status').textContent=message;
const confirmDataChange=async()=> 'confirm';
const preview={candidate_id:'candidate',employee_id:'employee',candidate_name:'SYNTHETIC, Applicant With A Long Test Name',employee_name:'SYNTHETIC, Employee With A Long Test Name',candidate_department:'Synthetic Production',employee_department:'Synthetic Production',candidate_fingerprint:'a'.repeat(32),employee_fingerprint:'b'.repeat(32),review_revision:0};
const supabase={rpc:async(name,payload)=>{
  if(location.search.includes('missing'))return {error:{code:'PGRST202'}};
  if(name==='preview_manpower_identity_review')return {data:preview};
  if(location.search.includes('stale'))return {error:{code:'40001'}};
  return {data:{candidate_id:payload.p_candidate,employee_id:payload.p_employee,decision:payload.p_decision,reason:payload.p_reason,candidate_fingerprint:payload.p_candidate_fingerprint,employee_fingerprint:payload.p_employee_fingerprint,revision:payload.p_expected_revision+1,audit_id:'synthetic-audit'}};
}};
${handlers}
Object.assign(window,{${names.join(',')},requestCloseModal});
await openOnboardingIdentityReview('candidate');await loadOnboardingIdentityPreview();
</script></body></html>`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/shutdown'){res.end('Stopped');server.close();return;}
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!['js','css'].some(folder=>file.startsWith(resolve(root,folder)+sep))){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'text/javascript');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
server.listen(4183,'127.0.0.1',()=>console.log('Synthetic identity fixture: http://127.0.0.1:4183/ (stop via /shutdown).'));
