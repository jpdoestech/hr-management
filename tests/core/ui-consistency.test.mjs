import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('shared fields connect labels to their controls, including file uploads',()=>{
  const context={STATE:{view:'documents'},esc:String,isHRRole:()=>false,uploadModuleFolder:()=> 'documents',attachmentStorageProvider:()=> 'supabase',attachPreviewHTML:()=>'',MAX_ATTACH_BYTES:1048576,iPlus:()=>''};
  vm.createContext(context);vm.runInContext(section('function fieldHTML(','function clearModalFieldError('),context);
  for(const type of ['text','number','date','select','textarea','file']){
    const html=context.fieldHTML({key:'sample',label:'Sample',type,options:['One']},'');
    const id=type==='file'?'f_sample_file':'f_sample';
    assert.ok(html.includes(`for="${id}"`),type);
    assert.ok(html.includes(`id="${id}"`),type);
  }
});

function searchHarness(){
  let callback;const frames=[];
  const body={isConnected:true};
  const oldFilter={id:'filter',isConnected:true,getAttribute:()=> 'Filter status'};
  const newFilter={id:'filter',isConnected:true,focus(){context.document.activeElement=this;}};
  const host={classList:{add(){},remove(){}}};
  const input={id:'search',value:'Sample',selectionStart:3,selectionEnd:3,isConnected:true,closest:()=>host,getAttribute:()=>null};
  const next={value:'Sample',isConnected:true,closest:()=>host,focus(){context.document.activeElement=this;},setSelectionRange(start,end){this.selection=[start,end];}};
  const context={STATE:{view:'employees'},CSS:{escape:String},window:{scrollX:0,scrollY:0,scrollTo(){}},setTimeout:fn=>{callback=fn;return 1;},clearTimeout(){},requestAnimationFrame:fn=>frames.push(fn),document:{body,activeElement:input,querySelector:selector=>selector.includes('data-search-key')?next:newFilter,getElementById:()=>newFilter}};
  vm.createContext(context);vm.runInContext('const SEARCH_RENDER_TIMERS=new Map();'+section('function queueSearchRender(','function cancelSearchRender('),context);
  const render=()=>{input.isConnected=false;oldFilter.isConnected=false;context.document.activeElement=body;};
  return {context,input,next,oldFilter,newFilter,render,run:async()=>{await callback();frames.splice(0).forEach(fn=>fn());}};
}
test('search keeps the caret when it still owns focus',async()=>{
  const h=searchHarness();h.context.queueSearchRender(h.input,'search',h.render);await h.run();
  assert.equal(h.context.document.activeElement,h.next);assert.deepEqual(h.next.selection,[3,3]);
});
test('search preserves a filter selected before its debounce expires',async()=>{
  const h=searchHarness();h.context.queueSearchRender(h.input,'search',h.render);h.context.document.activeElement=h.oldFilter;await h.run();
  assert.equal(h.context.document.activeElement,h.newFilter);
});
test('search does not steal focus moved during an asynchronous render',async()=>{
  const h=searchHarness();const other={isConnected:true};
  h.context.queueSearchRender(h.input,'search',async()=>{h.render();h.context.document.activeElement=other;});await h.run();
  assert.equal(h.context.document.activeElement,other);
});

test('filtered leave results offer recovery instead of suggesting missing data',()=>{
  const host={innerHTML:''};const context={STATE:{search:'unmatched'},DB:{leaves:[{employeeName:'Sample',department:'Operations'}]},document:{getElementById:()=>host},esc:String,iSearch:()=>'',canExport:()=>false,LEAVE_STATUS:[]};
  vm.createContext(context);vm.runInContext(section('function renderLeaveRecords(','function renderLeaveSummary('),context);
  context.renderLeaveRecords();assert.match(host.innerHTML,/No matching leave records/);assert.match(host.innerHTML,/Clear search and filters/);assert.doesNotMatch(host.innerHTML,/Add a leave record/);
});

test('a single row action stays direct and receives an accessible name',()=>{
  const attrs={onclick:"openEmployeeProfile('synthetic')"};
  const button={textContent:'',title:'',getAttribute:key=>attrs[key],setAttribute:(key,value)=>attrs[key]=value};
  const group={dataset:{},querySelectorAll:()=>[button],replaceChildren(){assert.fail('A single action must not become a menu');}};
  const context={document:{querySelectorAll:()=>[group]},ROW_ACTION_MENUS:new Map()};
  vm.createContext(context);vm.runInContext(section('function rowActionLabel(','function openRowActionMenu('),context);
  context.enhanceRowActionMenus();
  assert.equal(attrs['aria-label'],'View details');assert.equal(group.dataset.menuEnhanced,'true');
});
