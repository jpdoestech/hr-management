import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCESS_PERMISSION_KEYS,EMPLOYEE_RELATIONS_CAPABILITIES,evaluateEffectiveAccess,legacyPermissions} from '../../js/core/access-control.js';

test('direct deny takes precedence over role and direct grant',()=>{
  const result=evaluateEffectiveAccess({rolePermissions:['employees.update'],directGrants:['employees.update'],directDenies:['employees.update']});
  assert.deepEqual(result['employees.update'],{allowed:false,source:'direct-deny'});
});

test('direct grant adds permission absent from roles',()=>{
  const result=evaluateEffectiveAccess({directGrants:['analytics.export']});
  assert.deepEqual(result['analytics.export'],{allowed:true,source:'direct-grant'});
});

test('superadmin receives every applicable permission',()=>{
  const result=evaluateEffectiveAccess({superAdmin:true,directDenies:['employees.delete']});
  assert.equal(Object.keys(result).length,ACCESS_PERMISSION_KEYS.length);
  assert.deepEqual(result['employees.delete'],{allowed:true,source:'superadmin'});
});

test('legacy employee access is limited to self-service',()=>{
  assert.deepEqual(legacyPermissions('Employee'),['self_service.view','self_service.update']);
});

test('legacy viewer export remains opt-in',()=>{
  assert.equal(legacyPermissions('Viewer').some(key=>key.endsWith('.export')),false);
  assert.ok(legacyPermissions('Viewer',true).includes('analytics.export'));
});

test('Employee Relations has separate confidential and process-stage capabilities',()=>{
  const keys=new Set(EMPLOYEE_RELATIONS_CAPABILITIES.map(item=>item.key));
  assert.ok(keys.has('employee_relations.view_confidential'));
  assert.ok(keys.has('employee_relations.approve_decision'));
  assert.ok(keys.has('employee_relations.override_tda_recommendation'));
  assert.equal(keys.size,18);
});
