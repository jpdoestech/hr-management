// Browser-native integration checks over synthetic fixtures; no production session.
export const VIEWPORTS=[1440,1280,768,390,320];
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
function geometry(doc,width){
  assert(doc.documentElement.scrollWidth<=width+1,'Page-level horizontal overflow');
  for(const control of doc.querySelectorAll('.field input:not([type="checkbox"],[type="radio"],[type="hidden"],[type="file"]),.field select')){
    if(!control.getClientRects().length||control.closest('.employee-picker-input,.money-input,.tda-picker-input'))continue;
    assert(Math.abs(control.getBoundingClientRect().height-(width<=720?48:44))<1,'Form control height: '+control.id);
  }
}
async function directory({w,d,width}){
  const first=d.querySelector('tbody tr td').textContent;
  const started=performance.now();input(w,d.querySelector('#employee-directory-search'),'Employee 025');
  await until(()=>d.querySelectorAll('tbody tr').length===1&&d.querySelector('tbody')?.textContent.includes('Employee 025')&&d.activeElement?.id==='employee-directory-search','Search never settled');
  assert(d.activeElement.id==='employee-directory-search','Search lost keyboard focus');
  const searchMs=performance.now()-started;
  click(d,'.employee-filter-toggle');
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
  assert([...d.querySelectorAll('#register-form .auth-password button')].every(node=>node.getBoundingClientRect().height>=44),'Password action target too small');
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
  {id:'request-cards',path:'/fixtures/ui?view=portal'},
  {id:'attendance-failure-retry',path:'/fixtures/attendance',run:attendance},
  {id:'attendance-roster-error',path:'/fixtures/attendance?scenario=error',run:rosterError},
  {id:'attendance-refresh-loading',path:'/fixtures/attendance?scenario=slow',run:rosterSlow},
  {id:'cached-profile-performance',path:'/fixtures/modal',widths:[1440],run:profilePerformance},
  ...[250,10000].map(rows=>({id:'directory-performance-'+rows,path:'/fixtures/ui?rows='+rows,widths:[1440],run:directoryPerformance})),
];
export const expectedIds=()=>CASES.flatMap(test=>(test.widths||VIEWPORTS).map(width=>test.id+'@'+width));
async function loadFixture(iframe,path,width){
  iframe.width=String(width);iframe.height='900';
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
    try{const ctx=await loadFixture(iframe,test.path,width);const metrics=await test.run?.(ctx);geometry(ctx.d,width);assert(!(ctx.w.__fixtureErrors||[]).length,(ctx.w.__fixtureErrors||[]).join('; '));results.push({id,pass:true,durationMs:performance.now()-started,...(metrics?{metrics}:{})});item.textContent=id+' — PASS';item.className='pass';}
    catch(error){results.push({id,pass:false,durationMs:performance.now()-started,error:String(error.message).slice(0,600)});item.textContent=id+' — FAIL: '+error.message;item.className='fail';}
    status.textContent=results.length+' / '+expectedIds().length+' checks completed';
  }
  const failed=results.filter(row=>!row.pass).length;status.textContent=(failed?'FAIL':'PASS')+': '+(results.length-failed)+' / '+results.length+' checks';status.dataset.complete='true';
  const report={runId:new URLSearchParams(location.search).get('run'),results,fontMode:'offline-fallback'};
  await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
}
if(typeof document!=='undefined')runSuite().catch(error=>{document.getElementById('summary').textContent='Runner error: '+error.message;});
