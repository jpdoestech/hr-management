import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {workforceAgeMix,attendanceMetrics,ATTENDANCE_STATUSES} from '../../js/core/workforce-metrics.js';

const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
export async function attendancePreview({permissions=true,fail=false}={}){
  const employees=[{id:'e1',name:'Dela Cruz, Juan',department:'Production',branchReporting:'Davao',gender:'Male',birthDate:'2000-10-09'}];
  const records=Array.from({length:14},(_,i)=>({id:String(i),employeeId:'e1',employeeName:employees[0].name,department:'Production',branchReporting:'Davao',classification:'Regular',workDate:`2026-10-${String(i+1).padStart(2,'0')}`,status:i===0?'Absent':'Present',scheduledMinutes:480,lateMinutes:i===1?15:0,undertimeMinutes:0,absenceClassification:i===0?'Unauthorized':'',factor:'Transport / Location'}));
  const content={innerHTML:''},calls=[];
  const context={workforceAgeMix,ATTENDANCE_STATUSES,STATE:{view:'attendance',search:'',tablePages:{}},DB:{employees,attendance:[]},DB_SNAPSHOT:{attendance:[]},LOADED_RECORD_MODULES:new Set(),ATTENDANCE_REQUEST:0,
    document:{getElementById:()=>content},ensureRecordModules:async()=>{},setTitle:()=>{},todayISO:()=> '2026-10-09',hasPermission:key=>key.endsWith('.view')||permissions,canExport:()=>permissions,esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    employeeDepartmentNames:()=>['Production'],employeeBranchLocations:()=>['Davao'],requestedPageState:()=>({size:10,page:1}),paginationHTML:()=>'<button>1</button><button>2</button>',enhanceDataTables:()=>{},toast:()=>{},
    MODULES:{attendance:{columns:['employeeName','department','branchReporting','workDate','status','classification','lateMinutes','undertimeMinutes','absenceClassification','factor'].map(key=>({key,label:key}))}},
    supabase:{rpc:async(name,params)=>{calls.push({name,params});return fail?{error:{message:'Migration unavailable'}}:{data:{records:records.slice(0,10),total:14,metrics:attendanceMetrics(records),absenceGroups:[{absenceClassification:'Unauthorized',count:1}],factorGroups:[{factor:'Transport / Location',count:2}]}};}},
  };
  for(const name of ['iSearch','iInfo','iDownload','iPlus','iEdit','iTrash'])context[name]=()=>'<span aria-hidden="true"></span>';
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function workforceAgeTableHTML('),source.indexOf('function attendanceFilter(')),context);
  await vm.runInContext('renderAttendance()',context);
  return {html:content.innerHTML,calls};
}
test('attendance renderer uses bounded server rows and full filtered KPI totals',async()=>{
  const {html,calls}=await attendancePreview();
  assert.equal(calls[0].name,'query_attendance_dashboard');assert.equal(calls[0].params.p_limit,10);
  assert.match(html,/13 present \/ 14 scheduled days/);assert.match(html,/1-10 of 14/);
  assert.match(html,/data-view-all-disabled="true"/);assert.match(html,/data-search-key="search"/);
  assert.match(html,/Add Attendance/);assert.match(html,/exportAttendance/);assert.match(html,/Edit attendance/);
});
test('attendance viewer cannot see mutation or export actions',async()=>{
  const {html}=await attendancePreview({permissions:false});
  assert.doesNotMatch(html,/Add Attendance|exportAttendance|Edit attendance|Delete attendance/);
  assert.match(html,/Dela Cruz, Juan/);
});
test('attendance loading errors provide a retry instead of fake zero KPIs',async()=>{
  const {html}=await attendancePreview({fail:true});
  assert.match(html,/Migration unavailable/);assert.match(html,/Retry/);assert.doesNotMatch(html,/scheduled days/);
});
test('generic loading excludes unbounded attendance history',()=>{
  const loader=source.slice(source.indexOf('function unloadedRecordModules('),source.indexOf('function ensureRecordModules('));
  assert.match(loader,/module!=='attendance'/);
});
