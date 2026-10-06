import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCESS_PERMISSION_KEYS,evaluateEffectiveAccess,legacyPermissions} from '../../js/core/access-control.js';

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
