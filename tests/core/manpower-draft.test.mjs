import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {newManpowerDraft,validateManpowerDraft} from '../../js/core/manpower-draft.js';
import {manpowerDraftEditorHTML,manpowerDraftLinesHTML} from '../../js/manpower/draft-editor.js';
const catalogs={clients:[{id:'c1',name:'Client One',active:true}],departments:[{name:'Production',active:true},{name:'Sales',active:true}],positions:[{name:'Operator',department:'Production',active:true}],branches:['Davao']};
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../../supabase/migrations/0034_manpower_draft_transactions.sql',import.meta.url),'utf8');
test('incomplete manpower drafts preserve blank quantities and manual numbers',()=>{
  const draft=newManpowerDraft('request','line');const result=validateManpowerDraft(draft,catalogs);
  assert.deepEqual(result.errors,[]);assert.equal(result.lines[0].current_authorized,null);assert.equal(result.header.prf_number,'');
});
test('1000+ draft quantity is one line, not worker placeholders',()=>{
  const draft=newManpowerDraft('request','line');Object.assign(draft.lines[0],{department:'Production',position:'Operator',current_authorized:'100000'});
  const result=validateManpowerDraft(draft,catalogs);assert.deepEqual(result.errors,[]);assert.equal(result.lines.length,1);assert.equal(result.lines[0].current_authorized,100000);
  for(const value of ['0','-1','2.5','2147483648']){draft.lines[0].current_authorized=value;assert.ok(validateManpowerDraft(draft,catalogs).errors.length);}
});
test('draft validation rejects cross-department positions, unknown masters and invalid dates',()=>{
  const draft=newManpowerDraft('request','line');Object.assign(draft.request,{client_id:'unknown',branch_reporting:'Unknown',date_requested:'2026-02-30'});
  Object.assign(draft.lines[0],{department:'Sales',position:'Operator',site:'Unknown',target_date:'bad'});
  const errors=validateManpowerDraft(draft,catalogs).errors.join(' ');assert.match(errors,/Client Account/);assert.match(errors,/reporting branch/);assert.match(errors,/position must belong/);assert.match(errors,/valid target date/);
});
test('legitimate identical lines remain separate and duplicate ids are rejected',()=>{
  const draft=newManpowerDraft('request','line');draft.lines.push({...draft.lines[0],id:'line2'});
  assert.equal(validateManpowerDraft(draft,catalogs).errors.length,0);draft.lines[1].id='line';assert.match(validateManpowerDraft(draft,catalogs).errors.join(' '),/distinct stable id/);
});
test('draft editor retains its shared full-width form and separates review from deployment',()=>{
  const draft=newManpowerDraft('request','line');draft.request.remarks='<script>bad</script>';
  const html=manpowerDraftEditorHTML(draft,catalogs);
  assert.match(html,/Save Draft/);assert.match(html,/PRF Header/);assert.match(html,/Requisition Lines/);assert.match(html,/go\('manpowerDrafts'\)/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|submitManpowerDraft|openModal/);
  assert.match(html,/reviewManpowerDraftSubmission/);
  assert.match(manpowerDraftLinesHTML(draft.lines,catalogs),/data-line-id="line"/);
});
test('new drafts are saved atomically and cannot mutate legacy records or bypass draft state',()=>{
  assert.match(sql,/state='Draft'/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/previous.revision<>p_expected_revision/);
  assert.match(sql,/insert into public.hr_audit_logs/);assert.match(sql,/original_requested is null/);
  assert.match(sql,/Drafts cannot submit, cancel, reserve or deploy workers/);
  assert.doesNotMatch(sql,/(insert into|update|delete from) public.hr_records/i);
  const save=source.slice(source.indexOf('async function saveManpowerDraft('),source.indexOf('function openManpowerRequestForm('));
  assert.match(save,/rpc\('save_manpower_draft'/);assert.doesNotMatch(save,/saveDB\(/);
  assert.match(save,/PENDING_PAGE_NAVIGATION\|\|'manpowerDrafts'/);
});
test('unsaved-page tracking includes line identity changes even when visible values are identical',()=>{
  const line={dataset:{lineId:'original'}};
  const root={querySelector:()=>true,querySelectorAll:()=>[line]};
  const context={editorControls:()=>[],root};vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function serializeEditor('),source.indexOf('function findEditorSaveButton(')),context);
  const baseline=vm.runInContext('serializeEditor(root,{page:true})',context);
  line.dataset.lineId='duplicate';assert.notEqual(vm.runInContext('serializeEditor(root,{page:true})',context),baseline);
});
test('view-only users can inspect existing draft lines but cannot edit or save',async()=>{
  const controls=[{},{}];const buttons=['manpowerDraftAddLine()','manpowerDraftRemoveLine(0)','saveManpowerDraft()',"go('manpowerDrafts')"].map(handler=>({getAttribute:()=>handler,remove(){this.removed=true;}}));
  let pasteRemoved=false;
  const content={innerHTML:'',querySelector:()=>({remove(){pasteRemoved=true;}}),querySelectorAll:selector=>selector==='button'?buttons:controls};let title='';
  const context={SESSION:{id:'viewer'},STATE:{view:'manpowerDraftEditor',manpowerDraftId:'draft1'},document:{getElementById:()=>content},hasPermission:permission=>permission==='manpower.view',
    newManpowerDraft,validateManpowerDraft,manpowerDraftEditorHTML,manpowerDraftLinesHTML,crypto:{randomUUID:()=> 'new-id'},departmentCatalog:()=>catalogs.departments,positionCatalog:()=>catalogs.positions,employeeBranchLocations:()=>catalogs.branches,
    structuredClone,iPlus:()=>'+',setTitle:value=>title=value,capturePageEditState:()=>{},toast:()=>{},
    supabase:{from:table=>{const query={select:()=>query,order:()=>query,range:()=>query,eq:()=>query,single:()=>query,then:resolve=>Promise.resolve(resolve(table==='hr_manpower_clients'?{data:catalogs.clients,count:1}:{data:{...newManpowerDraft('draft1','line').request,revision:1,hr_manpower_lines:[{id:'line',ordinal:0,current_authorized:1000}]}}))};return query;}}
  };
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const MANPOWER_DRAFT_UI='),source.indexOf('function openManpowerRequestForm(')),context);
  await vm.runInContext('renderManpowerDraftEditor()',context);
  assert.match(title,/View Draft/);assert.ok(controls.every(control=>control.disabled));
  assert.equal(pasteRemoved,true);
  assert.ok(buttons.slice(0,3).every(button=>button.removed));assert.equal(buttons[3].removed,undefined);
  assert.match(content.innerHTML,/value="1000"/);
});
