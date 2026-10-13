import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../../css/professional.css',import.meta.url),'utf8');
const typography=css.slice(css.indexOf('/* Shared dialog typography.'));
test('employee record typography increases values by 30% without resizing dialogs',()=>{
  assert.equal(11*1.3,14.3);assert.equal(10.5*1.3,13.65);
  assert.match(typography,/--modal-value-size:14\.3px/);
  assert.match(typography,/\.profile-detail \.value[^\n]*font-size:13\.65px/);
  assert.doesNotMatch(typography,/(?:^|[;{])(?:width|height|max-width|max-height):/);
});
test('shared dialog controls use the same type scale across employee and other forms',()=>{
  assert.match(typography,/\.modal \.modal-body \.field label\{font-size:var\(--modal-label-size\)/);
  assert.match(typography,/\.modal \.modal-body \.field :is\(input,select,textarea\)\{font-size:var\(--modal-value-size\)/);
  assert.match(typography,/\.modal :is\(input,select,textarea,button\)\{font-family:inherit/);
  assert.match(typography,/\.modal \.employee-profile-tabs\{position:static;flex-wrap:wrap/);
});
test('mobile dialogs retain readable controls, wrapping and touch targets',()=>{
  assert.match(typography,/@media\(max-width:720px\)/);
  assert.match(typography,/\.field :is\(input,select,textarea\)\{font-size:16px/);
  assert.match(typography,/min-height:44px/);
  assert.match(typography,/white-space:normal;overflow-wrap:anywhere/);
});
