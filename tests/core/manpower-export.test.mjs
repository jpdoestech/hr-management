import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {manpowerCSV} from '../../js/core/manpower-export.js';
const columns=[{label:'Value',key:'value'}];
test('manpower CSV neutralizes formula and leading-control text',()=>{
  for(const value of ['=1+1','+SUM(1,2)','-1+2','@SUM(1,2)','\t=1','\r=1','\n=1','  =1','\u0000=1','\ufeff=1','\tOrdinary text']){
    assert.equal(manpowerCSV([{value}],columns),'"Value"\n"\''+value+'"');
  }
});
test('CSV preserves quantities, dates, names, commas, quotes and multiline content',()=>{
  assert.equal(manpowerCSV([{value:-5},{value:1000},{value:null},{value:'2026-10-10'},{value:'Dela Cruz, Juan'},{value:'A "quoted" name'},{value:'First\nSecond'}],columns),
    '"Value"\n"-5"\n"1000"\n""\n"2026-10-10"\n"Dela Cruz, Juan"\n"A ""quoted"" name"\n"First\nSecond"');
  assert.equal(manpowerCSV([{value:'unused'}],[{label:'=header',get:()=>'+unsafe'}]),'"\'=header"\n"\'+unsafe"');
});
test('manpower export enforces module permissions even when invoked from another workspace',()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf('function exportManpowerFulfillment(){'),app.indexOf('function analyticsDateFor('));
  for(const missing of ['manpower.view','manpower.export']){
    const context={SESSION:{id:'user'},hasPermission:key=>key!==missing,requireExportAccess:()=>true};
    runInNewContext(source,context);assert.doesNotThrow(()=>context.exportManpowerFulfillment());
  }
});
test('authorized export retains current search/branch filters and sanitizes output',()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf('function exportManpowerFulfillment(){'),app.indexOf('function analyticsDateFor('));
  let output='';
  const context={SESSION:{id:'user'},STATE:{manpowerBranch:'Davao'},hasPermission:()=>true,requireExportAccess:()=>true,
    DB:{manpowerRequests:[{id:'one',prfNumber:'=CMD()',clientName:'Client',branchSite:'Davao'},{id:'two',prfNumber:'Other',branchSite:'Manila'}]},
    manpowerRequestRequirements:()=>[],manpowerRequestSummary:()=>({fulfillmentRate:0,risk:'No Target',status:'Draft'}),
    manpowerRequestLabel:row=>row.prfNumber,todayISO:()=> '2026-10-10',manpowerCSV,downloadCSV:(_name,csv)=>{output=csv;}};
  runInNewContext(source,context);context.exportManpowerFulfillment();
  assert.match(output,/"'=CMD\(\)"/);assert.doesNotMatch(output,/Other|Manila/);
  output='';context.STATE.manpowerSearch='no match';context.exportManpowerFulfillment();assert.equal(output.split('\n').length,2);
});
