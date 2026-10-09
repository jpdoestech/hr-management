import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readManpowerPaste,detectManpowerPasteMapping,previewManpowerPaste,MANPOWER_PASTE_FIELDS} from '../../js/core/manpower-paste.js';
import {manpowerPastePanelHTML,manpowerPasteMappingHTML,manpowerPastePreviewHTML} from '../../js/manpower/paste-preview.js';
import {newManpowerDraft} from '../../js/core/manpower-draft.js';

const vendor={};vm.createContext(vendor);vm.runInContext(readFileSync(new URL('../../js/vendor/xlsx.full.min.js',import.meta.url),'utf8'),vendor);
const catalogs={clients:[],departments:[{name:'Production',active:true},{name:'Sales',active:true},{name:'Inactive',active:false}],positions:[{name:'Operator',department:'Production',active:true}],branches:['Davao']};
const headers=['Department','Position','Headcount','Demand Type','Target Date','Site','Remarks'];
const mapping=MANPOWER_PASTE_FIELDS.map(field=>field.key);
const valid=['Production','Operator','1000','Expansion','2026-10-20','Davao','Line 3'];

test('spreadsheet paste uses the bundled SheetJS parser and retains quoted tabs/newlines',()=>{
  const text=headers.join('\t')+'\r\nProduction\tOperator\t1000\tExpansion\t2026-10-20\tDavao\t"First\tpart\nSecond line"';
  const rows=readManpowerPaste(text,vendor.XLSX);
  assert.equal(rows.length,2);assert.equal(rows[1][2],'1000');assert.equal(rows[1][6],'First\tpart\nSecond line');
});
test('detected headers and manual/no-header mappings preserve source column order',()=>{
  assert.deepEqual(detectManpowerPasteMapping([['Remarks','Dept','Quantity','Job Title','Extra']]),['purpose','department','current_authorized','position','']);
  assert.deepEqual(detectManpowerPasteMapping([valid],false),mapping);
  const preview=previewManpowerPaste([valid],mapping,catalogs,{hasHeader:false});assert.equal(preview.valid,true);assert.equal(preview.rows[0].sourceRow,1);
});
test('valid rows map case/whitespace to existing catalogs without creating masters or slots',()=>{
  const copy=JSON.stringify(catalogs);const line=[...valid];line[0]=' production ';line[1]='OPERATOR';line[3]='replacement';line[5]='davao';
  const preview=previewManpowerPaste([headers,line,line],mapping,catalogs);
  assert.equal(preview.valid,true);assert.equal(preview.rows.length,2);assert.equal(preview.rows[0].line.department,'Production');
  assert.equal(preview.rows[0].line.position,'Operator');assert.equal(preview.rows[0].line.site,'Davao');assert.equal(preview.rows[0].line.demand_type,'Replacement');assert.equal(preview.rows[0].line.current_authorized,'1000');assert.equal(JSON.stringify(catalogs),copy);
});
test('unknown/inactive departments and cross-department positions block the entire paste',()=>{
  for(const department of ['Unknown','Inactive','Sales']){
    const invalid=[...valid];invalid[0]=department;
    const preview=previewManpowerPaste([headers,valid,invalid],mapping,catalogs);
    assert.equal(preview.valid,false);assert.equal(preview.rows.length,2);assert.equal(preview.rows[0].errors.length,0);assert.ok(preview.rows[1].errors.length);
  }
});
test('quantities, dates, sites and demand types are validated without altering invalid input',()=>{
  for(const [column,value] of [[2,'0'],[2,'2.5'],[2,'2147483648'],[2,'=1000+1'],[3,'Other'],[4,'2026-02-30'],[4,'10/20/2026'],[5,'Unknown']]){
    const invalid=[...valid];invalid[column]=value;
    const preview=previewManpowerPaste([headers,invalid],mapping,catalogs);
    assert.equal(preview.valid,false);assert.ok(preview.rows[0].errors.length);assert.equal(preview.rows[0].line[mapping[column]],value);
  }
  const past=[...valid];past[4]='2026-10-01';assert.equal(previewManpowerPaste([headers,past],mapping,catalogs,{requestDate:'2026-10-09'}).valid,false);
});
test('required mappings, repeated mappings, unknown destinations and empty rows fail safely',()=>{
  for(const fields of [mapping.map(key=>key==='department'?'':key),['department','department','current_authorized'],['bad','position','current_authorized']])assert.equal(previewManpowerPaste([headers,valid],fields,catalogs).valid,false);
  assert.equal(previewManpowerPaste([headers],mapping,catalogs).valid,false);
  assert.equal(previewManpowerPaste([headers,['','',''],valid],mapping,catalogs).rows[0].sourceRow,3);
  const partial=[...valid];partial[2]='';assert.equal(previewManpowerPaste([headers,partial],mapping,catalogs).valid,false);
  assert.throws(()=>readManpowerPaste('',vendor.XLSX),/Paste requisition/);
  assert.throws(()=>readManpowerPaste('x'.repeat(2000001),vendor.XLSX),/too large/);
  assert.throws(()=>detectManpowerPasteMapping([Array(65).fill('column')]),/maximum 64/);
});
test('an absent demand column defaults to Expansion and ignored columns stay out of the draft',()=>{
  const preview=previewManpowerPaste([['Dept','Position','Headcount','Unused'],['Production','Operator','50000','discard']],['department','position','current_authorized',''],catalogs);
  assert.equal(preview.valid,true);assert.equal(preview.rows[0].line.demand_type,'Expansion');assert.equal(preview.rows[0].line.purpose,'');
});
test('preview escapes source markup and paginates large pasted batches to 25 rows',()=>{
  const matrix=[headers,...Array.from({length:1000},()=>[...valid.slice(0,6),'<script>alert(1)</script>'])];
  const preview=previewManpowerPaste(matrix,mapping,catalogs);assert.equal(preview.valid,true);
  const html=manpowerPastePreviewHTML(preview,2);assert.match(html,/Page 2 of 40/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.equal((html.match(/<tr>/g)||[]).length,26);
  const mapped=manpowerPasteMappingHTML([['<img>']],['department'],true);assert.match(mapped,/&lt;img&gt;/);assert.doesNotMatch(mapped,/<img>/);
});
test('paste panel is labeled, keyboard operable and does not save records directly',()=>{
  const html=manpowerPastePanelHTML();assert.match(html,/label for="md_paste_text"/);assert.match(html,/role="status" aria-live="polite" aria-atomic="true"/);assert.match(html,/onclick="manpowerDraftApplyPaste\(\)" disabled/);
  const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const apply=source.slice(source.indexOf('async function manpowerDraftApplyPaste('),source.indexOf('async function saveManpowerDraft('));
  assert.match(apply,/confirmDataChange/);assert.match(apply,/crypto.randomUUID/);assert.match(apply,/SESSION.id!==sessionId/);assert.match(apply,/checked\?\.valid/);assert.doesNotMatch(apply,/supabase|saveDB|saveManpowerDraft\(/);
  assert.match(source,/Add the pasted rows to the draft or clear the paste before saving/);
});

function pasteHandlerFixture(rows,{allowed=true,confirm=true}={}){
  const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const elements=Object.fromEntries(['md_paste_text','md_paste_header','md_paste_mapping','md_paste_status','md_paste_preview','md_paste_apply','md_date_requested'].map(id=>[id,{value:'',checked:true,innerHTML:'',textContent:'',focus(){this.focused=true;}}]));
  elements.md_paste_text.value=[headers,...rows].map(row=>row.join('\t')).join('\n');
  let nextId=0;let confirmations=0;
  const context={SESSION:{id:'user'},STATE:{view:'manpowerDraftEditor'},MANPOWER_DRAFT_UI:{saving:false,draft:newManpowerDraft('request','existing-line'),catalogs},
    document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},window:{XLSX:vendor.XLSX},crypto:{randomUUID:()=>`new-${++nextId}`},
    hasPermission:()=>allowed,confirmDataChange:async()=>{confirmations++;return typeof confirm==='function'?confirm(context):confirm;},
    readManpowerPaste,detectManpowerPasteMapping,previewManpowerPaste,manpowerPasteMappingHTML,manpowerPastePreviewHTML};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function manpowerDraftRead(){'),source.indexOf('async function saveManpowerDraft(){')),context);
  context.manpowerDraftRead=()=>context.MANPOWER_DRAFT_UI.draft;
  context.manpowerDraftRenderLines=()=>{};
  return {context,elements,confirmations:()=>confirmations};
}
test('invalid paste and denied permissions never append even the valid subset',async()=>{
  const invalid=[...valid];invalid[0]='Unknown';
  const blocked=pasteHandlerFixture([valid,invalid]);await blocked.context.manpowerDraftApplyPaste();
  assert.equal(blocked.context.MANPOWER_DRAFT_UI.draft.lines.length,1);assert.equal(blocked.confirmations(),0);assert.ok(blocked.elements.md_paste_text.value);
  const denied=pasteHandlerFixture([valid],{allowed:false});await denied.context.manpowerDraftApplyPaste();assert.equal(denied.context.MANPOWER_DRAFT_UI.draft.lines.length,1);assert.equal(denied.confirmations(),0);
});
test('cancel retains the paste; confirmed add appends every line with independent stable ids',async()=>{
  const cancelled=pasteHandlerFixture([valid],{confirm:false});await cancelled.context.manpowerDraftApplyPaste();
  assert.equal(cancelled.context.MANPOWER_DRAFT_UI.draft.lines.length,1);assert.ok(cancelled.elements.md_paste_text.value);
  const accepted=pasteHandlerFixture([valid,valid]);await accepted.context.manpowerDraftApplyPaste();
  const lines=accepted.context.MANPOWER_DRAFT_UI.draft.lines;
  assert.equal(lines.length,3);assert.equal(new Set(lines.map(row=>row.id)).size,3);assert.equal(lines[0].id,'existing-line');assert.equal(accepted.elements.md_paste_text.value,'');assert.equal(accepted.confirmations(),1);
});
test('session/request changes or invalid edits during confirmation block application',async()=>{
  for(const change of [context=>{context.SESSION.id='other';},context=>{context.MANPOWER_DRAFT_UI.draft.request.id='other';},context=>{context.document.getElementById('md_paste_text').value='Department\tPosition\tHeadcount\nUnknown\tOperator\t10';}]){
    const fixture=pasteHandlerFixture([valid],{confirm:context=>{change(context);return true;}});await fixture.context.manpowerDraftApplyPaste();assert.equal(fixture.context.MANPOWER_DRAFT_UI.draft.lines.length,1);
  }
});
