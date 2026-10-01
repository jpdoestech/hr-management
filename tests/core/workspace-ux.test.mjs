import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const styles=await readFile(new URL('../../css/professional.css',import.meta.url),'utf8');
const index=await readFile(new URL('../../index.html',import.meta.url),'utf8');

test('dashboard, analytics, automation, and weekly report expose focused tab views',()=>{
  for(const handler of ['dashboardSetTab','analyticsSetTab','automationSetTab','weeklySetTab']){
    assert.match(source,new RegExp(`function ${handler}\\(`));
    assert.match(source,new RegExp(`onclick="${handler}\\(`));
  }
  for(const label of ['Records & Mix','Workforce','Generated Work','Disciplinary']){
    assert.match(source,new RegExp(label.replace(/[&]/g,'\\&')));
  }
});

test('dashboard and analytics tabs reuse fetched case snapshots',()=>{
  assert.match(source,/renderDashboard\(\{skipFetch:true\}\)/);
  assert.match(source,/DASHBOARD_CASE_CACHE/);
  assert.match(source,/renderAnalytics\(\{skipFetch:true\}\)/);
  assert.match(source,/ANALYTICS_CASE_CACHE/);
});

test('automation browsing does not rerun the automation engine',()=>{
  assert.match(source,/renderAutomationCenter\(\{skipEngine:true\}\)/);
  assert.match(source,/if\(!skipEngine\)/);
  assert.match(source,/queueSearchRender\(this,'automationSearch',\(\)=>renderAutomationCenter\(\{skipEngine:true\}\)\)/);
});

test('shared workspace tabs and weekly tables have responsive overflow controls',()=>{
  assert.match(styles,/\.workspace-tabs\{/);
  assert.match(styles,/overflow-x:auto/);
  assert.match(styles,/\.workspace-section-hidden\{display:none!important;\}/);
  assert.match(styles,/\.weekly-report-panel>\.tablewrap/);
  assert.match(styles,/position:sticky/);
});

test('session restoration prevents a login-screen flash',()=>{
  assert.match(index,/<body class="session-pending">/);
  assert.match(index,/id="session-splash"/);
  assert.match(styles,/body\.session-pending #auth-screen,body\.session-pending #app\{visibility:hidden;\}/);
  assert.match(source,/function revealSessionUI\(\)/);
  assert.match(source,/if\(data\.session\)await bootAuthenticated/);
  assert.match(source,/else revealSessionUI\(\)/);
});
