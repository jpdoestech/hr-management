import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {reviewManpowerSubmission,manpowerSubmissionReviewHTML,manpowerSubmissionError} from '../../js/manpower/submission-review.js';
const catalogs={clients:[{id:'client',name:'Synthetic Client',active:true}],departments:[{name:'Production',active:true}],positions:[{name:'Operator',department:'Production',active:true}],branches:['Davao']};
const draft=()=>({request:{id:'synthetic-request',revision:4,state:'Draft',prf_number:'PRF Test',client_id:'client',branch_reporting:'Davao',requested_by:'Synthetic HR',date_requested:'2026-10-09',target_date:'2026-10-20',priority:'Normal'},lines:[{id:'line',department:'Production',position:'Operator',current_authorized:1000,demand_type:'Expansion'}]});
test('saved complete draft reviews quantities without creating workers or changing the source',()=>{
  const source=draft(),before=structuredClone(source),review=reviewManpowerSubmission(source,catalogs);
  assert.deepEqual(review.errors,[]);assert.equal(review.total,1000);assert.deepEqual(source,before);
  assert.equal(review.revision,4);assert.equal(review.id,'synthetic-request');
});
test('partial drafts remain saveable but cannot submit, including inactive retained clients',()=>{
  const source=draft();source.request.prf_number='';source.lines[0].current_authorized='';
  const review=reviewManpowerSubmission(source,catalogs);
  assert.match(review.errors.join(' '),/PRF Number is required/);assert.match(review.errors.join(' '),/positive headcount/);
  source.originalClientId='client';assert.match(reviewManpowerSubmission(source,{...catalogs,clients:[{id:'client',active:false}]}).errors.join(' '),/active Client Account is required/);
  source.request.revision=0;assert.match(reviewManpowerSubmission(source,catalogs).errors.join(' '),/Save the draft/);
  source.request.state='Open';assert.match(reviewManpowerSubmission(source,catalogs).errors.join(' '),/Only a saved draft/);
});
test('unsaved header, quantity and line-order changes invalidate saved draft review',()=>{
  for(const change of [row=>row.request.remarks='New remark',row=>row.lines[0].current_authorized=1001,row=>row.lines.push({...row.lines[0],id:'second'})]){
    const saved=draft(),current=structuredClone(saved);change(current);
    assert.match(reviewManpowerSubmission(current,catalogs,saved).errors.join(' '),/Save your changes/);
  }
  const saved=draft(),current=structuredClone(saved);current.lines[0].current_authorized='1000';
  assert.deepEqual(reviewManpowerSubmission(current,catalogs,saved).errors,[]);
});
test('review escapes source text and provides keyboard-accessible bounded table and back action',()=>{
  const source=draft();source.lines[0].purpose='<img onerror="bad">';
  const html=manpowerSubmissionReviewHTML(reviewManpowerSubmission(source,catalogs),catalogs);
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/aria-labelledby="md_review_title"/);
  assert.match(html,/scope="col"/);assert.match(html,/tabindex="0" role="region"/);assert.match(html,/Back to editing/);
  assert.match(html,/does not reserve applicants or confirm deployment/);
});
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const handler=app.slice(app.indexOf('async function submitManpowerDraft(){'),app.indexOf('function manpowerDraftRead(){'));
function fixture({confirmation='confirm',error=null,current=draft(),allowed=true}={}){
  let calls=0,navigation='',focus=false;
  const button={disabled:false,isConnected:true},errors={hidden:true,isConnected:true,focus(){focus=true;}};
  const ui={saving:false,saved:draft(),catalogs,review:reviewManpowerSubmission(draft(),catalogs)};
  const context={SESSION:{id:'test-user'},STATE:{view:'manpowerDraftEditor'},MANPOWER_DRAFT_UI:ui,document:{getElementById:id=>id==='md_submit'?button:id==='md_errors'?errors:null},hasPermission:()=>allowed,confirmDataChange:async()=>confirmation,reviewManpowerSubmission,manpowerSubmissionError,manpowerDraftRead:()=>current,PAGE_EDIT_STATE:{dirty:true},PENDING_PAGE_NAVIGATION:null,toast(){},go:async view=>{navigation=view;},supabase:{rpc:async(name,payload)=>{calls++;assert.equal(name,'submit_manpower_request');assert.deepEqual(JSON.parse(JSON.stringify(payload)),{p_id:'synthetic-request',p_expected_revision:4});return error?{error}:{data:{request:{id:'synthetic-request',state:'Open'}}};}}};
  runInNewContext(handler,context);
  return {context,ui,button,errors,calls:()=>calls,navigation:()=>navigation,focused:()=>focus};
}
test('cancel and permission denial never write or dismiss the draft',async()=>{
  for(const options of [{confirmation:false},{allowed:false}]){
    const f=fixture(options);await f.context.submitManpowerDraft();assert.equal(f.calls(),0);assert.equal(f.navigation(),'');assert.equal(f.ui.saving,false);assert.equal(f.button.disabled,false);
  }
});
test('post-review edits block submission and retain data with an announced error',async()=>{
  const current=draft();current.lines[0].current_authorized=1001;
  const f=fixture({current});await f.context.submitManpowerDraft();assert.equal(f.calls(),0);assert.equal(f.navigation(),'');assert.equal(f.focused(),true);assert.match(f.errors.textContent,/draft changed after review/);
});
test('explicit successful submission sends stable ID/revision once and opens submitted details',async()=>{
  const f=fixture();await Promise.all([f.context.submitManpowerDraft(),f.context.submitManpowerDraft()]);
  assert.equal(f.calls(),1);assert.equal(f.navigation(),'manpowerSubmittedDetails');assert.equal(f.context.STATE.manpowerSubmittedId,'synthetic-request');assert.equal(f.context.PAGE_EDIT_STATE,null);
});
test('missing deployment, stale revision and authorization failures retain draft and unlock retry',async()=>{
  for(const code of ['PGRST202','42883','40001','23505','42501']){
    const f=fixture({error:{code}});await f.context.submitManpowerDraft();assert.equal(f.calls(),1);assert.equal(f.navigation(),'');assert.equal(f.errors.hidden,false);assert.equal(f.focused(),true);assert.equal(f.ui.saving,false);assert.equal(f.button.disabled,false);
    assert.equal(f.errors.textContent,manpowerSubmissionError({code}));
  }
});
