import {MATRIX_TRANSACTIONS,attendanceKey,cutoffDates,createMatrixDraft,matrixInput,compatibleTimeInputs,assumedTransaction,rectangleCells,matrixPeriod,matrixSummary} from './attendance-matrix.js?v=20261031-1';
import {WAGE_DAY_TYPES} from './attendance-wage-rules.js';

export function createAttendancePreparation(api){
  const {supabase,esc,permission,confirm,toast}=api;
  const ownerId=api.actor().id,active=()=>api.actor()?.id===ownerId&&api.isActive?.()!==false;
  const state={cutoff:null,month:api.today().slice(0,7),period:Number(api.today().slice(8))>15?'second':'first',location:'',locations:[],rows:[],dates:[],page:1,size:25,total:0,search:'',department:'',position:'',brush:'Present',leave:'Unpaid Leave',mode:'present',selected:new Set(),draft:createMatrixDraft(),busy:false,sequence:0,clients:[],configs:[],paint:true,reference:''};
  let root,gesture=null,searchTimer,loadError='';
  const button=(action,label,disabled=false)=>`<button type="button" class="btn btn-ghost btn-sm" data-action="${action}" title="${esc(action.replaceAll('-',' '))}" ${label.replace(/<[^>]+>/g,'').trim()?'':`aria-label="${esc(action)}"`} data-confirm-change="false" ${disabled?'disabled':''}>${label}</button>`;
  const select=(name,values,value,empty='')=>`<select name="${name}" aria-label="${esc(({period:'Attendance cutoff',location:'Assignment location',leave:'Leave treatment',duty:'Holiday or rest-day duty',brush:'Attendance transaction',mode:'Blank-day encoding preference',department:'Department',position:'Position',size:'Employees per page',clientId:'Client',kind:'Configuration kind',statutoryId:'Statutory version'})[name]||name)}">${empty?`<option value="">${esc(empty)}</option>`:''}${values.map(v=>{const [key,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`;}).join('')}</select>`;
  const input=(name,label,type='text',value='',extra='')=>`<div class="field"><label for="att_${name}">${label}</label><input id="att_${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  const call=async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw Error(['40001','40P01','23505'].includes(error.code)?'Data changed concurrently. Reload and review; nothing in this batch was saved.':error.message||'Attendance operation failed.');return data;};
  const host=()=>api.content();
  function alertError(error){toast(error.message||String(error),true);}
  async function canLeave(){
    if(!active()){state.draft.reset();return true;}
    if(state.busy)return false;
    if(!state.draft.count)return true;
    const choice=await confirm({title:'Unsaved attendance',message:'Discard the staged attendance changes?',confirmLabel:'Discard changes',cancelLabel:'Keep editing',warning:true});
    if(choice!==true&&choice!=='confirm')return false;state.draft.reset();return true;
  }
  function bind(){root=host().querySelector('.attendance-preparation');root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',typing);root.addEventListener('keydown',keyboard);root.addEventListener('contextmenu',contextMenu);root.addEventListener('pointerdown',pointerStart);root.addEventListener('pointermove',pointerMove);root.addEventListener('pointerup',pointerEnd);root.addEventListener('pointercancel',()=>{gesture=null;clearHighlights();});}
  async function open(force=false){
    if(!force&&root?.isConnected)return;
    host().innerHTML='<div class="attendance-loading" role="status">Loading attendance preparation…</div>';
    try{
      const options=await call('attendance_preparation_options',{});state.clients=options.clients||[];state.locations=options.locations||[];
      if(!active())return;
      const {data,error}=await supabase.from('hr_attendance_preferences').select('blank_mode').eq('user_id',api.actor().id).maybeSingle();if(error)throw error;state.mode=data?.blank_mode||'present';
      if(active()){state.cutoff={...matrixPeriod(state.month,state.period),branch:'',clientId:''};await load();}
    }catch(error){if(!active())return;host().innerHTML=`<div class="attendance-preparation"><div class="data-toolbar">${button('records','Back to records')}${button('retry','Retry')}</div><div class="notice" role="alert">${esc(error.message)}. Attendance matrix requires migrations through 0064; existing records remain available.</div></div>`;bind();}
  }
  async function list(){
    if(!(await canLeave()))return;
    state.cutoff=null;
    const {data,error}=await supabase.from('hr_attendance_cutoffs').select('id,data,created_at',{count:'exact'}).order('created_at',{ascending:false}).range((state.page-1)*25,state.page*25-1);
    if(error)throw error;
    if(!active())return;
    host().innerHTML=`<section class="attendance-preparation"><div class="data-toolbar">${button('matrix',`${api.icons.back} Attendance matrix`)}<span class="toolbar-spacer"></span>${permission('attendance.manage')?button('setup',`${api.icons.settings} Configuration`):''}${permission('attendance.create')?button('new',`${api.icons.plus} New cutoff`):''}</div><div class="attendance-matrix-viewport"><table class="data-table"><thead><tr><th>Cutoff</th><th>Branch</th><th>Client</th><th>Payout</th><th></th></tr></thead><tbody>${(data||[]).map(row=>`<tr><td>${esc(row.data.start)} – ${esc(row.data.end)}</td><td>${esc(row.data.branch)}</td><td>${esc(state.clients.find(c=>c.id===row.data.clientId)?.name||'Assigned client')}</td><td>${esc(row.data.payout||'—')}</td><td><button class="btn btn-ghost btn-sm" data-open="${esc(row.id)}">Open</button></td></tr>`).join('')||'<tr><td colspan="5">No cutoffs in your scope.</td></tr>'}</tbody></table></div><footer class="attendance-matrix-footer">${button('list-prev','Previous',state.page===1)}<span>Page ${state.page}</span>${button('list-next','Next',(data||[]).length<25)}</footer></section>`;
    state.cutoffs=data||[];bind();
  }
  function cutoffForm(){
    api.openModal(`<div class="modal-head"><h3>New attendance cutoff</h3><button type="button" onclick="closeModal()" aria-label="Close">&times;</button></div><form id="attendance-cutoff-form"><div class="modal-body formgrid">${input('start','From','date',api.today().slice(0,7)+'-01','required')}${input('end','To','date',api.today(),'required')}${input('branchReporting','Branch','text','','required maxlength="60"')}<div class="field"><label for="att_client">Client</label>${select('clientId',state.clients.map(c=>[c.id,c.name]),'','Select client')}</div>${input('payout','Payout (optional)','date')}</div><div class="modal-foot"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-confirm-change="false">Open cutoff</button></div></form>`);
    document.getElementById('attendance-cutoff-form').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
      try{cutoffDates(values.start,values.end);if(values.payout&&values.payout<values.end)throw Error('Payout cannot precede the cutoff end.');if(!values.clientId)throw Error('Select a client.');
        if(!(await accepted('Create attendance cutoff','Create this preparation cutoff? No attendance is inferred or saved.')))return;
        const row=await call('create_attendance_cutoff',{p_data:values});await api.closeModal();state.cutoff={...row.data,id:row.id};state.period='custom';state.month=values.start.slice(0,7);state.page=1;await load();
      }catch(error){alertError(error);}
    });
  }
  async function accepted(title,message){const result=await confirm({title,message,confirmLabel:'Confirm',cancelLabel:'Cancel'});return result===true||result==='confirm';}
  async function load(){
    if(!active())return;
    const token=++state.sequence;state.busy=true;
    if(!root?.querySelector('.attendance-grid'))host().innerHTML='<div role="status" class="attendance-loading">Loading scoped employee-days…</div>';
    const busyRegion=host().querySelector('.attendance-preparation');busyRegion?.setAttribute('aria-busy','true');
    try{
      state.dates=cutoffDates(state.cutoff.start,state.cutoff.end);
      const data=await call('query_attendance_matrix',{p_cutoff:state.cutoff,p_search:state.search,p_department:state.department,p_position:state.position,p_offset:(state.page-1)*state.size,p_limit:state.size});
      if(token!==state.sequence)return;if(!active()){state.busy=false;return;}loadError='';state.rows=data.rows||[];state.total=data.total||0;state.selected.clear();state.busy=false;render();
    }catch(error){if(token!==state.sequence||!active())return;state.busy=false;loadError=error.message||'Attendance operation failed.';state.rows=[];state.total=0;render();alertError(error);}
    finally{if(token===state.sequence)busyRegion?.removeAttribute('aria-busy');}
  }
  function render(){
    const locations=state.locations.map((l,i)=>[String(i),`${l.branch} / ${l.client_id?state.clients.find(c=>c.id===l.client_id)?.name||'Client':'Employees'}`]);
    const duties=[MATRIX_TRANSACTIONS[5],...MATRIX_TRANSACTIONS.slice(8)].map(([name])=>[name,name]);
    host().innerHTML=`<section class="attendance-preparation"><nav class="attendance-view-tabs" aria-label="Attendance views"><button type="button" aria-current="page">Attendance matrix</button>${button('records','Records & KPIs')}</nav><div class="data-toolbar attendance-matrix-toolbar"><div class="attendance-period-controls"><input type="month" name="month" aria-label="Attendance month" value="${esc(state.month)}">${select('period',[['first','1–15'],['second','16–End'],['month','Full month'],['custom','Custom dates']],state.period)}${state.period==='custom'?`<input type="date" name="start" aria-label="Cutoff start" value="${state.cutoff.start}"><input type="date" name="end" aria-label="Cutoff end" value="${state.cutoff.end}">`:''}</div><div class="searchbox">${api.icons.search}<input aria-label="Search assigned employees" name="search" value="${esc(state.search)}" placeholder="Search employee…"></div><button type="button" class="btn btn-ghost btn-sm attendance-filter-toggle" data-action="filters-toggle" aria-controls="attendance-filter-panel" aria-expanded="${state.filtersOpen===true}">${api.icons.filter||''}<span>Filters${state.department||state.position||state.location?' •':''}</span></button>${api.canExport?.()?button('export',(api.icons.export||'')+' Export'):''}<details class="attendance-tools"><summary>${api.icons.more||''}<span>More</span></summary><div class="attendance-tools-panel"><div class="attendance-tools-header"><strong>Attendance tools</strong>${button('tools-close',(api.icons.clear||'')+' Close')}</div><section><h4>Workspace</h4>${button('reload',api.icons.refresh+' Reload')}${button('back',(api.icons.calendar||'')+' Saved cutoffs')}${permission('attendance.create')?button('new',api.icons.plus+' Save custom cutoff'):''}${permission('attendance.manage')?button('setup',api.icons.settings+' Holidays & schedules'):''}</section><section><h4>Encoding</h4><label class="attendance-menu-preference"><span>Blank-day preference</span>${select('mode',[['present','Blanks: assumed Present'],['absent','Blanks: assumed Absent']],state.mode)}</label><div class="attendance-mobile-tools"><label class="attendance-menu-preference"><span>Holiday / rest-day duty</span>${select('duty',duties,state.brush,'Holiday / rest-day duty')}</label></div>${button('paint',(api.icons.pointer||'')+(state.paint?' Switch to scroll mode':' Switch to paint mode'))}</section><section><h4>Batch actions</h4>${button('defaults-selected',(api.icons.check||'')+' Confirm selected defaults')}${button('defaults-page',(api.icons.check||'')+' Confirm page defaults')}${permission('attendance.manage')?button('review',(api.icons.check||'')+' Approve selected records'):''}${button('clear',(api.icons.clear||'')+' Clear changes',!state.draft.count)}</section></div></details><div id="attendance-filter-panel" class="attendance-filter-fields" data-open="${state.filtersOpen===true}"><label><span>Assignment location</span>${select('location',locations,state.location,'All assignment locations')}</label><label><span>Department</span>${select('department',api.departments(),state.department,'All departments')}</label><label><span>Position</span>${select('position',api.positions(),state.position,'All positions')}</label>${button('filters-clear',(api.icons.clear||'')+' Clear filters')}</div></div>
      <div class="attendance-paint-toolbar"><div class="attendance-brushes" role="group" aria-label="Attendance transactions">${[['Present','Present'],['Absent','Absent'],['leave','Leave'],['Day-off','Day-off'],['AWOL/AWOP','AWOL/P'],['Late/Undertime','Late / UT']].map(([value,label])=>`<button type="button" class="attendance-brush" data-brush="${value}" aria-pressed="${value==='leave'?['Paid Leave','Unpaid Leave'].includes(state.brush):state.brush===value}">${label}</button>`).join('')}</div>${['Paid Leave','Unpaid Leave'].includes(state.brush)?select('leave',['Paid Leave','Unpaid Leave'],state.leave):''}${select('duty',duties,state.brush,'Holiday / rest-day duty')}${button('undo',api.icons.undo,state.busy||!state.draft.canUndo)}${button('redo',api.icons.redo,state.busy||!state.draft.canRedo)}<span role="status" class="attendance-change-count">${state.draft.count} changed days</span><span class="attendance-roster-count">${loadError?'Roster unavailable':`${state.total} employee(s)`}</span></div>
      <div class="attendance-matrix-viewport">${state.rows.length?`<table class="attendance-grid ${state.paint?'paint-mode':''}" aria-label="Cutoff attendance"><thead><tr><th class="attendance-frozen" scope="col"><label><input type="checkbox" name="selectPage" aria-label="Select page employees"> Employee</label></th>${state.dates.map(date=>`<th scope="col"><span>${Number(date.slice(8))}</span><small>${new Date(date+'T00:00:00Z').toLocaleDateString('en',{weekday:'short',timeZone:'UTC'})}</small></th>`).join('')}${['Absent','Day-off','Leave','AWOL/P','Late/UT min','Present'].map(label=>`<th scope="col" class="attendance-summary">${label}</th>`).join('')}</tr></thead><tbody>${rowsHTML()}</tbody></table>`:rowsHTML()}</div>
      <footer class="attendance-matrix-footer"><input aria-label="DTR / attendance reference" name="reference" maxlength="1000" value="${esc(state.reference)}" placeholder="DTR / attendance reference"><span class="toolbar-spacer"></span>${select('size',['25','50','100'],String(state.size))}${button('prev','Previous',state.page===1)}<span>Page ${state.page}</span>${button('next','Next',state.page*state.size>=state.total)}${button('save',api.icons.save+' Save changes',state.busy||!state.draft.count||!canWrite())}</footer><div class="attendance-matrix-message" role="status">${state.mode==='present'?'Scheduled blanks = assumed Present':'Scheduled blanks = assumed Absent'} · Unconfirmed; not saved attendance. Employee-only days stay unrecorded (480 scheduled minutes; edit via Late/UT).</div></section>`;
    bind();
  }
  function canWrite(cell){return !loadError&&(cell?cell.context?.writable!==false&&permission(cell.record?'attendance.update':'attendance.create'):permission('attendance.create')||permission('attendance.update'));}
  function rowsHTML(){
    if(loadError)return `<div class="notice" role="alert"><b>Employee roster could not be loaded.</b> ${esc(loadError)} ${button('reload','Retry')}</div>`;
    const edits=state.draft.edits;
    return state.rows.map((row,r)=>`<tr><th class="attendance-frozen" scope="row"><label><input type="checkbox" data-employee="${esc(row.id)}" ${state.selected.has(row.id)?'checked':''}><span>${esc(row.name)}<small>${esc(row.employeeNo)}</small></span></label></th>${state.dates.map((date,c)=>{
      const cell=row.days[date],edit=edits[attendanceKey(row.id,date)],record=edit||cell?.record;
      const assumed=cell?assumedTransaction(cell,state.mode):null,label=record?.transaction||record?.status||(assumed?`Assumed ${assumed}`:cell?.context?.recordingReady?'Not recorded':'Needs Review');
      const code=!record?'–':record.lateMinutes||record.undertimeMinutes?`L ${record.lateMinutes||0} / UT ${record.undertimeMinutes||0}`:label==='AWOL/AWOP'?'AWOL/P':record.status==='Absent'?'ABSENT':record.status==='Approved Leave'?'LEAVE':label==='Day-off'?'DAY-OFF':MATRIX_TRANSACTIONS.find(([name])=>name===label)?.[1]||'P';
      const tone=!record?'blank':record.status==='Absent'?'absent':record.status==='Approved Leave'?'leave':record.status==='Rest Day / Holiday'?'off':record.lateMinutes||record.undertimeMinutes?'late':'present';
      return `<td><button type="button" data-row="${r}" data-col="${c}" class="attendance-cell attendance-tone-${tone} ${edit?'changed':''} ${!record?'unconfirmed':''}" aria-label="${esc(row.name)}, ${date}, ${esc(label)}${cell?.posted?', payroll posted':''}" title="${esc(cell?.posted?'Payroll posted':cell?.context?.reason||label)}" ${!(cell?.context?.ready||cell?.context?.recordingReady)||cell?.posted||!canWrite(cell)?'disabled':''}>${esc(code)}${cell?.posted?api.icons.lock:''}</button></td>`;
    }).join('')}${(()=>{const s=matrixSummary(row,edits);return [s.absent,s.dayOff,s.leave,s.awol,s.lost,s.present].map(value=>`<td class="attendance-summary">${value||'–'}</td>`).join('');})()}</tr>`).join('')||`<div class="empty" role="status"><p>No accessible employees match this cutoff${state.search||state.department||state.position||state.cutoff.clientId||state.cutoff.branch?' and filters':''}.</p><p>Employees appear automatically from Employee Information. Clear filters or check your employee and client access.</p>${state.search||state.department||state.position||state.cutoff.clientId||state.cutoff.branch?button('filters-clear','Clear filters'):''}</div>`;
  }
  function updateGrid(){const body=root?.querySelector('.attendance-grid tbody');if(!body){render();return;}const focused=coord(document.activeElement),viewport=root.querySelector('.attendance-matrix-viewport'),x=viewport.scrollLeft,y=viewport.scrollTop;body.innerHTML=rowsHTML();viewport.scrollLeft=x;viewport.scrollTop=y;
    if(focused)root.querySelector(`[data-row="${focused.row}"][data-col="${focused.col}"]`)?.focus({preventScroll:true});
    root.querySelector('.attendance-change-count').textContent=`${state.draft.count} changed days`;
    const message=root.querySelector('.attendance-matrix-message');if(message.getAttribute('role')!=='alert')message.textContent=`${state.mode==='present'?'Scheduled blanks = assumed Present':'Scheduled blanks = assumed Absent'} · Unconfirmed; not saved attendance. Employee-only days stay unrecorded (480 scheduled minutes; edit via Late/UT).`;
    for(const [action,enabled] of [['undo',state.draft.canUndo],['redo',state.draft.canRedo],['clear',state.draft.count>0],['save',state.draft.count>0&&canWrite()]])root.querySelector(`[data-action="${action}"]`).disabled=!enabled||state.busy;
  }
  function clearHighlights(){root?.querySelectorAll('.range-selected').forEach(node=>node.classList.remove('range-selected'));}
  function coord(target){const cell=target.closest?.('[data-row]');return cell?{row:Number(cell.dataset.row),col:Number(cell.dataset.col)}:null;}
  function pointerStart(event){if(!state.paint||event.button!==0||state.busy)return;const point=coord(event.target);if(!point||event.target.disabled)return;event.preventDefault();gesture={from:point,to:point,pointer:event.pointerId};root.setPointerCapture(event.pointerId);highlight();}
  function pointerMove(event){if(!gesture)return;const point=coord(document.elementFromPoint(event.clientX,event.clientY));if(point){gesture.to=point;highlight();}}
  function highlight(){clearHighlights();if(!gesture)return;for(let r=Math.min(gesture.from.row,gesture.to.row);r<=Math.max(gesture.from.row,gesture.to.row);r++)for(let c=Math.min(gesture.from.col,gesture.to.col);c<=Math.max(gesture.from.col,gesture.to.col);c++)root.querySelector(`[data-row="${r}"][data-col="${c}"]`)?.classList.add('range-selected');}
  function pointerEnd(event){if(!gesture||event.pointerId!==gesture.pointer)return;const range=gesture;gesture=null;root.releasePointerCapture(event.pointerId);clearHighlights();applyCells(rectangleCells(state.rows,state.dates,range.from,range.to));}
  function keyboard(event){
    if(event.key==='Escape')root.querySelector('.attendance-quick-menu')?.remove();
    const menu=event.target.closest('.attendance-quick-menu');
    if(menu&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();return;}
    if(event.key==='Escape'){if(state.filtersOpen){state.filtersOpen=false;root.querySelector('.attendance-filter-fields').dataset.open='false';const toggle=root.querySelector('.attendance-filter-toggle');toggle.setAttribute('aria-expanded','false');toggle.focus();event.preventDefault();}const menu=root.querySelector('.attendance-tools[open]');if(menu){menu.open=false;menu.querySelector('summary').focus();event.preventDefault();}gesture=null;clearHighlights();return;}
    const point=coord(event.target);if(!point||state.busy)return;
    if(event.shiftKey&&event.key==='F10'){event.preventDefault();const rect=event.target.getBoundingClientRect();contextMenu({target:event.target,clientX:rect.left,clientY:rect.bottom,preventDefault(){}});return;}
    if(['Enter',' '].includes(event.key)){event.preventDefault();const range=gesture&&gesture.pointer==null?gesture:{from:point,to:point};gesture=null;clearHighlights();applyCells(rectangleCells(state.rows,state.dates,range.from,range.to));return;}
    const delta={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]}[event.key];if(!delta)return;event.preventDefault();
    const target={row:Math.max(0,Math.min(state.rows.length-1,point.row+delta[0])),col:Math.max(0,Math.min(state.dates.length-1,point.col+delta[1]))};
    if(event.shiftKey){if(!gesture)gesture={from:point,to:target};gesture.to=target;highlight();}
    root.querySelector(`[data-row="${target.row}"][data-col="${target.col}"]`)?.focus();
  }
  function chooseBrush(value){
    state.brush=value==='leave'?state.leave:value;
    const viewport=root.querySelector('.attendance-matrix-viewport'),x=viewport.scrollLeft,y=viewport.scrollTop;
    render();root.querySelector('.attendance-matrix-viewport').scrollTo(x,y);
    root.querySelector(`[data-brush="${value}"]`)?.focus({preventScroll:true});
  }
  function contextMenu(event){
    const point=coord(event.target),cell=point&&state.rows[point.row]?.days[state.dates[point.col]];
    if(!(cell?.context?.ready||cell?.context?.recordingReady)||cell.posted||!canWrite(cell)||state.busy)return;
    event.preventDefault();root.querySelector('.attendance-quick-menu')?.remove();
    const menu=document.createElement('div');menu.className='attendance-quick-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Attendance quick transactions');
    menu.style.left=`${Math.max(4,Math.min(event.clientX,window.innerWidth-204))}px`;menu.style.top=`${Math.max(4,Math.min(event.clientY,window.innerHeight-330))}px`;
    menu.innerHTML=['Present','Absent','Paid Leave','Unpaid Leave','Day-off','AWOL/AWOP','Late/Undertime',...(cell.context.basic?[]:['Holiday (Unworked)'])].map(transaction=>`<button type="button" role="menuitem" data-quick="${transaction}" data-quick-row="${point.row}" data-quick-col="${point.col}">${transaction}</button>`).join('');
    root.append(menu);menu.querySelector('button').focus();
  }
  async function exportMatrix(){
    if(!api.canExport?.())return;
    if(state.draft.count)throw Error('Save or discard staged changes before exporting recorded attendance.');
    state.busy=true;
    try{const rows=[];let offset=0,total=0;do{const data=await call('query_attendance_matrix',{p_cutoff:state.cutoff,p_search:state.search,p_department:state.department,p_position:state.position,p_offset:offset,p_limit:100});total=data.total;rows.push(...data.rows);offset+=100;}while(offset<total);
      api.exportMatrix(rows,state.dates,state.cutoff);
    }finally{state.busy=false;}
  }
  function applyCells(cells){
    try{const valid=cells.filter(cell=>(cell.context?.ready||cell.context?.recordingReady)&&!cell.posted&&canWrite(cell));if(!valid.length)return;if(valid.length!==cells.length)throw Error('Selection includes dates outside employment, posted, unreviewed or unauthorized dates.');
      if(state.brush==='Late/Undertime')return timeEditor(valid);
      const edits=state.draft.edits;
      state.draft.apply(valid.map(cell=>matrixInput({...cell,record:edits[attendanceKey(cell.employeeId,cell.date)]||cell.record},state.brush)));updateGrid();
    }catch(error){alertError(error);}
  }
  function timeEditor(cells){
    const first=state.draft.edits[attendanceKey(cells[0].employeeId,cells[0].date)]||cells[0].record;
    if(cells.some(cell=>cell.context?.basic)){
      if(!cells.every(cell=>cell.context?.basic)){alertError(Error('Select employee attendance separately from reviewed duty schedules.'));return;}
      const minutes=first||cells[0].context;
      api.openModal(`<div class="modal-head"><h3>Late / Undertime · ${cells.length} day(s)</h3><button type="button" onclick="closeModal()" aria-label="Close">&times;</button></div><form id="attendance-minutes"><div class="modal-body formgrid">${input('scheduledMinutes','Scheduled minutes','number',minutes.scheduledMinutes,'required min="1" max="1440" step="1"')}${input('lateMinutes','Late minutes','number',minutes.lateMinutes||0,'required min="0" max="1440" step="1"')}${input('undertimeMinutes','Undertime minutes','number',minutes.undertimeMinutes||0,'required min="0" max="1440" step="1"')}<p class="full">Attendance only. These minutes do not verify actual punches or calculate pay.</p><p class="full" id="attendance-minutes-error" role="alert"></p></div><div class="modal-foot"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-confirm-change="false">Stage attendance</button></div></form>`);
      document.getElementById('attendance-minutes').addEventListener('submit',async event=>{event.preventDefault();try{const minutes=Object.fromEntries([...new FormData(event.currentTarget)].map(([key,value])=>[key,Number(value)]));state.draft.apply(cells.map(cell=>matrixInput(cell,'Late/Undertime',minutes)));await api.closeModal();updateGrid();}catch(error){document.getElementById('attendance-minutes-error').textContent=error.message;}});
      return;
    }
    try{compatibleTimeInputs(cells,cells[0].context.segments);}catch(error){alertError(error);return;}
    const segments=first?.segments?.length?first.segments:cells[0].context.segments;
    const clock=minutes=>`${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
    api.openModal(`<div class="modal-head"><h3>Late / Undertime · ${cells.length} day(s)</h3><button type="button" onclick="closeModal()" aria-label="Close">&times;</button></div><form id="attendance-times"><div class="modal-body">${segments.map((s,i)=>`<fieldset><legend>Duty ${i+1}</legend><div class="formgrid">${input(`start${i}`,'Actual time in','time',clock(s.start),'required')}${input(`end${i}`,'Actual time out','time',clock(s.end),'required')}${input(`break${i}`,'Unpaid break minutes','number',s.breakMinutes,'required min="0" step="1"')}<label><input name="startNext${i}" type="checkbox" ${s.start>=1440?'checked':''}> In next day</label><label><input name="endNext${i}" type="checkbox" ${s.end>=1440?'checked':''}> Out next day</label></div></fieldset>`).join('')}<p id="attendance-time-error" role="alert"></p></div><div class="modal-foot"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-confirm-change="false">Stage time adjustment</button></div></form>`);
    document.getElementById('attendance-times').addEventListener('submit',async event=>{event.preventDefault();try{const form=new FormData(event.currentTarget),minutes=name=>{const parts=String(form.get(name)).split(':').map(Number);return parts[0]*60+parts[1];};const actual=segments.map((s,i)=>({start:minutes(`start${i}`)+(form.has(`startNext${i}`)?1440:0),end:minutes(`end${i}`)+(form.has(`endNext${i}`)?1440:0),breakMinutes:Number(form.get(`break${i}`))}));state.draft.apply(compatibleTimeInputs(cells,actual));await api.closeModal();updateGrid();}catch(error){document.getElementById('attendance-time-error').textContent=error.message;}});
  }
  async function defaults(selected){
    if(!permission('attendance.create')||state.busy)return;const inputs=[],edits=state.draft.edits;
    for(const row of state.rows){if(selected&&!state.selected.has(row.id))continue;for(const cell of Object.values(row.days)){if(edits[attendanceKey(row.id,cell.date)])continue;const transaction=assumedTransaction(cell,state.mode);if(transaction)inputs.push(matrixInput(cell,transaction));}}
    if(!inputs.length){toast('No eligible unconfirmed defaults in this selection.');return;}
    if(await accepted('Confirm attendance defaults',`Stage ${inputs.length} explicitly confirmed default day(s)? Existing records, exceptions and holidays remain unchanged.`)){state.draft.apply(inputs);updateGrid();}
  }
  async function save(){
    if(state.busy||loadError||!state.draft.count)return;
    if(!state.reference.trim()){toast('Enter a DTR / attendance reference.',true);return;}
    if(!(await accepted('Save attendance batch',`Save ${state.draft.count} changed days in one transaction? Attendance approval and payroll posting are separate.`)))return;
    if(state.busy||loadError||!state.draft.count)return;
    state.busy=true;updateGrid();
    try{await call('save_attendance_matrix',{p_cutoff:state.cutoff,p_edits:Object.values(state.draft.edits),p_reference:state.reference.trim()});state.draft.reset();state.busy=false;await load();toast('Attendance batch saved.');}catch(error){state.busy=false;updateGrid();alertError(error);}
  }
  async function click(event){
    const quick=event.target.closest('[data-quick]');if(quick){const cell=state.rows[Number(quick.dataset.quickRow)]?.days[state.dates[Number(quick.dataset.quickCol)]],old=state.brush;state.brush=quick.dataset.quick;root.querySelector('.attendance-quick-menu')?.remove();applyCells([cell]);state.brush=old;return;}
    root.querySelector('.attendance-quick-menu')?.remove();
    const brush=event.target.closest('[data-brush]');if(brush&&!state.busy){chooseBrush(brush.dataset.brush);return;}
    const openButton=event.target.closest('button[data-open]');if(openButton){state.cutoff={...state.cutoffs.find(c=>c.id===openButton.dataset.open).data,id:openButton.dataset.open};state.period='custom';state.month=state.cutoff.start.slice(0,7);state.location=String(state.locations.findIndex(l=>l.client_id===state.cutoff.clientId&&l.branch===state.cutoff.branch));if(state.location==='-1')state.location='';state.page=1;await load();return;}
    const action=event.target.closest('[data-action]')?.dataset.action;if(!action||state.busy)return;
    root.querySelector('.attendance-tools')?.removeAttribute('open');
    try{
      if(action==='records'){if(await canLeave())api.records();}
      else if(action==='tools-close')root.querySelector('.attendance-tools summary').focus();
      else if(action==='filters-toggle'){state.filtersOpen=!state.filtersOpen;root.querySelector('.attendance-filter-fields').dataset.open=String(state.filtersOpen);root.querySelector('.attendance-filter-toggle').setAttribute('aria-expanded',String(state.filtersOpen));}
      else if(action==='matrix'){state.cutoff={...matrixPeriod(state.month,state.period==='custom'?'month':state.period),branch:'',clientId:''};if(state.period==='custom')state.period='month';state.location='';state.page=1;await load();}
      else if(action==='export')await exportMatrix();
      else if(action==='filters-clear'){if(await canLeave()){state.search='';state.department='';state.position='';state.location='';state.cutoff={...state.cutoff,branch:'',clientId:''};state.page=1;await load();}}
      else if(action==='retry')await open(true);else if(action==='new')cutoffForm();else if(action==='setup'){if(await canLeave())await setup();}
      else if(action==='back'){if(await canLeave()){state.page=1;await list();}}
      else if(action==='reload'){if(await canLeave())await load();}
      else if(action==='save')await save();else if(action==='defaults-selected')await defaults(true);else if(action==='defaults-page')await defaults(false);
      else if(action==='review'){
        if(state.draft.count)throw Error('Save or discard staged changes before reviewing records.');
        const items=state.rows.filter(row=>state.selected.has(row.id)).flatMap(row=>Object.values(row.days).filter(c=>c.record&&!c.posted).map(c=>({employeeId:row.id,workDate:c.date,hash:c.hash})));
        if(!items.length)throw Error('Select employees with recorded attendance first.');
        if(await accepted('Approve attendance evidence',`Approve ${items.length} records? This is not a payroll posting lock.`)){state.busy=true;try{await call('review_attendance_matrix',{p_items:items,p_state:'Approved'});await load();}finally{state.busy=false;}}
      }
      else if(action==='undo'||action==='redo'){state.draft[action]();updateGrid();}
      else if(action==='clear'){if(await canLeave())updateGrid();}
      else if(action==='paint'){state.paint=!state.paint;event.target.closest('[data-action]').innerHTML=(api.icons.pointer||'')+(state.paint?' Switch to scroll mode':' Switch to paint mode');root.querySelector('.attendance-grid')?.classList.toggle('paint-mode',state.paint);}
      else if(['prev','next'].includes(action)){if(await canLeave()){state.page+=action==='prev'?-1:1;await load();}}
      else if(action.startsWith('list-')){state.page+=action==='list-prev'?-1:1;await list();}
      else if(action==='new-config'){if(permission('attendance.manage')&&await canLeave())await configEditor();}else if(action==='config-back'){if(!state.cutoff)state.cutoff={...matrixPeriod(state.month,state.period==='custom'?'month':state.period),branch:'',clientId:''};await load();}
      const edit=event.target.closest('[data-config]');if(edit)await configEditor(state.configs.find(c=>c.id===edit.dataset.config));
    }catch(error){alertError(error);}
  }
  async function change(event){
    const target=event.target;
    if(['month','period','location','start','end'].includes(target.name)){
      const name=target.name,old=name==='start'||name==='end'?state.cutoff[name]:state[name];
      if(!(await canLeave())){target.value=old;return;}
      try{
        const next={...state.cutoff},month=name==='month'?target.value:state.month,period=name==='period'?target.value:state.period;
        if(name==='month'||name==='period'){if(period!=='custom')Object.assign(next,matrixPeriod(month,period));}
        else if(name==='location'){const location=state.locations[Number(target.value)];next.clientId=target.value===''?'':location.client_id;next.branch=target.value===''?'':location.branch;}
        else next[name]=target.value;
        cutoffDates(next.start,next.end);state.cutoff=next;state[name]=target.value;state.page=1;await load();
      }catch(error){target.value=old;alertError(error);}return;
    }
    if(target.dataset.employee){target.checked?state.selected.add(target.dataset.employee):state.selected.delete(target.dataset.employee);return;}
    if(target.name==='selectPage'){state.selected=target.checked?new Set(state.rows.map(r=>r.id)):new Set();updateGrid();return;}
    if(target.name==='leave'){state.leave=target.value;chooseBrush('leave');return;}
    if(target.name==='duty'){if(target.value)chooseBrush(target.value);return;}
    if(target.name==='mode'){const old=state.mode;try{const {error}=await supabase.from('hr_attendance_preferences').upsert({tenant_id:api.actor().tenantId,user_id:api.actor().id,blank_mode:target.value});if(error)throw error;state.mode=target.value;updateGrid();}catch(error){target.value=old;alertError(error);}return;}
    if(['department','position','size'].includes(target.name)){if(await canLeave()){if(target.name==='size')state.size=Number(target.value);else state[target.name]=target.value;state.page=1;await load();}else target.value=target.name==='size'?state.size:state[target.name];}
  }
  function typing(event){if(event.target.name==='reference')state.reference=event.target.value;if(event.target.name!=='search')return;const value=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{if(!active())return;if(await canLeave()){state.search=value;state.page=1;await load();const search=root.querySelector('[name="search"]');search?.focus();search?.setSelectionRange(value.length,value.length);}else event.target.value=state.search;},350);}
  async function setup(){
    const {data,error}=await supabase.from('hr_attendance_configuration').select('*').order('updated_at',{ascending:false}).limit(100);if(error)throw error;if(!active())return;state.configs=data||[];
    host().innerHTML=`<section class="attendance-preparation"><div class="data-toolbar">${button('config-back',api.icons.back+' Cutoffs')}<b>Attendance configuration</b><span class="toolbar-spacer"></span>${button('new-config',api.icons.plus+' Add reviewed configuration')}</div><div class="attendance-matrix-viewport"><table class="data-table"><thead><tr><th>Kind</th><th>Reference</th><th>Effective from</th><th>Review</th><th>Version</th></tr></thead><tbody>${state.configs.map(c=>`<tr><td><button class="btn btn-ghost btn-sm" data-action="edit-config" data-config="${c.id}">${esc(c.kind)}</button></td><td>${esc(c.data.reference)}</td><td>${esc(c.data.effectiveFrom)}</td><td>${c.data.reviewed?'Reviewed':'Needs Review'}</td><td>${c.revision}</td></tr>`).join('')||'<tr><td colspan="5">No configuration found.</td></tr>'}</tbody></table></div></section>`;bind();
  }
  async function configEditor(record){
    await api.prepareEmployeePicker?.();
    if(!active())return;
    if(record?.kind==='statutory'&&!api.actor().isSuperAdmin){toast('Only a system superadministrator can edit statutory versions.',true);return;}
    if(record?.kind==='client_policy'&&!permission('settings.manage')){toast('Settings management permission is required for client wage policies.',true);return;}
    const kind=record?.kind||'schedule',data=record?.data||{};
    const clock=value=>`${String(Math.floor(value/60)%24).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
    const dutyRow=s=>`<div class="att-duty"><label>In <input type="time" data-duty="start" required value="${clock(s.start)}"></label><label>Out <input type="time" data-duty="end" required value="${clock(s.end)}"></label><label>Unpaid break <input type="number" min="0" step="1" data-duty="break" value="${s.breakMinutes}"></label><label><input type="checkbox" data-duty="startNext" ${s.start>=1440?'checked':''}> In next day</label><label><input type="checkbox" data-duty="endNext" ${s.end>=1440?'checked':''}> Out next day</label><button type="button" class="btn btn-ghost btn-sm" data-remove-duty>Remove duty</button></div>`;
    const weekEditor=()=>`<div class="field full"><h4>Effective weekly duty schedule</h4>${(data.week||Array.from({length:7},(_,i)=>({restDay:i===0,segments:[{start:480,end:1020,breakMinutes:60}]}))).map((day,i)=>`<fieldset class="att-weekday"><legend>${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}</legend><label><input data-rest-day type="checkbox" ${day.restDay?'checked':''}> Scheduled rest day</label><div class="att-duties">${day.segments.map(dutyRow).join('')}</div><button type="button" class="btn btn-ghost btn-sm" data-add-duty>Add split duty</button></fieldset>`).join('')}</div>`;
    const common=`${input('key','Stable reference key','text',record?.identity_key||'','required maxlength="180"')}${input('reference','Reviewed declaration / assignment reference','text',data.reference||'','required')}${input('effectiveFrom','Effective from','date',data.effectiveFrom||api.today(),'required')}${input('effectiveTo','First day no longer effective (optional)','date',data.effectiveTo||'')}<label><input type="checkbox" name="reviewed" ${data.reviewed?'checked':''}> Reviewed evidence</label>`;
    api.openModal(`<div class="modal-head"><h3>Attendance configuration</h3><button type="button" onclick="closeModal()" aria-label="Close">&times;</button></div><form id="attendance-config"><div class="modal-body"><div class="formgrid"><div class="field"><label>Configuration kind</label>${select('kind',['schedule','rest_override','holiday','calendar_review','client_policy',...(api.actor().isSuperAdmin?['statutory']:[])],kind)}</div>${common}</div><div id="attendance-config-fields"></div><p role="alert" id="attendance-config-error"></p></div><div class="modal-foot">${record?'<label><input name="newVersion" type="checkbox"> Create new version</label>':''}<button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-confirm-change="false">Save configuration</button></div></form>`);
    const form=document.getElementById('attendance-config');
    function fields(){const selected=form.elements.kind.value;document.getElementById('attendance-config-fields').innerHTML=`<div class="formgrid">${['schedule','rest_override'].includes(selected)?api.employeePicker({id:'att_config_employee',label:'Employee',selectedId:data.employeeId||'',required:true}):''}${['schedule','client_policy'].includes(selected)?`<div class="field"><label>Client</label>${select('clientId',state.clients.map(c=>[c.id,c.name]),data.clientId||'','Select client')}</div>`:''}${selected==='schedule'?`${input('branchReporting','Dated reporting branch','text',data.branchReporting||'','required')}${input('department','Dated department','text',data.department||'','required')}${input('position','Dated position','text',data.position||'','required')}${input('worksite','Dated worksite','text',data.worksite||'','required')}${input('city','Worksite city PSGC code','text',data.geography?.city||'')}${input('province','Province PSGC code','text',data.geography?.province||'')}${input('region','Region code','text',data.geography?.region||'')}<div class="field full"><label for="att_week">Weekly duties (Sunday first; minute offsets from midnight)</label><textarea id="att_week" name="week" rows="10">${esc(JSON.stringify(data.week||Array.from({length:7},(_,i)=>({restDay:i===0,segments:[{start:480,end:1020,breakMinutes:60}]})),null,2))}</textarea></div>`:''}${selected==='rest_override'?`<label><input name="restDay" type="checkbox" ${data.restDay?'checked':''}> Scheduled rest day</label>`:''}${['holiday','calendar_review'].includes(selected)?`<div class="field"><label>Geographic scope</label>${select('scopeType',['national','region','province','city'],data.scopeType||'national')}</div>${input('scopeCode','Scope location code (blank for national)','text',data.scopeCode||'')}${selected==='holiday'?`${input('holidayId','Official holiday identity (same identity for duplicate declarations)','text',data.holidayId||'','required')}<div class="field"><label>Official classification</label>${select('classification',['regular_holiday','special_non_working','special_working'],data.classification||'regular_holiday')}</div>`:''}`:''}${['client_policy','statutory'].includes(selected)?`${selected==='client_policy'?`<div class="field"><label>Statutory version</label>${select('statutoryId',state.configs.filter(c=>c.kind==='statutory').map(c=>[c.id,c.identity_key]),data.statutoryId||'','Select statutory version')}</div>`:''}<div class="tablewrap full"><table class="data-table"><thead><tr><th>Resolved day</th><th>Worked (basis points)</th><th>Unworked (basis points)</th></tr></thead><tbody>${WAGE_DAY_TYPES.map(type=>`<tr><td>${esc(type)}</td>${['worked','unworked'].map(key=>`<td><input aria-label="${key} ${type}" name="${key}:${type}" type="number" min="0" step="1" required value="${esc(data[key]?.[type]??'')}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}</div>`;}
    fields();form.elements.kind.addEventListener('change',fields);
    const enhanceWeek=()=>{const textarea=form.querySelector('[name="week"]');if(textarea)textarea.closest('.field').outerHTML=weekEditor()+input('basicDailyCentavos','Effective basic daily rate (optional, integer centavos)','number',data.basicDailyCentavos??'','min="1" step="1"');};
    enhanceWeek();form.elements.kind.addEventListener('change',enhanceWeek);
    form.addEventListener('click',event=>{if(event.target.closest('[data-add-duty]')){const duties=event.target.closest('.att-weekday').querySelector('.att-duties');if(duties.children.length<12)duties.insertAdjacentHTML('beforeend',dutyRow({start:1080,end:1200,breakMinutes:0}));}if(event.target.closest('[data-remove-duty]'))event.target.closest('.att-duty').remove();});
    form.addEventListener('submit',async event=>{event.preventDefault();try{
      const values=Object.fromEntries(new FormData(form)),type=values.kind,out={reference:values.reference,effectiveFrom:values.effectiveFrom,effectiveTo:values.effectiveTo||null,reviewed:values.reviewed==='on'};
      if(record&&values.newVersion&&values.key===record.identity_key)throw Error('Enter a new stable reference key for the new version.');
      for(const key of ['clientId','branchReporting','department','position','worksite','scopeType','scopeCode','classification','holidayId','statutoryId'])if(values[key]!=null)out[key]=values[key];
      if(['schedule','rest_override'].includes(type)){out.employeeId=api.selectedEmployee('att_config_employee')?.id;if(!out.employeeId)throw Error('Select an actual employee.');}
      if(type==='schedule'){out.week=[...form.querySelectorAll('.att-weekday')].map(day=>({restDay:day.querySelector('[data-rest-day]').checked,segments:[...day.querySelectorAll('.att-duty')].map(duty=>{const minute=key=>{const parts=duty.querySelector(`[data-duty="${key}"]`).value.split(':').map(Number);return parts[0]*60+parts[1]+(duty.querySelector(`[data-duty="${key}Next"]`).checked?1440:0);};return {start:minute('start'),end:minute('end'),breakMinutes:Number(duty.querySelector('[data-duty="break"]').value)};})}));out.geography={city:values.city,province:values.province,region:values.region};}
      if(type==='rest_override')out.restDay=values.restDay==='on';
      if(type==='schedule'&&values.basicDailyCentavos)out.basicDailyCentavos=Number(values.basicDailyCentavos);
      if(['holiday','rest_override'].includes(type))out.effectiveTo=new Date(Date.parse(values.effectiveFrom)+86400000).toISOString().slice(0,10);
      if(['client_policy','statutory'].includes(type)){out.worked={};out.unworked={};for(const day of WAGE_DAY_TYPES)for(const key of ['worked','unworked'])out[key][day]=Number(values[`${key}:${day}`]);}
      if(!(await accepted('Save attendance configuration','Save this reviewed effective-dated configuration? Existing attendance keeps its source snapshots.')))return;
      await call('save_attendance_configuration',{p_id:record&&!values.newVersion?record.id:crypto.randomUUID(),p_kind:type,p_key:values.key,p_expected:record&&!values.newVersion?record.revision:0,p_data:out});await api.closeModal();await setup();toast('Attendance configuration saved.');
    }catch(error){document.getElementById('attendance-config-error').textContent=error.message;}});
  }
  return {open,canLeave,get dirty(){return state.draft.count>0;},get busy(){return state.busy;}};
}
