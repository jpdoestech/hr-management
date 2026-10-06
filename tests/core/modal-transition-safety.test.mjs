import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const index=await readFile(new URL('../../index.html',import.meta.url),'utf8');

test('modal transitions always release their interaction lock',()=>{
  assert.match(source,/function openModal\(html\)\{[\s\S]{0,300}removeAttribute\('aria-busy'\)/);
  const transition=source.slice(source.indexOf('async function transitionModal'),source.indexOf('async function closeModal'));
  assert.match(transition,/if\(MODAL_TRANSITIONING\|\|typeof openTarget!=='function'\)return false/);
  assert.match(transition,/finally\{[\s\S]*MODAL_TRANSITIONING=false;[\s\S]*removeAttribute\('aria-busy'\)/);
});

test('nested workflow and manpower dialogs transition without blanking the modal',()=>{
  const workflow=source.slice(source.indexOf('async function workflowOpenSource'),source.indexOf('function openWorkflowTask'));
  assert.match(workflow,/transitionModal\(\(\)=>openCaseDetails/);
  assert.match(workflow,/transitionModal\(\(\)=>openLifecycleChecklist/);
  assert.match(workflow,/transitionModal\(\(\)=>openEvalForm/);
  assert.doesNotMatch(workflow,/closeModal\(\); open(?:CaseDetails|LifecycleChecklist|EvalForm)/);

  for(const saver of ['saveManpowerRequirement','saveManpowerSlot']){
    const start=source.indexOf(`async function ${saver}`);
    const end=source.indexOf('\nfunction ',start+1);
    const body=source.slice(start,end);
    assert.match(body,/transitionModal\(\(\)=>openManpowerRequestDetails/);
    assert.doesNotMatch(body,/await closeModal\(\)/);
  }
});

test('inline UI handlers are exposed by the ES module',()=>{
  const exportStart=source.indexOf('Object.assign(window, {');
  const exportEnd=source.indexOf('\n});',exportStart);
  assert.ok(exportStart>=0&&exportEnd>exportStart,'window handler export exists');
  const exposed=new Set(source.slice(exportStart,exportEnd).match(/\b[A-Za-z_$][\w$]*\b/g)||[]);
  const browserCalls=new Set([
    'String','Number','Boolean','Array','Object','Math','Date','Promise','parseInt','parseFloat',
    'setTimeout','clearTimeout','encodeURIComponent','decodeURIComponent','confirm','alert','if',
  ]);
  const missing=new Set();
  for(const markup of [source,index]){
    for(const match of markup.matchAll(/\bon(?:click|change|input|keydown|submit|focus|blur)="([^"]+)"/g)){
      for(const call of match[1].matchAll(/(?<!\.)\b([A-Za-z_$][\w$]*)\s*\(/g)){
        const name=call[1];
        if(!browserCalls.has(name)&&!exposed.has(name))missing.add(name);
      }
    }
  }
  assert.deepEqual([...missing].sort(),[],'every inline event handler resolves on window');
});
