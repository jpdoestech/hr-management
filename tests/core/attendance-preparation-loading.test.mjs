import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttendancePreparation} from '../../js/core/attendance-preparation.js';

function preview({manage=true,matrix=async()=>({data:{rows:[],total:0}})}={}){
  const listeners={},calls=[],notices=[];
  const root={isConnected:true,addEventListener:(name,handler)=>{listeners[name]=handler;},querySelector:()=>null};
  const host={innerHTML:'',querySelector:()=>root};
  const controller=createAttendancePreparation({
    actor:()=>({id:'synthetic-actor'}),isActive:()=>true,today:()=> '2026-10-17',content:()=>host,
    permission:key=>key!=='attendance.manage'||manage,confirm:async()=>true,toast:message=>notices.push(message),
    esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    departments:()=>[],positions:()=>[],icons:{back:'Back',search:'',plus:'+',settings:'Settings',refresh:'Reload',undo:'Undo',redo:'Redo',save:'Save',lock:'Locked'},
    supabase:{rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='attendance_preparation_options')return {data:{clients:[],locations:[]}};
      assert.equal(name,'query_attendance_matrix');return matrix(args);
    },from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})},
  });
  const click=action=>listeners.click({target:{closest:selector=>selector==='[data-action]'?{dataset:{action}}:null}});
  const change=(name,value)=>listeners.change({target:{name,value,dataset:{}}});
  return {controller,host,calls,notices,click,change};
}

test('empty roster explains dated schedules and offers permitted setup',async()=>{
  const {controller,host}=preview();await controller.open();
  assert.match(host.innerHTML,/only when they have a dated attendance schedule overlapping/);
  assert.match(host.innerHTML,/data-action="new-config"[^>]*>Add employee schedule/);
  assert.doesNotMatch(host.innerHTML,/Employee roster could not be loaded|Ask an attendance manager/);
});

test('viewer sees schedule/access guidance without a setup action',async()=>{
  const {controller,host}=preview({manage:false});await controller.open();
  assert.match(host.innerHTML,/Ask an attendance manager to review employee schedules and your assignment access/);
  assert.doesNotMatch(host.innerHTML,/data-action="new-config"|data-action="setup"/);
});

test('successful roster still renders employee rows in the attendance table',async()=>{
  const view=preview({matrix:async()=>({data:{rows:[{id:'synthetic',name:'Synthetic Employee',employeeNo:'000001',days:{}}],total:1}})});
  await view.controller.open();
  assert.match(view.host.innerHTML,/<table class="attendance-grid/);
  assert.match(view.host.innerHTML,/Synthetic Employee/);
  assert.match(view.host.innerHTML,/1 employee\(s\)/);
  assert.doesNotMatch(view.host.innerHTML,/No accessible employee schedules|Roster unavailable/);
});

test('failed load is distinct from empty results and Retry preserves cutoff and filters',async()=>{
  let fail=true;
  const view=preview({matrix:async()=>fail?{error:{message:'Synthetic <request> failure'}}:{data:{rows:[],total:0}}});
  await view.controller.open();
  assert.match(view.host.innerHTML,/role="alert"><b>Employee roster could not be loaded/);
  assert.match(view.host.innerHTML,/Synthetic &lt;request> failure/);
  assert.match(view.host.innerHTML,/data-action="reload"[^>]*>Retry/);
  assert.match(view.host.innerHTML,/Roster unavailable/);
  assert.doesNotMatch(view.host.innerHTML,/No accessible employee schedules|0 employee\(s\)/);
  await view.change('month','2026-09');
  await view.change('department','Synthetic Department');
  fail=false;await view.click('reload');
  const request=view.calls.at(-1);
  assert.equal(request.args.p_cutoff.start,'2026-09-16');
  assert.equal(request.args.p_department,'Synthetic Department');
  assert.match(view.host.innerHTML,/No accessible employee schedules match this cutoff and filters/);
  assert.match(view.host.innerHTML,/0 employee\(s\)/);
  assert.doesNotMatch(view.host.innerHTML,/Roster unavailable|Employee roster could not be loaded/);
  await view.click('filters-clear');
  assert.equal(view.calls.at(-1).args.p_department,'');
});

test('a stale request failure cannot replace a newer successful roster',async()=>{
  let rejectFirst,started;
  const firstStarted=new Promise(resolve=>{started=resolve;});
  let requests=0;
  const view=preview({matrix:async()=>{
    if(++requests===1){started();return new Promise((resolve,reject)=>{rejectFirst=reject;});}
    return {data:{rows:[],total:0}};
  }});
  const first=view.controller.open();await firstStarted;
  await view.controller.open(true);
  rejectFirst(Error('Stale failure'));await first;
  assert.match(view.host.innerHTML,/No accessible employee schedules/);
  assert.doesNotMatch(view.host.innerHTML,/Stale failure|Roster unavailable/);
  assert.deepEqual(view.notices,[]);
});
