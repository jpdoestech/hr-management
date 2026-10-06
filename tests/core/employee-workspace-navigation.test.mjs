import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const styles=await readFile(new URL('../../css/professional.css',import.meta.url),'utf8');

test('employee workspace tabs navigate in place without closing the modal first',()=>{
  assert.match(source,/async function employeeWorkspaceNavigate\(employeeId,target='overview'\)/);
  assert.match(source,/onclick="employeeWorkspaceNavigate\('\$\{emp\.id\}','\$\{key\}'\)"/);
  assert.match(source,/Object\.assign\(window,[\s\S]*employeeWorkspaceNavigate/);
  assert.doesNotMatch(source,/employeeWorkspaceNav[\s\S]{0,900}onclick="closeModal\(\);\$\{handler\}"/);
});

test('discarding employee edits keeps the selected employee workspace open',()=>{
  assert.match(source,/title:'Unsaved employee changes'/);
  assert.match(source,/if\(choice!=='discard'\)return false;[\s\S]*MODAL_EDIT_STATE=null/);
  assert.match(source,/overview:\(\)=>openEmployeeProfile\(employee\.id\)/);
  assert.match(source,/employeeWorkspaceNavigate\('\$\{emp\.id\}','overview'\)/);
});

test('workspace transitions expose a stable busy state',()=>{
  assert.match(source,/setAttribute\('aria-busy','true'\)/);
  assert.match(source,/removeAttribute\('aria-busy'\)/);
  assert.match(styles,/employee-workspace-modal\[aria-busy="true"\]/);
});
