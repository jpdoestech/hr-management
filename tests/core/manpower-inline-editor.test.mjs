import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {manpowerDraftLinesHTML,manpowerDraftPositionOptionsHTML,readManpowerDraft} from '../../js/manpower/draft-editor.js';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const catalogs={clients:[],departments:[{name:'Production',active:true}],positions:[{name:'Operator',department:'Production',active:true},{name:'Clerk',department:'Sales',active:true},{name:'Archived',department:'Production',active:false}],branches:['Davao']};
test('inline rows keep unique accessible labels and disclose optional details without duplicate controls',()=>{
  const html=manpowerDraftLinesHTML([{id:'one',department:'Production',purpose:'<script>'},{id:'two'}],catalogs);
  assert.match(html,/manpower-line-columns/);assert.match(html,/aria-controls="md_0_details"/);
  assert.match(html,/id="md_0_details"[^>]*hidden/);assert.match(html,/aria-expanded="false"/);
  assert.match(html,/aria-label="Duplicate line 2"/);assert.match(html,/aria-label="Remove line 2"/);
  assert.match(html,/&lt;script&gt;/);assert.equal((html.match(/data-draft-field="purpose"/g)||[]).length,2);
  assert.match(html,/label for="md_1_quantity"/);
});
test('dependent position options exclude other departments and inactive catalog values',()=>{
  const html=manpowerDraftPositionOptionsHTML('Production',catalogs);
  assert.match(html,/Operator/);assert.doesNotMatch(html,/Clerk|Archived/);
});
test('department change updates only its position picker without a form repaint',()=>{
  const position={value:'Operator',innerHTML:''},department={value:'Sales'};
  const context={document:{getElementById:id=>id==='md_0_position'?position:department},manpowerDraftPositionOptionsHTML,MANPOWER_DRAFT_UI:{catalogs},manpowerDraftRead:()=>({retained:true})};
  const start=source.indexOf('function manpowerDraftDepartmentChanged('),end=source.indexOf('let MANPOWER_PASTE_PREVIEW',start);
  runInNewContext(source.slice(start,end),context);context.manpowerDraftDepartmentChanged(0);
  assert.equal(position.value,'');assert.match(position.innerHTML,/Clerk/);assert.doesNotMatch(position.innerHTML,/Operator/);
  assert.equal(context.MANPOWER_DRAFT_UI.draft.retained,true);
});
test('detail disclosure toggles hidden and aria-expanded without changing field values',()=>{
  const panel={hidden:true},button={textContent:'Details',setAttribute(key,value){this[key]=value;}};
  const context={document:{getElementById:()=>panel,querySelector:()=>button}};
  const start=source.indexOf('function manpowerDraftToggleDetails('),end=source.indexOf('function manpowerDraftAddLine(',start);
  runInNewContext(source.slice(start,end),context);context.manpowerDraftToggleDetails(0);
  assert.equal(panel.hidden,false);assert.equal(button['aria-expanded'],'true');
  context.manpowerDraftToggleDetails(0);assert.equal(panel.hidden,true);assert.equal(button['aria-expanded'],'false');
});
test('collapsed optional fields still participate in draft reads and validation payloads',()=>{
  const controls=[{dataset:{draftField:'department'},value:'Production'},{dataset:{draftField:'purpose'},value:'Hidden details retained'},{dataset:{draftField:'site'},value:'Davao'}];
  const root={querySelector:()=>null,querySelectorAll:()=>[{dataset:{lineId:'one'},querySelectorAll:()=>controls}]};
  const read=readManpowerDraft(root,{request:{id:'draft'}},catalogs);
  assert.equal(read.lines[0].purpose,'Hidden details retained');assert.equal(read.lines[0].site,'Davao');
});
