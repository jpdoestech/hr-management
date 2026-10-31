// Browser-native integration checks over synthetic fixtures; no production session.
export const VIEWPORTS=[1920,1440,1280,1024,768,390,320];
const assert=(value,message)=>{if(!value)throw Error(message);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message='Timed out',timeout=6000){
  const start=performance.now();
  while(!predicate()){if(performance.now()-start>timeout)throw Error(message);await pause(20);}
}
const input=(w,node,value,type='input')=>{assert(node,'Input not found');node.focus();node.value=value;node.dispatchEvent(new w.Event(type,{bubbles:true}));};
const key=(w,node,value)=>node.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
const click=(doc,selector)=>{const node=doc.querySelector(selector);assert(node,'Missing '+selector);assert(!node.disabled,'Disabled '+selector);node.click();};
const visibleRows=table=>[...table.tBodies[0].rows].filter(row=>getComputedStyle(row).display!=='none');
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
export function contrastRatio(left,right){
  const luminance=rgb=>rgb.reduce((sum,value,i)=>{const n=value/255;return sum+[.2126,.7152,.0722][i]*(n<=.04045?n/12.92:((n+.055)/1.055)**2.4);},0);
  const a=luminance(left),b=luminance(right);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
function textContrast(node,pseudo){
  const w=node.ownerDocument.defaultView,parse=value=>(value.match(/[\d.]+/g)||[]).map(Number),layers=[];
  for(let current=node;current;current=current.parentElement)layers.unshift(parse(w.getComputedStyle(current).backgroundColor));
  const background=layers.reduce((rgb,layer)=>{const alpha=layer[3]??1;return rgb.map((v,i)=>(layer[i]??255)*alpha+v*(1-alpha));},[255,255,255]);
  const foreground=parse(w.getComputedStyle(node,pseudo).color).slice(0,3);
  return contrastRatio(foreground,background);
}
function geometry(doc,width){
  assert(doc.documentElement.scrollWidth<=width+1,'Page-level horizontal overflow');
  const main=doc.querySelector('#main');if(main?.getClientRects().length)assert(main.getBoundingClientRect().right>=doc.documentElement.clientWidth-1,'Workspace does not fill the available screen');
  for(const node of doc.querySelectorAll('.field label,.field-error,.field-help,.form-error-summary a,.page-size')){if(node.getClientRects().length)assert(textContrast(node)>=4.5,'Text contrast below 4.5: '+node.className);}
  for(const node of doc.querySelectorAll('input[placeholder]')){if(!node.value&&!node.disabled&&node.getClientRects().length)assert(textContrast(node,'::placeholder')>=4.5,'Placeholder contrast below 4.5: '+node.id);}
  for(const control of doc.querySelectorAll('.field input:not([type="checkbox"],[type="radio"],[type="hidden"],[type="file"]),.field select')){
    if(!control.getClientRects().length||control.closest('.employee-picker-input,.money-input,.tda-picker-input'))continue;
    assert(Math.abs(control.getBoundingClientRect().height-Math.max(width<=720?48:40,parseFloat(doc.defaultView.getComputedStyle(control).fontSize)*1.4+2))<1,'Form control height: '+control.id);
  }
}
async function directory({w,d,width}){
  const first=d.querySelector('tbody tr td').textContent;
  const started=performance.now();input(w,d.querySelector('#employee-directory-search'),'Employee 025');
  await until(()=>d.querySelectorAll('tbody tr').length===1&&d.querySelector('tbody')?.textContent.includes('Employee 025')&&d.activeElement?.id==='employee-directory-search','Search never settled');
  assert(d.activeElement.id==='employee-directory-search','Search lost keyboard focus');
  const searchMs=performance.now()-started;
  if(w.getComputedStyle(d.querySelector('.employee-filter-toggle')).display!=='none')click(d,'.employee-filter-toggle');
  let select=d.querySelector('.employee-filter-set select');input(w,select,'Operations','change');
  assert(d.activeElement.tagName==='SELECT','Filter lost keyboard focus');
  assert(d.querySelector('tbody').textContent.includes('No employees found'),'Department filter did not narrow the search');
  click(d,'button[onclick*="resetEmployeeDirectoryFilters"]');
  assert(d.querySelectorAll('tbody tr').length===25,'Directory did not recover 25-row page');
  click(d,'.page-buttons button[aria-label="Next page"]');
  await until(()=>d.querySelector('tbody tr td').textContent!==first,'Next page did not change records');
  assert(d.querySelectorAll('tbody tr').length===25,'Pagination lost bounded rows');
  input(w,d.querySelector('.page-size select'),'50','change');
  await until(()=>d.querySelectorAll('tbody tr').length===50,'Page-size change did not render 50 rows');
  assert(d.querySelector('.page-buttons .active')?.textContent==='1','Page-size change did not reset the page');
  geometry(d,width);return {searchMs};
}
async function history({w,d}){
  click(d,'[data-workspace-target="history"]');
  await until(()=>d.querySelector('[data-workspace-target="history"]')?.disabled,'History did not open');
  click(d,'[data-workspace-target="overview"]');
  await until(()=>d.querySelector('[data-workspace-target="overview"]')?.disabled,'Overview did not reopen');
  assert(d.querySelector('.employee-overview'),'Overview details missing');
  click(d,'[data-workspace-target="history"]');click(d,'[data-workspace-target="history"]');
  await until(()=>d.querySelector('[data-workspace-target="history"]')?.disabled,'Repeated navigation did not settle');
  assert(w.FIXTURE_STATE.profileOpens===3,'Repeated navigation opened duplicate profiles');
}
async function scoped({w,d}){
  const state=w.FIXTURE_STATE,before=JSON.stringify(state.employee);
  input(w,d.getElementById('f_emergencyContactName'),'Synthetic Updated Contact');
  click(d,'.modal-foot .btn-primary');
  const save=d.querySelector('.modal-foot .btn-primary');
  assert(save.disabled,'Save did not expose busy state');save.click();
  await until(()=>state.saveAttempts===1&&!save.disabled,'Failed save did not unlock retry');
  assert(JSON.stringify(state.employee)===before,'Failed save did not roll back the record');
  assert(d.getElementById('f_emergencyContactName').value==='Synthetic Updated Contact','Failed save discarded input');
  assert(d.querySelector('.modal-foot').dataset.message?.includes('failed'),'Failure feedback missing');
  click(d,'.modal-foot .btn-primary');
  await until(()=>d.querySelector('.employee-overview'),'Retry did not return to Overview');
  assert(state.saveAttempts===2,'Duplicate scoped-save request');
  assert(state.employee.emergencyContactName==='Synthetic Updated Contact','Retry did not persist');
  assert(state.employee.department==='Synthetic Department','Scoped save changed an unrelated group');
  assert(state.employee.recordHistory.length===1,'Failed/repeated save added duplicate history');
}
async function governmentIds({w,d}){
  const values={sssNumber:'0000012345',philHealthNumber:'000000001234',pagIbigNumber:'000000012345',tin:'000001234999'};
  for(const [field,value] of Object.entries(values))input(w,d.getElementById('f_'+field),value);
  const before=JSON.stringify(w.FIXTURE_STATE.employee);
  click(d,'.modal-foot .btn-primary');
  await until(()=>d.querySelectorAll('[aria-invalid="true"]').length===4,'Duplicate IDs did not receive field errors');
  assert(w.FIXTURE_STATE.saveAttempts===0,'Duplicate IDs reached persistence');
  assert([...d.querySelectorAll('.field-error')].every(node=>node.textContent.includes('Company Y | Sales | Merchandiser | Dela Cruz, Juan')),'Duplicate field errors lack owner context');
  assert(JSON.stringify(w.FIXTURE_STATE.employee)===before,'Duplicate ID rejection mutated the employee');
  for(const [field,value] of Object.entries(values))assert(d.getElementById('f_'+field).value.replace(/\D/g,'')===value,'Rejected ID entry was discarded');
  for(const [field,value] of Object.entries({sssNumber:'0000012346',philHealthNumber:'000000001235',pagIbigNumber:'000000012346',tin:'000001235000'}))input(w,d.getElementById('f_'+field),value);
  click(d,'.modal-foot .btn-primary');
  await until(()=>d.querySelector('.employee-overview'),'Unique ID correction did not save');
  assert(w.FIXTURE_STATE.saveAttempts===1,'Correction saved an unexpected number of times');
}
async function unsaved({w,d}){
  input(w,d.getElementById('f_emergencyContactName'),'Synthetic Unsaved Contact');
  click(d,'[data-workspace-target="overview"]');
  await until(()=>d.querySelector('#data-confirm-overlay.on'),'Unsaved edits were not guarded');
  click(d,'#data-confirm-cancel');
  await until(()=>!d.querySelector('#data-confirm-overlay.on'));
  assert(d.getElementById('f_emergencyContactName')?.value==='Synthetic Unsaved Contact','Keep editing discarded edits');
  click(d,'[data-workspace-target="overview"]');
  await until(()=>d.querySelector('#data-confirm-overlay.on'));
  click(d,'#data-confirm-discard');
  await until(()=>d.querySelector('.employee-overview'),'Discard did not return to Overview');
  assert(w.FIXTURE_STATE.saveAttempts===0,'Discard wrote data');
  assert(w.FIXTURE_STATE.employee.emergencyContactName==='Synthetic Contact','Discard changed the record');
}
async function controls({w,d,width}){
  const search=d.getElementById('control_employee_search');input(w,search,'SYNTHETIC');key(w,search,'ArrowDown');key(w,search,'Enter');
  assert(d.getElementById('control_employee_picker').dataset.selectedId==='synthetic','Keyboard picker selection failed');
  key(w,search,'ArrowDown');key(w,search,'Escape');assert(d.getElementById('control_employee_options').hidden,'Picker Escape did not close');
  assert(d.activeElement===search,'Picker did not keep input focus');
  assert(parseFloat(w.getComputedStyle(search).outlineWidth)>0,'Picker keyboard focus not visible');
  assert(!d.getElementById('control_hidden').getClientRects().length,'Hidden input became visible');
  const box=d.getElementById('control_checkbox');box.click();assert(box.checked,'Native checkbox did not toggle');
  assert(d.getElementById('control_disabled').disabled,'Disabled control became editable');
  geometry(d,width);
}
async function validation({d}){
  click(d,'button.fixture-validation');
  assert(d.querySelectorAll('.field-error').length===2,'Inline field errors missing');
  const field=d.getElementById('f_lastName');
  assert(field.getAttribute('aria-invalid')==='true','Invalid state missing');
  assert(field.getAttribute('aria-describedby')?.split(' ').some(id=>d.getElementById(id)),'Error association missing');
}
async function tables({w,d,width}){
  const table=d.querySelector('table');click(d,'table .table-column-menu-button');click(d,'[data-sort="desc"]');
  await until(()=>table.tBodies[0].rows[0].textContent.includes('SAMPLE-002'),'Descending sort failed');
  click(d,'table .table-column-menu-button');const filter=d.querySelector('.table-column-filter-label input');input(w,filter,'SAMPLE-001');key(w,filter,'Enter');
  await until(()=>visibleRows(table).length===1,'Column filter failed');
  assert(visibleRows(table)[0].textContent.includes('SAMPLE-001'),'Column filter kept wrong row');
  click(d,'table .table-column-menu-button');click(d,'.table-column-clear');
  await until(()=>visibleRows(table).length===2,'Clearing column filter did not restore rows');geometry(d,width);
}
async function registration({d,width}){
  click(d,'#tab-register');await until(()=>d.getElementById('register-form').getClientRects().length,'Registration did not open');geometry(d,width);
  assert([...d.querySelectorAll('#register-form .auth-password button')].every(node=>node.getBoundingClientRect().height>=(width<=720?44:40)),'Password action target too small');
}
async function attendance({w,d,width}){
  await until(()=>d.querySelector('.attendance-grid'),'Attendance roster missing');
  assert([...d.querySelectorAll('.attendance-grid input')].every(e=>e.getBoundingClientRect().height===16),'Attendance checkbox resized');
  assert(w.getComputedStyle(d.querySelector('.attendance-frozen')).position==='sticky','Employee column not sticky');
  const day=d.querySelector('.attendance-cell[data-row="0"][data-col="0"]');day.focus();key(w,day,'Enter');
  await until(()=>d.querySelector('.attendance-change-count')?.textContent.includes('1 changed'),'Day was not staged');
  input(w,d.querySelector('[name="reference"]'),'FAIL');
  const save=d.querySelector('[data-action="save"]');save.click();save.click();
  await until(()=>d.getElementById('fixture-notice').textContent.includes('concurrently'),'Save error not reported');
  assert(w.FIXTURE_STATE.saves===1,'Repeated save submitted duplicate batches');
  assert(d.querySelector('.attendance-change-count').textContent.includes('1 changed'),'Failed batch lost staged edits');
  input(w,d.querySelector('[name="reference"]'),'Synthetic retry');click(d,'[data-action="save"]');
  await until(()=>d.getElementById('fixture-notice').textContent.includes('Attendance batch saved'),'Retry did not save');
  assert(w.FIXTURE_STATE.saves===2,'Retry count incorrect');assert(d.querySelector('.attendance-change-count').textContent.includes('0 changed'),'Saved draft was not cleared');geometry(d,width);
}
async function lateEditor({w,d},basic){
  await until(()=>d.querySelector('.attendance-grid'),'Attendance roster missing');
  const cell=()=>d.querySelector('.attendance-cell[data-row="0"][data-col="0"]');
  const open=()=>{click(d,'[data-brush="Late/Undertime"]');key(w,cell(),'Enter');};
  const form=()=>d.querySelector(basic?'#attendance-minutes':'#attendance-times');
  const cancel=()=>click(d,(basic?'#attendance-minutes':'#attendance-times')+' .modal-foot button[type="button"]');
  const stage=async()=>{form().requestSubmit();await until(()=>!d.querySelector('#overlay.on'),'Editor did not close');};
  const late=()=>d.querySelector(basic?'#att_lateMinutes':'#att_start0');
  const out=()=>d.querySelector(basic?'#att_undertimeMinutes':'#att_end1');
  const count=()=>d.querySelector('.attendance-change-count').textContent;
  open();input(w,late(),basic?'15':'08:15');cancel();
  assert(count().includes('0 changed'),'Cancel staged a new entry');
  open();if(basic)input(w,d.querySelector('#att_scheduledMinutes'),'420');
  input(w,late(),basic?'15':'08:15');input(w,out(),basic?'20':'16:40');await stage();
  assert(cell().textContent==='L 15 / UT 20','Late/UT was not staged');
  const prefill=()=>{assert(late().value===(basic?'15':'08:15'),'Reopening lost late value');assert(out().value===(basic?'20':'16:40'),'Reopening lost UT value');if(basic)assert(d.querySelector('#att_scheduledMinutes').value==='420','Reopening lost scheduled minutes');};
  open();prefill();input(w,late(),basic?'30':'08:30');cancel();
  assert(cell().textContent==='L 15 / UT 20','Cancel replaced staged values');
  open();prefill();await stage();click(d,'[data-action="undo"]');
  assert(count().includes('0 changed'),'Unchanged restaging added an undo frame');
  click(d,'[data-action="redo"]');assert(cell().textContent==='L 15 / UT 20','Redo lost entry');
  if(basic){
    click(d,'[data-brush="Present"]');key(w,cell(),'Enter');open();
    assert(d.querySelector('#att_scheduledMinutes').value==='420','Transaction change lost unsaved scheduled minutes');cancel();
    click(d,'[data-action="undo"]');
  }
  input(w,d.querySelector('[name="reference"]'),'Synthetic Late/UT regression');click(d,'[data-action="save"]');
  await until(()=>count().includes('0 changed'),'Late/UT save did not finish');
  open();prefill();input(w,late(),basic?'30':'08:30');await stage();
  assert(cell().textContent==='L 30 / UT 20','Changing saved late value lost UT');
  click(d,'[data-action="undo"]');assert(cell().textContent==='L 15 / UT 20'&&count().includes('0 changed'),'Undo lost saved entry');
  open();prefill();cancel();assert(count().includes('0 changed'),'Cancel changed saved entry');
}
async function replaceLegacyLate({w,d}){
  await until(()=>d.querySelector('.attendance-grid'),'Attendance roster missing');
  for(const [col,transaction] of ['Present','Day-off','Absent'].entries()){
    const day=()=>d.querySelector(`.attendance-cell[data-row="0"][data-col="${col}"]`);
    assert(day().textContent.includes('L 15 / UT 20'),'Legacy late entry missing');
    click(d,`[data-brush="${transaction}"]`);key(w,day(),'Enter');
    assert(day().getAttribute('aria-label').endsWith(transaction),'Replacement blocked: '+transaction);
    assert(!day().textContent.includes('L 15'),'Replacement retained lost minutes');
  }
  assert(d.querySelector('.attendance-change-count').textContent.includes('3 changed'),'Corrections not staged');
  input(w,d.querySelector('[name="reference"]'),'Synthetic mistaken Late/UT correction');click(d,'[data-action="save"]');
  await until(()=>d.querySelector('.attendance-change-count').textContent.includes('0 changed'),'Corrections not saved');
  for(const [col,transaction] of ['Present','Day-off','Absent'].entries()){
    const day=d.querySelector(`.attendance-cell[data-row="0"][data-col="${col}"]`);
    assert(day.getAttribute('aria-label').endsWith(transaction),'Saved replacement lost: '+transaction);
    click(d,'[data-brush="Late/Undertime"]');key(w,d.querySelector(`.attendance-cell[data-row="0"][data-col="${col}"]`),'Enter');
    assert(d.querySelector('#att_scheduledMinutes').value==='420','Correction lost scheduled minutes');
    assert(d.querySelector('#att_lateMinutes').value==='0'&&d.querySelector('#att_undertimeMinutes').value==='0','Correction did not clear both losses');
    click(d,'#attendance-minutes .modal-foot button[type="button"]');
  }
  assert(!d.querySelector('#fixture-notice').textContent.includes('valid scheduled'),'Legacy validation error shown');
}
async function rosterError({d}){
  await until(()=>d.querySelector('[data-action="reload"]'),'Roster error did not offer retry');
  assert(d.querySelector('.attendance-roster-count')?.textContent.includes('unavailable'),'Failed roster presented fake employee count');
  click(d,'[data-action="reload"]');await until(()=>d.querySelector('.attendance-grid'),'Roster retry failed');
}
async function rosterSlow({w,d}){
  await until(()=>d.querySelector('.attendance-grid'));
  click(d,'[data-action="filters-clear"]');
  await until(()=>w.FIXTURE_STATE.queries===2,'Refresh request missing');
  assert(d.querySelector('.attendance-preparation').getAttribute('aria-busy')==='true','Roster refresh lacks accessible loading state');
  await until(()=>!d.querySelector('.attendance-preparation[aria-busy="true"]'),'Busy state did not clear');
  assert(d.querySelector('.attendance-grid'),'Refresh removed existing records');
}
async function controlFamilies({w,d,width}){
  const touch=width<=720;
  for(const node of d.querySelectorAll('.data-toolbar .btn,.workflow-toolbar .btn,.quality-toolbar .btn,.automation-toolbar .btn,.analytics-toolbar .btn,.access-toolbar .btn,.searchbox')){
    if(!node.getClientRects().length)continue;
    assert(Math.abs(node.getBoundingClientRect().height-(touch?44:36))<1,'Toolbar family height: '+node.className);
  }
  for(const node of d.querySelectorAll('.tablewrap input[type="number"],.tablewrap select'))assert(Math.abs(node.getBoundingClientRect().height-(touch?44:36))<1,'Dense table editor height');
  for(const node of d.querySelectorAll('.field label'))assert(d.getElementById(node.htmlFor),'Missing label-control association');
  const textarea=d.querySelector('.field textarea');if(textarea)assert(textarea.getBoundingClientRect().height>=96,'Multiline control was compacted');
  const search=d.querySelector('.searchbox input');if(search){search.focus();assert(parseFloat(w.getComputedStyle(search).outlineWidth)>0||w.getComputedStyle(search.closest('.searchbox')).boxShadow!=='none','Search focus is missing');}
}
async function enlargedText({w,d,width}){
  d.documentElement.style.setProperty('--form-control-font',width<=720?'32px':'28px');
  d.documentElement.style.setProperty('--workspace-control-font',width<=720?'32px':'26px');
  d.documentElement.style.setProperty('--form-label-size','26px');
  await pause(0);
  for(const node of d.querySelectorAll('.field input:not([type="hidden"],[type="checkbox"],[type="radio"],[type="file"]),.field select')){
    const style=w.getComputedStyle(node),line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.4;
    assert(node.clientHeight+1>=line+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),'Enlarged control text clipped: '+node.id);
  }
}
async function directoryPerformance(ctx){
  const {w,d}=ctx,samples=[];
  for(let n=0;n<8;n++){const start=performance.now();w.renderEmployees();const duration=performance.now()-start;await pause(0);if(n)samples.push(duration);assert(d.querySelectorAll('tbody tr').length===25,'Performance case rendered unbounded rows');}
  assert(samples.every(Number.isFinite),'Invalid performance measurement');
  return {rows:Number(new URL(w.location.href).searchParams.get('rows')||250),renderMedianMs:median(samples),renderMaxMs:Math.max(...samples)};
}
async function profilePerformance({w,d}){
  const samples=[];
  for(let n=0;n<8;n++){const started=performance.now();await w.openEmployeeProfile('synthetic');const duration=performance.now()-started;await pause(0);if(n)samples.push(duration);assert(d.querySelector('.employee-overview'),'Cached profile did not render');}
  return {profileMedianMs:median(samples),profileMaxMs:Math.max(...samples)};
}
export const CASES=[
  {id:'form-geometry',path:'/fixtures/modal?view=Edit'},
  {id:'picker-and-controls',path:'/fixtures/modal?view=Controls',run:controls},
  {id:'history-overview',path:'/fixtures/modal?slow=1',run:history},
  {id:'viewer-history-overview',path:'/fixtures/modal?readonly=1&slow=1',run:history},
  {id:'scoped-failure-retry',path:'/fixtures/modal?section=1&fail-once=1&slow=1',run:scoped},
  {id:'government-id-duplicates',path:'/fixtures/modal?section=2&government-duplicate=1',run:governmentIds},
  {id:'unsaved-edit-guard',path:'/fixtures/modal?section=1',run:unsaved},
  {id:'field-errors',path:'/fixtures/modal?view=Edit',run:validation},
  {id:'directory-search-filters-pages',path:'/fixtures/ui?admin=1',run:directory},
  {id:'table-sort-filter-recovery',path:'/fixtures/ui?view=tables',run:tables},
  {id:'registration',path:'/fixtures/workspace?view=auth',run:registration},
  {id:'shared-control-families',path:'/fixtures/ui?view=controls',run:controlFamilies},
  {id:'manpower-editors',path:'/fixtures/ui?view=manpower',run:controlFamilies},
  {id:'workspace-settings',path:'/fixtures/workspace?view=settings'},
  {id:'workspace-dashboard',path:'/fixtures/workspace?view=dashboard'},
  {id:'long-filter-values',path:'/fixtures/ui?admin=1&long=1&filters=1'},
  ...['Status','Transfer','Lifecycle','Incident'].map(view=>({id:'dialog-'+view.toLowerCase(),path:'/fixtures/modal?view='+view})),
  {id:'request-cards',path:'/fixtures/ui?view=portal'},
  {id:'attendance-failure-retry',path:'/fixtures/attendance',run:attendance},
  {id:'attendance-late-times',path:'/fixtures/attendance',widths:[1440,390],run:ctx=>lateEditor(ctx,false)},
  {id:'attendance-late-minutes',path:'/fixtures/attendance?scenario=employee',widths:[1440,390],run:ctx=>lateEditor(ctx,true)},
  {id:'attendance-replace-legacy-late',path:'/fixtures/attendance?scenario=legacy',widths:[1440,390],run:replaceLegacyLate},
  {id:'attendance-roster-error',path:'/fixtures/attendance?scenario=error',run:rosterError},
  {id:'attendance-refresh-loading',path:'/fixtures/attendance?scenario=slow',run:rosterSlow},
  {id:'zoom-equivalent-reflow',path:'/fixtures/ui?admin=1&filters=1',widths:[960],height:540},
  {id:'short-phone-dialog',path:'/fixtures/modal?view=Edit',widths:[320],height:568,run:({w,d})=>assert(d.querySelector('.modal-foot').getBoundingClientRect().bottom<=w.innerHeight,'Dialog actions are offscreen')},
  {id:'enlarged-control-text',path:'/fixtures/modal?view=Controls',widths:[1440,390],run:enlargedText},
  {id:'cached-profile-performance',path:'/fixtures/modal',widths:[1440],run:profilePerformance},
  ...[250,10000].map(rows=>({id:'directory-performance-'+rows,path:'/fixtures/ui?rows='+rows,widths:[1440],run:directoryPerformance})),
];
export const expectedIds=()=>CASES.flatMap(test=>(test.widths||VIEWPORTS).map(width=>test.id+'@'+width));
async function loadFixture(iframe,path,width,height=900){
  iframe.width=String(width);iframe.height=String(height);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture load timed out')),8000);iframe.onload=()=>{clearTimeout(timer);resolve();};iframe.src=path;});
  const w=iframe.contentWindow,d=w.document;
  await until(()=>d.readyState==='complete','Fixture not ready');await d.fonts.ready;
  if(!path.includes('/attendance'))await until(()=>d.getElementById('fixture-checks'),'Computed-style checks did not finish');
  const check=d.getElementById('fixture-checks');assert(!check||check.textContent.startsWith('PASS'),check?.textContent);
  assert(!(w.__fixtureErrors||[]).length,(w.__fixtureErrors||[]).join('; '));
  return {w,d,width};
}
async function runSuite(){
  const results=[],iframe=document.getElementById('preview'),list=document.getElementById('results'),status=document.getElementById('summary');
  for(const test of CASES)for(const width of test.widths||VIEWPORTS){
    const id=test.id+'@'+width,item=document.createElement('li');item.textContent=id+' — running';list.append(item);const started=performance.now();
    try{const ctx=await loadFixture(iframe,test.path,width,test.height||900);const metrics=await test.run?.(ctx);geometry(ctx.d,width);assert(!(ctx.w.__fixtureErrors||[]).length,(ctx.w.__fixtureErrors||[]).join('; '));results.push({id,pass:true,durationMs:performance.now()-started,...(metrics?{metrics}:{})});item.textContent=id+' — PASS';item.className='pass';}
    catch(error){results.push({id,pass:false,durationMs:performance.now()-started,error:String(error.message).slice(0,600)});item.textContent=id+' — FAIL: '+error.message;item.className='fail';}
    status.textContent=results.length+' / '+expectedIds().length+' checks completed';
  }
  const failed=results.filter(row=>!row.pass).length;status.textContent=(failed?'FAIL':'PASS')+': '+(results.length-failed)+' / '+results.length+' checks';status.dataset.complete='true';
  const report={runId:new URLSearchParams(location.search).get('run'),results,fontMode:'offline-fallback'};
  await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
}
if(typeof document!=='undefined')runSuite().catch(error=>{document.getElementById('summary').textContent='Runner error: '+error.message;});
