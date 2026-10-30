import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateBrowserReport,offlineFixture,isolatedProfile} from '../../scripts/test-browser.mjs';
import {expectedIds,contrastRatio} from '../browser/regression-suite.mjs';
const report=()=>({runId:'synthetic-run',fontMode:'offline-fallback',results:expectedIds().map(id=>({id,pass:true,durationMs:1}))});
test('browser reports require every unique scenario and viewport, but retain genuine failures',()=>{
  const complete=report();complete.results[0].pass=false;complete.results[0].error='Synthetic failure';
  assert.equal(validateBrowserReport(complete,'synthetic-run').filter(row=>!row.pass).length,1);
  for(const mutate of [r=>r.results.pop(),r=>r.results.push(r.results[0]),r=>r.results[1].id=r.results[0].id,r=>r.runId='another-run',r=>r.results[0].durationMs=NaN,r=>r.results[0].pass='true',r=>r.results[0].metrics={employeeName:'private payload'}]){
    const invalid=report();mutate(invalid);assert.throws(()=>validateBrowserReport(invalid,'synthetic-run'));
  }
});
test('offline fixtures retain real styles while blocking external connections and native form posts',()=>{
  const html=offlineFixture('<html><head><link href="https://fonts.googleapis.com/css?family=Example"><link href="css/workspace.css?v=1"></head><body><input id="synthetic" onclick="choose()"></body></html>');
  assert.doesNotMatch(html,/href="https:\/\/fonts/);assert.match(html,/href="\/css\/workspace.css\?v=1"/);
  assert.match(html,/connect-src 'self'/);assert.match(html,/form-action 'none'/);assert.match(html,/__fixtureErrors/);assert.match(html,/onclick="choose\(\)"/);
});
test('browser cleanup accepts only its own direct temporary profile directory',()=>{
  assert.equal(isolatedProfile(join(tmpdir(),'hr-browser-synthetic')),true);
  for(const path of [tmpdir(),join(tmpdir(),'ordinary-profile'),join(tmpdir(),'hr-browser-parent','child'),join(tmpdir(),'hr-browser-synthetic','..')])assert.equal(isolatedProfile(path),false,path);
});


test('browser contrast checks use unrounded WCAG luminance ratios',()=>{
  assert.equal(contrastRatio([0,0,0],[255,255,255]),21);
  assert.equal(contrastRatio([255,255,255],[255,255,255]),1);
  assert.ok(contrastRatio([154,168,183],[255,255,255])<4.5);
  assert.ok(contrastRatio([107,100,117],[250,250,252])>=4.5);
});
