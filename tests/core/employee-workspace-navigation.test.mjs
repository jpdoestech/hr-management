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

test('employee transactions return to the selected overview on cancel or save',()=>{
  assert.match(source,/let EMPLOYEE_TRANSACTION_RETURN=null/);
  assert.match(source,/EMPLOYEE_TRANSACTION_RETURN=returnToEmployee\?\{employeeId:emp\.id,module,returnTarget:'overview'\}:null/);
  assert.match(source,/async function returnFromEmployeeTransaction\(keepUploads=\[\]\)/);
  const returnFlow=source.slice(source.indexOf('async function returnFromEmployeeTransaction'),source.indexOf('async function finishEmployeeTransaction'));
  assert.match(returnFlow,/finally\{[\s\S]*removeAttribute\('aria-busy'\)/);
  assert.match(source,/if\(EMPLOYEE_TRANSACTION_RETURN\)[\s\S]*returnFromEmployeeTransaction\(\)/);
  for(const saver of ['saveRecord','saveCVR','saveIncident','saveATDRecord','saveEval','saveCase']){
    const start=source.indexOf(`function ${saver}(`)>=0?source.indexOf(`function ${saver}(`):source.indexOf(`function ${saver}`);
    assert.ok(start>=0,`${saver} exists`);
    const nextFunction=source.slice(start+1).search(/^(?:async )?function /m);
    const body=source.slice(start,nextFunction<0?undefined:start+1+nextFunction);
    assert.match(body,/finishEmployeeTransaction\(/,`${saver} returns to employee context`);
  }
});

test('Access Control role editor keeps form fields away from modal edges',()=>{
  assert.match(styles,/\.access-role-editor>\.formgrid\{padding:17px 20px/);
  assert.match(styles,/\.access-editor-section,\.access-role-editor>\.formgrid\{padding:14px 13px/);
});
