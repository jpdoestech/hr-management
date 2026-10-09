import test from 'node:test';
import assert from 'node:assert/strict';
import {manpowerDemandBalance,manpowerQuantity,normalizePrfNumber} from '../../js/core/manpower-demand.js';
test('normalizes manual PRF text without generating a number',()=>{
  assert.equal(normalizePrfNumber('  PRF-2026-001  '),'prf-2026-001');
  assert.equal(normalizePrfNumber('PRF  001'),'prf 001');assert.equal(normalizePrfNumber(''),'');
});
test('1000+ headcount is a quantity and does not materialize slots',()=>{
  for(const count of [10,100,500,1000,100000])assert.equal(manpowerDemandBalance({id:'line',currentAuthorized:count}).available,count);
  for(const invalid of [0,-1,1.1,'',NaN,2147483648,'1e3'])assert.throws(()=>manpowerQuantity(invalid));
});
test('scheduled workers are reserved once and ended deployments keep fulfillment credit',()=>{
  const result=manpowerDemandBalance({id:'line',originalRequested:10,currentAuthorized:12,cancelledUnfilled:2},[
    {lineId:'line',state:'Reserved'},{lineId:'line',state:'Scheduled'},
    {lineId:'line',state:'Confirmed'},{lineId:'line',state:'Ended'},
    {lineId:'line',state:'Reversed'},{lineId:'other',state:'Confirmed'},
  ]);
  assert.deepEqual(result,{originalRequested:10,currentAuthorized:12,cancelledUnfilled:2,effectiveCapacity:10,reserved:2,scheduled:1,fulfilled:2,activeDeployed:1,available:6});
});
test('capacity violations are rejected rather than clamped to zero',()=>{
  assert.throws(()=>manpowerDemandBalance({id:'line',currentAuthorized:1},[{lineId:'line',state:'Reserved'},{lineId:'line',state:'Ended'}]),/commitments/);
  assert.throws(()=>manpowerDemandBalance({id:'line',currentAuthorized:1,cancelledUnfilled:2}));
  assert.equal(manpowerDemandBalance({id:'line',currentAuthorized:3},[{lineId:'line',state:'Confirmed',creditVoided:true}]).fulfilled,0);
});
