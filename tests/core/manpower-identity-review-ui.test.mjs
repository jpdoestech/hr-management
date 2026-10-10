import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {identityPreviewValid,identityReviewPayload,identityComparisonHTML,identityReviewResultValid,identityReviewError} from '../../js/manpower/identity-review.js';
const preview={candidate_id:'candidate',employee_id:'employee',candidate_name:'Synthetic Applicant',employee_name:'Synthetic Employee',candidate_fingerprint:'a'.repeat(32),employee_fingerprint:'b'.repeat(32),review_revision:2};
test('identity preview requires matching stable IDs, fingerprints and safe version',()=>{
  assert.equal(identityPreviewValid(preview,'candidate','employee'),true);
  for(const value of [null,{}, {...preview,review_revision:null},{...preview,review_revision:-1},{...preview,candidate_fingerprint:'bad'},{...preview,employee_id:'other'}])assert.equal(identityPreviewValid(value,'candidate','employee'),false);
  assert.equal(identityPreviewValid(null,undefined,undefined),false);
});
test('identity decision is explicit and payload uses reviewed fingerprints without source merges',()=>{
  const checked=identityReviewPayload(preview,'employee','SamePerson',' Verified evidence ');
  assert.deepEqual(checked.errors,{});assert.equal(checked.payload.p_reason,'Verified evidence');assert.equal(checked.payload.p_expected_revision,2);
  for(const [source,employee,decision,reason] of [[null,'employee','SamePerson','Reason'],[preview,'other','SamePerson','Reason'],[preview,'employee','','Reason'],[preview,'employee','SamePerson',''],[preview,'employee','SamePerson','x'.repeat(1001)]])assert.ok(Object.keys(identityReviewPayload(source,employee,decision,reason).errors).length);
});
test('comparison escapes scoped source fields and clearly marks stale evidence',()=>{
  const html=identityComparisonHTML({...preview,candidate_name:'<script>',source_changed:true,previous_decision:'SamePerson',linked_employee_id:'employee'});
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Source records changed/);assert.match(html,/existing conversion link/);assert.match(html,/similarity is not proof/);
});
test('save results must prove version, pair, decision, fingerprints, reason and audit link',()=>{
  const payload=identityReviewPayload(preview,'employee','SeparatePersons','Reason').payload;
  const data={...preview,decision:'SeparatePersons',reason:'Reason',revision:3,audit_id:'synthetic-audit'};
  assert.equal(identityReviewResultValid(data,payload),true);
  for(const patch of [{revision:2},{candidate_id:'other'},{decision:'SamePerson'},{reason:'Different'},{audit_id:''},{employee_fingerprint:'c'.repeat(32)}])assert.equal(identityReviewResultValid({...data,...patch},payload),false);
  for(const code of ['PGRST202','42501','40001','23514','unknown'])assert.doesNotMatch(identityReviewError({code,message:'Private details'}),/Private details/);
});
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
function fixture(){
  const nodes={};for(const id of ['onboarding_identity_review','oi_employee','oi_decision','oi_reason','oi_error','oi_comparison','modal'])nodes[id]={value:'',isConnected:true,hidden:true,innerHTML:'',textContent:'',focus(){},setAttribute(){},removeAttribute(){},querySelectorAll:()=>Object.values(nodes)};
  nodes.oi_employee.value='employee';nodes.oi_decision.value='SamePerson';nodes.oi_reason.value='Synthetic verified evidence';
  const calls=[],returned=[],pending=[];let confirm='confirm';
  const ctx={SESSION:{id:'actor'},hasPermission:()=>true,document:{getElementById:id=>nodes[id]},identityPreviewValid,identityReviewPayload,identityComparisonHTML,identityReviewResultValid,identityReviewError,confirmDataChange:async()=>confirm,toast:()=>{},transitionModal:async callback=>callback(),openOnboardingDetails:id=>returned.push(id),supabase:{rpc:async(name,payload)=>{calls.push([name,payload]);return new Promise(resolve=>pending.push(resolve));}}};
  runInNewContext(app.slice(app.indexOf('const ONBOARDING_IDENTITY_UI='),app.indexOf('function openOnboardingHire('))+'\nui=ONBOARDING_IDENTITY_UI;',ctx);
  ctx.ui.candidate='candidate';ctx.ui.preview=preview;
  return {ctx,nodes,calls,returned,pending,setConfirm:value=>confirm=value};
}
test('identity saves lock controls and duplicate clicks, then return to the same applicant',async()=>{
  const {ctx,nodes,calls,returned,pending}=fixture();const saved=ctx.saveOnboardingIdentityReview();await Promise.resolve();await Promise.resolve();
  assert.equal(ctx.ui.busy,true);assert.equal(nodes.oi_reason.disabled,true);await ctx.saveOnboardingIdentityReview();assert.equal(calls.length,1);
  const payload=calls[0][1];pending[0]({data:{candidate_id:'candidate',employee_id:'employee',decision:payload.p_decision,reason:payload.p_reason,candidate_fingerprint:payload.p_candidate_fingerprint,employee_fingerprint:payload.p_employee_fingerprint,revision:3,audit_id:'synthetic-audit'}});
  assert.equal(await saved,true);assert.deepEqual(returned,['candidate']);assert.equal(ctx.ui.busy,false);
});
test('identity cancellation, invalid decisions and revoked access never submit',async()=>{
  const f=fixture();f.setConfirm(false);assert.equal(await f.ctx.saveOnboardingIdentityReview(),false);assert.equal(f.calls.length,0);
  f.nodes.oi_decision.value='';assert.equal(await f.ctx.saveOnboardingIdentityReview(),false);assert.equal(f.calls.length,0);
  f.ctx.hasPermission=()=>false;assert.equal(await f.ctx.saveOnboardingIdentityReview(),false);
});
test('stale or missing identity backend retains entries and unlocks for refresh/retry',async()=>{
  for(const code of ['40001','PGRST202','42501','23514']){
    const {ctx,nodes,calls,returned,pending}=fixture();const saved=ctx.saveOnboardingIdentityReview();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);pending[0]({error:{code}});assert.equal(await saved,false);
    assert.equal(nodes.oi_reason.value,'Synthetic verified evidence');assert.equal(nodes.oi_reason.disabled,false);assert.equal(returned.length,0);assert.ok(nodes.oi_error.textContent);
  }
});
test('identity preview ignores results after employee or session changes',async()=>{
  for(const change of [f=>f.nodes.oi_employee.value='other',f=>f.ctx.SESSION={id:'other'},f=>f.ctx.hasPermission=()=>false]){
    const f=fixture();const loading=f.ctx.loadOnboardingIdentityPreview();change(f);f.pending[0]({data:preview});await loading;assert.equal(f.ctx.ui.preview,null);assert.doesNotMatch(f.nodes.oi_comparison.innerHTML,/Synthetic Applicant/);
  }
});
test('identity dialog dismissal reuses shared save/discard and preserves applicant context',()=>{
  assert.match(app,/onboarding_identity_review'\)&&ONBOARDING_IDENTITY_UI.busy/);
  assert.match(app,/transitionModal\(\(\)=>openOnboardingDetails\(id\)\)/);
  assert.match(app,/data-confirm-change="false" onclick="saveOnboardingIdentityReview/);
});
