import {MATRIX_TRANSACTIONS,attendanceKey,cutoffDates,createMatrixDraft,matrixInput,compatibleTimeInputs,assumedTransaction,rectangleCells} from './attendance-matrix.js';
import {WAGE_DAY_TYPES} from './attendance-wage-rules.js';

export function createAttendancePreparation(api){
  const {supabase,esc,permission,confirm,toast}=api;
  const ownerId=api.actor().id,active=()=>api.actor()?.id===ownerId&&api.isActive?.()!==false;
  const state={cutoff:null,rows:[],dates:[],page:1,size:25,total:0,search:'',department:'',position:'',brush:'Present',mode:'present',selected:new Set(),draft:createMatrixDraft(),busy:false,sequence:0,clients:[],configs:[],paint:true,reference:''};
  let root,gesture=null,searchTimer;
  const button=(action,label,disabled=false)=>`<button type="button" class="btn btn-ghost btn-sm" data-action="${action}" title="${esc(action.replaceAll('-',' '))}" ${label.replace(/<[^>]+>/g,'').trim()?'':`aria-label="${esc(action)}"`} data-confirm-change="false" ${disabled?'disabled':''}>${label}</button>`;
  const select=(name,values,value,empty='')=>`<select name="${name}" aria-label="${esc(({brush:'Attendance transaction',mode:'Blank-day encoding preference',department:'Department',position:'Position',size:'Employees per page',clientId:'Client',kind:'Configuration kind',statutoryId:'Statutory version'})[name]||name)}">${empty?`<option value="">${esc(empty)}</option>`:''}${values.map(v=>{const [key,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(key)}" ${key===value?'selected':''}>${esc(label)}</option>`;}).join('')}</select>`;
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
  function bind(){root=host().querySelector('.attendance-preparation');root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',typing);root.addEventListener('keydown',keyboard);root.addEventListener('pointerdown',pointerStart);root.addEventListener('pointermove',pointerMove);root.addEventListener('pointerup',pointerEnd);root.addEventListener('pointercancel',()=>{gesture=null;clearHighlights();});}
  async function open(force=false){
    if(!force&&root?.isConnected)return;
    host().innerHTML='<div class="attendance-loading" role="status">Loading attendance preparation…</div>';
    try{
      const options=await call('attendance_preparation_options',{});state.clients=options.clients||[];
      if(!active())return;
      const {data,error}=await supabase.from('hr_attendance_preferences').select('blank_mode').eq('user_id',api.actor().id).maybeSingle();if(error)throw error;state.mode=data?.blank_mode||'present';
      if(active())await list();
    }catch(error){if(!active())return;host().innerHTML=`<div class="attendance-preparation"><div class="data-toolbar">${button('records','Back to records')}${button('retry','Retry')}</div><div class="notice" role="alert">${esc(error.message)}. Attendance preparation requires migration 0062; existing records remain available.</div></div>`;bind();}
  }
  async function list(){
    if(!(await canLeave()))return;
    state.cutoff=null;
    const {data,error}=await supabase.from('hr_attendance_cutoffs').select('id,data,created_at',{count:'exact'}).order('created_at',{ascending:false}).range((state.page-1)*25,state.page*25-1);
    if(error)throw error;
    if(!active())return;
    host().innerHTML=`<section class="attendance-preparation"><div class="data-toolbar">${button('records',`${api.icons.back} Records & KPIs`)}<span class="toolbar-spacer"></span>${permission('attendance.manage')?button('setup',`${api.icons.settings} Configuration`):''}${permission('attendance.create')?button('new',`${api.icons.plus} New cutoff`):''}</div><div class="attendance-matrix-viewport"><table class="data-table"><thead><tr><th>Cutoff</th><th>Branch</th><th>Client</th><th>Payout</th><th></th></tr></thead><tbody>${(data||[]).map(row=>`<tr><td>${esc(row.data.start)} – ${esc(row.data.end)}</td><td>${esc(row.data.branch)}</td><td>${esc(state.clients.find(c=>c.id===row.data.clientId)?.name||'Assigned client')}</td><td>${esc(row.data.payout||'—')}</td><td><button class="btn btn-ghost btn-sm" data-open="${esc(row.id)}">Open</button></td></tr>`).join('')||'<tr><td colspan="5">No cutoffs in your scope.</td></tr>'}</tbody></table></div><footer class="attendance-matrix-footer">${button('list-prev','Previous',state.page===1)}<span>Page ${state.page}</span>${button('list-next','Next',(data||[]).length<25)}</footer></section>`;
    state.cutoffs=data||[];bind();
  }
  function cutoffForm(){
    api.openModal(`<div class="modal-head"><h3>New attendance cutoff</h3><button type="button" onclick="closeModal()" aria-label="Close">&times;</button></div><form id="attendance-cutoff-form"><div class="modal-body formgrid">${input('start','From','date',api.today().slice(0,7)+'-01','required')}${input('end','To','date',api.today(),'required')}${input('branchReporting','Branch','text','','required maxlength="60"')}<div class="field"><label for="att_client">Client</label>${select('clientId',state.clients.map(c=>[c.id,c.name]),'','Select client')}</div>${input('payout','Payout (optional)','date')}</div><div class="modal-foot"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-confirm-change="false">Open cutoff</button></div></form>`);
    document.getElementById('attendance-cutoff-form').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
      try{cutoffDates(values.start,values.end);if(values.payout&&values.payout<values.end)throw Error('Payout cannot precede the cutoff end.');if(!values.clientId)throw Error('Select a client.');
        if(!(await accepted('Create attendance cutoff','Create this preparation cutoff? No attendance is inferred or saved.')))return;
        const row=await call('create_attendance_cutoff',{p_data:values});await api.closeModal();state.cutoff={...row.data,id:row.id};state.page=1;await load();
      }catch(error){alertError(error);}
    });
  }
  async function accepted(title,message){const result=await confirm({title,message,confirmLabel:'Confirm',cancelLabel:'Cancel'});return result===true||result==='confirm';}
  async function load(){
    if(!active())return;
    const token=++state.sequence;state.busy=true;
    if(!root?.querySelector('.attendance-grid'))host().innerHTML='<div role="status" class="attendance-loading">Loading scoped employee-days…</div>';
    try{
      state.dates=cutoffDates(state.cutoff.start,state.cutoff.end);
      const data=await call('query_attendance_matrix',{p_cutoff:state.cutoff,p_search:state.search,p_department:state.department,p_position:state.position,p_offset:(state.page-1)*state.size,p_limit:state.size});
      if(token!==state.sequence)return;if(!active()){state.busy=false;return;}state.rows=data.rows||[];state.total=data.total||0;state.selected.clear();state.busy=false;render();
    }catch(error){state.busy=false;if(!active())return;alertError(error);host().innerHTML=`<section class="attendance-preparation"><div class="data-toolbar">${button('back','Back')}${button('reload','Retry')}</div><div class="notice" role="alert">${esc(error.message)}</div></section>`;bind();}
  }
  function render(){
    host().innerHTML=`<section class="attendance-preparation"><div class="data-toolbar attendance-matrix-toolbar">${button('back',`${api.icons.back} Cutoffs`)}<b>${esc(state.cutoff.start)} – ${esc(state.cutoff.end)}</b><div class="searchbox">${api.icons.search}<input aria-label="Search assigned employees" name="search" value="${esc(state.search)}" placeholder="Search employees…"></div>${select('department',api.departments(),state.department,'All departments')}${select('position',api.positions(),state.position,'All positions')}${button('reload',api.icons.refresh+' Reload',state.busy)}</div>
      <div class="attendance-paint-toolbar">${select('brush',MATRIX_TRANSACTIONS.map(([name])=>name),state.brush)}${select('mode',[['present','Blanks: assumed Present'],['absent','Blanks: assumed Absent']],state.mode)}${button('paint',state.paint?'Paint mode':'Scroll mode')}<details class="attendance-tools"><summary>Actions</summary><div>${button('defaults-selected','Confirm selected defaults')}${button('defaults-page','Confirm page defaults')}${permission('attendance.manage')?button('review','Approve selected records'):''}${button('clear','Clear changes',!state.draft.count)}</div></details><span class="toolbar-spacer"></span>${button('undo',api.icons.undo,state.busy||!state.draft.canUndo)}${button('redo',api.icons.redo,state.busy||!state.draft.canRedo)}<span role="status" class="attendance-change-count">${state.draft.count} changed days</span></div>
      <div class="attendance-matrix-viewport"><table class="attendance-grid ${state.paint?'paint-mode':''}" aria-label="Cutoff attendance"><thead><tr><th class="attendance-frozen"><label><input type="checkbox" name="selectPage" aria-label="Select page employees"> Employee</label></th>${state.dates.map(date=>`<th scope="col">${esc(date.slice(5))}</th>`).join('')}<th>Changed</th></tr></thead><tbody>${rowsHTML()}</tbody></table></div>
      <footer class="attendance-matrix-footer"><input aria-label="DTR / attendance reference" name="reference" maxlength="1000" value="${esc(state.reference)}" placeholder="DTR / attendance reference"><span class="toolbar-spacer"></span><span>${state.total} employees</span>${select('size',['25','50','100'],String(state.size))}${button('prev','Previous',state.page===1)}<span>Page ${state.page}</span>${button('next','Next',state.page*state.size>=state.total)}${button('save',api.icons.save+' Save changes',state.busy||!state.draft.count||!canWrite())}</footer><div class="attendance-matrix-message" role="status"></div></section>`;
    bind();
  }
  function canWrite(cell){return cell?permission(cell.record?'attendance.update':'attendance.create'):permission('attendance.create')||permission('attendance.update');}
  function rowsHTML(){
    const edits=state.draft.edits;
    return state.rows.map((row,r)=>`<tr><th class="attendance-frozen" scope="row"><label><input type="checkbox" data-employee="${esc(row.id)}" ${state.selected.has(row.id)?'checked':''}><span>${esc(row.name)}<small>${esc(row.employeeNo)}</small></span></label></th>${state.dates.map((date,c)=>{
      const cell=row.days[date],edit=edits[attendanceKey(row.id,date)],record=edit||cell?.record;
      const assumed=cell?assumedTransaction(cell,state.mode):null,label=record?.transaction||record?.status||(assumed?`Assumed ${assumed}`:'Needs Review');
      const code=MATRIX_TRANSACTIONS.find(([name])=>name===label)?.[1]||(label==='Approved Leave'?'LV':label==='Rest Day / Holiday'?'DO':label==='Present'?'P':label==='Absent'?'A':assumed?'·':'?');
      return `<td><button type="button" data-row="${r}" data-col="${c}" class="attendance-cell ${edit?'changed':''} ${!record?'unconfirmed':''}" aria-label="${esc(row.name)}, ${date}, ${esc(label)}${cell?.posted?', payroll posted':''}" title="${esc(cell?.posted?'Payroll posted':cell?.context?.reason||label)}" ${!cell?.context?.ready||cell?.posted||!canWrite(cell)?'disabled':''}>${esc(code)}${cell?.posted?api.icons.lock:''}</button></td>`;
    }).join('')}<td>${Object.values(edits).filter(e=>e.employeeId===row.id).length}</td></tr>`).join('')||`<tr><td colspan="${state.dates.length+2}">No assigned employees match this cutoff and filters. Review dated schedules in Configuration.</td></tr>`;
  }
  function updateGrid(){const body=root?.querySelector('.attendance-grid tbody');if(!body)return;const focused=coord(document.activeElement),viewport=root.querySelector('.attendance-matrix-viewport'),x=viewport.scrollLeft,y=viewport.scrollTop;body.innerHTML=rowsHTML();viewport.scrollLeft=x;viewport.scrollTop=y;
    if(focused)root.querySelector(`[data-row="${focused.row}"][data-col="${focused.col}"]`)?.focus({preventScroll:true});
    root.querySelector('.attendance-change-count').textContent=`${state.draft.count} changed days`;
    for(const [action,enabled] of [['undo',state.draft.canUndo],['redo',state.draft.canRedo],['clear',state.draft.count>0],['save',state.draft.count>0&&canWrite()]])root.querySelector(`[data-action="${action}"]`).disabled=!enabled||state.busy;
  }
  function clearHighlights(){root?.querySelectorAll('.range-selected').forEach(node=>node.classList.remove('range-selected'));}
  function coord(target){const cell=target.closest?.('[data-row]');return cell?{row:Number(cell.dataset.row),col:Number(cell.dataset.col)}:null;}
  function pointerStart(event){if(!state.paint||event.button!==0||state.busy)return;const point=coord(event.target);if(!point||event.target.disabled)return;event.preventDefault();gesture={from:point,to:point,pointer:event.pointerId};root.setPointerCapture(event.pointerId);highlight();}
  function pointerMove(event){if(!gesture)return;const point=coord(document.elementFromPoint(event.clientX,event.clientY));if(point){gesture.to=point;highlight();}}
  function highlight(){clearHighlights();if(!gesture)return;for(let r=Math.min(gesture.from.row,gesture.to.row);r<=Math.max(gesture.from.row,gesture.to.row);r++)for(let c=Math.min(gesture.from.col,gesture.to.col);c<=Math.max(gesture.from.col,gesture.to.col);c++)root.querySelector(`[data-row="${r}"][data-col="${c}"]`)?.classList.add('range-selected');}
  function pointerEnd(event){if(!gesture||event.pointerId!==gesture.pointer)return;const range=gesture;gesture=null;root.releasePointerCapture(event.pointerId);clearHighlights();applyCells(rectangleCells(state.rows,state.dates,range.from,range.to));}
  function keyboard(event){
    if(event.key==='Escape'){const menu=root.querySelector('.attendance-tools[open]');if(menu){menu.open=false;menu.querySelector('summary').focus();event.preventDefault();}gesture=null;clearHighlights();return;}
    const point=coord(event.target);if(!point||state.busy)return;
    if(['Enter',' '].includes(event.key)){event.preventDefault();const range=gesture&&gesture.pointer==null?gesture:{from:point,to:point};gesture=null;clearHighlights();applyCells(rectangleCells(state.rows,state.dates,range.from,range.to));return;}
    const delta={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]}[event.key];if(!delta)return;event.preventDefault();
    const target={row:Math.max(0,Math.min(state.rows.length-1,point.row+delta[0])),col:Math.max(0,Math.min(state.dates.length-1,point.col+delta[1]))};
    if(event.shiftKey){if(!gesture)gesture={from:point,to:target};gesture.to=target;highlight();}
    root.querySelector(`[data-row="${target.row}"][data-col="${target.col}"]`)?.focus();
  }
  function applyCells(cells){
    try{const valid=cells.filter(cell=>cell.context?.ready&&!cell.posted&&canWrite(cell));if(!valid.length)return;if(valid.length!==cells.length)throw Error('Selection includes unassigned, posted, unreviewed or unauthorized dates.');
      if(state.brush==='Late/Undertime')return timeEditor(valid);
      state.draft.apply(valid.map(cell=>matrixInput(cell,state.brush)));updateGrid();
    }catch(error){alertError(error);}
  }
  function timeEditor(cells){
    try{compatibleTimeInputs(cells,cells[0].context.segments);}catch(error){alertError(error);return;}
    const segments=cells[0].context.segments;
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
    if(state.busy||!state.draft.count)return;
    if(!state.reference.trim()){toast('Enter a DTR / attendance reference.',true);return;}
    if(!(await accepted('Save attendance batch',`Save ${state.draft.count} changed days in one transaction? Attendance approval and payroll posting are separate.`)))return;
    state.busy=true;updateGrid();
    try{await call('save_attendance_matrix',{p_cutoff:state.cutoff,p_edits:Object.values(state.draft.edits),p_reference:state.reference.trim()});state.draft.reset();state.busy=false;await load();toast('Attendance batch saved.');}catch(error){state.busy=false;updateGrid();alertError(error);}
  }
  async function click(event){
    const openButton=event.target.closest('[data-open]');if(openButton){state.cutoff={...state.cutoffs.find(c=>c.id===openButton.dataset.open).data,id:openButton.dataset.open};state.page=1;await load();return;}
    const action=event.target.closest('[data-action]')?.dataset.action;if(!action||state.busy)return;
    try{
      if(action==='records'){if(await canLeave())api.records();}
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
      else if(action==='paint'){state.paint=!state.paint;event.target.textContent=state.paint?'Paint mode':'Scroll mode';root.querySelector('.attendance-grid')?.classList.toggle('paint-mode',state.paint);}
      else if(['prev','next'].includes(action)){if(await canLeave()){state.page+=action==='prev'?-1:1;await load();}}
      else if(action.startsWith('list-')){state.page+=action==='list-prev'?-1:1;await list();}
      else if(action==='new-config')configEditor();else if(action==='config-back')await list();
      const edit=event.target.closest('[data-config]');if(edit)configEditor(state.configs.find(c=>c.id===edit.dataset.config));
    }catch(error){alertError(error);}
  }
  async function change(event){
    const target=event.target;
    if(target.dataset.employee){target.checked?state.selected.add(target.dataset.employee):state.selected.delete(target.dataset.employee);return;}
    if(target.name==='selectPage'){state.selected=target.checked?new Set(state.rows.map(r=>r.id)):new Set();updateGrid();return;}
    if(target.name==='brush'){state.brush=target.value;return;}
    if(target.name==='mode'){const old=state.mode;try{const {error}=await supabase.from('hr_attendance_preferences').upsert({tenant_id:api.actor().tenantId,user_id:api.actor().id,blank_mode:target.value});if(error)throw error;state.mode=target.value;updateGrid();}catch(error){target.value=old;alertError(error);}return;}
    if(['department','position','size'].includes(target.name)){if(await canLeave()){if(target.name==='size')state.size=Number(target.value);else state[target.name]=target.value;state.page=1;await load();}else target.value=target.name==='size'?state.size:state[target.name];}
  }
  function typing(event){if(event.target.name==='reference')state.reference=event.target.value;if(event.target.name!=='search')return;const value=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{if(await canLeave()){state.search=value;state.page=1;await load();const search=root.querySelector('[name="search"]');search?.focus();search?.setSelectionRange(value.length,value.length);}},350);}
  async function setup(){
    const {data,error}=await supabase.from('hr_attendance_configuration').select('*').order('updated_at',{ascending:false}).limit(100);if(error)throw error;if(!active())return;state.configs=data||[];
    host().innerHTML=`<section class="attendance-preparation"><div class="data-toolbar">${button('config-back',api.icons.back+' Cutoffs')}<b>Attendance configuration</b><span class="toolbar-spacer"></span>${button('new-config',api.icons.plus+' Add reviewed configuration')}</div><div class="attendance-matrix-viewport"><table class="data-table"><thead><tr><th>Kind</th><th>Reference</th><th>Effective from</th><th>Review</th><th>Version</th></tr></thead><tbody>${state.configs.map(c=>`<tr><td><button class="btn btn-ghost btn-sm" data-action="edit-config" data-config="${c.id}">${esc(c.kind)}</button></td><td>${esc(c.data.reference)}</td><td>${esc(c.data.effectiveFrom)}</td><td>${c.data.reviewed?'Reviewed':'Needs Review'}</td><td>${c.revision}</td></tr>`).join('')||'<tr><td colspan="5">No configuration found.</td></tr>'}</tbody></table></div></section>`;bind();
  }
  function configEditor(record){
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
