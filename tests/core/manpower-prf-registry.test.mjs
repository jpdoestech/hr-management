import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const sql=readFileSync(new URL('../../supabase/proposals/0035_manpower_prf_registry.sql',import.meta.url),'utf8');
const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const saveSource=app.slice(app.indexOf('async function saveManpowerDraft('),app.indexOf('function openManpowerRequestForm('));

function saveFixture(code){
  let focused='';
  const elements=Object.fromEntries(['md_prf_number','md_errors','md_save'].map(id=>[id,{value:'Keep this number',hidden:true,isConnected:true,attributes:{},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},focus(){focused=id;}}]));
  const draft={request:{id:'draft',revision:1},lines:[{notes:'Keep these entries'}]};
  const context={SESSION:{id:'user'},STATE:{view:'manpowerDraftEditor'},MANPOWER_DRAFT_UI:{saving:false,draft,catalogs:{}},PENDING_PAGE_NAVIGATION:'dashboard',PAGE_EDIT_STATE:{dirty:true},document:{getElementById:id=>elements[id]},manpowerDraftRead:()=>draft,validateManpowerDraft:()=>({errors:[],header:{},lines:[]}),hasPermission:()=>true,esc:value=>value,toast:()=>{},supabase:{rpc:async()=>({error:{code,message:'Backend failure'}})},go:()=>{throw Error('Failed saves must not navigate');}};
  runInNewContext(saveSource,context);
  return {context,elements,draft,focus:()=>focused};
}

test('duplicate save retains draft and dirty state, describes and focuses PRF input',async()=>{
  const fixture=saveFixture('23505');await fixture.context.saveManpowerDraft();
  assert.equal(fixture.context.MANPOWER_DRAFT_UI.draft,fixture.draft);
  assert.equal(fixture.draft.lines[0].notes,'Keep these entries');
  assert.equal(fixture.context.PAGE_EDIT_STATE.dirty,true);
  assert.equal(fixture.context.PENDING_PAGE_NAVIGATION,null);
  assert.equal(fixture.elements.md_errors.hidden,false);
  assert.equal(fixture.elements.md_prf_number.attributes['aria-describedby'],'md_errors');
  assert.equal(fixture.elements.md_prf_number.attributes['aria-invalid'],'true');
  assert.equal(fixture.focus(),'md_prf_number');
  assert.equal(fixture.elements.md_save.disabled,false);
});

test('revision conflict preserves entries and focuses the error summary',async()=>{
  const fixture=saveFixture('40001');await fixture.context.saveManpowerDraft();
  assert.equal(fixture.context.MANPOWER_DRAFT_UI.draft,fixture.draft);
  assert.match(fixture.elements.md_errors.textContent,/Keep your entries/);
  assert.equal(fixture.focus(),'md_errors');
  assert.equal(fixture.elements.md_prf_number.attributes['aria-invalid'],undefined);
  assert.equal(fixture.context.MANPOWER_DRAFT_UI.saving,false);
});
test('PRF registry proposal protects both models without rewriting source rows',()=>{
  assert.match(sql,/primary key\(tenant_id,normalized_prf\)/);
  assert.match(sql,/jsonb_object_agg\(owner_key,true\)/);
  assert.match(sql,/lock table public.hr_records,public.hr_manpower_requests in share row exclusive mode/);
  assert.match(sql,/after insert or update or delete on public.hr_records/);
  assert.match(sql,/after insert or update or delete on public.hr_manpower_requests/);
  assert.doesNotMatch(sql,/(?:update|delete from|truncate) public\.(?:hr_records|hr_manpower_requests|hr_manpower_lines)\b/i);
});
test('private registry uses atomic unique ownership and preserves existing owners only',()=>{
  assert.match(sql,/on conflict\(tenant_id,normalized_prf\) do update/);
  assert.match(sql,/where registry.owners \? owner_key/);
  assert.match(sql,/errcode='23505'/);assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on public.hr_manpower_prf_registry from public,anon,authenticated/);
  assert.match(sql,/revoke all on function public.guard_manpower_prf_number\(\) from public,anon,authenticated/);
  assert.match(sql,/insert into public.hr_audit_logs/);
});
test('draft errors remain in the form and duplicate numbers are described on their input',()=>{
  const save=app.slice(app.indexOf('async function saveManpowerDraft('),app.indexOf('function openManpowerRequestForm('));
  assert.match(save,/errors.hidden=false;errors.textContent=message/);
  assert.match(save,/prfInput.setAttribute\('aria-invalid','true'\)/);
  assert.match(save,/prfInput.setAttribute\('aria-describedby','md_errors'\)/);
  assert.match(save,/SESSION\?\.id===sessionId/);assert.match(save,/errors.isConnected/);
  assert.match(save,/errors.focus\(\)/);
  const editor=readFileSync(new URL('../../js/manpower/draft-editor.js',import.meta.url),'utf8');
  assert.match(editor,/id="md_errors" class="notice" role="alert" tabindex="-1"/);
});
