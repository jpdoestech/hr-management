import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/app.js',import.meta.url),'utf8');
const styles=await readFile(new URL('../../css/professional.css',import.meta.url),'utf8');

test('employee relations transactions use one scoped TDA rule selector',()=>{
  assert.match(source,/const TDA_CONNECTED_MODULES=new Set\(\['disciplinary','nte','memos','nod'\]\)/);
  assert.match(source,/function tdaRuleSelectorHTML\(prefix,module,existingRule=null/);
  assert.match(source,/tdaRecordApplies\(record,info\.context\)/);
  assert.match(source,/vals\.tdaRule=tdaRule/);
  assert.match(source,/Object\.assign\(rec,\{[\s\S]{0,500}tdaRule\}\)/);
  assert.match(source,/category==='Charges'\?readTdaRuleSelection\('atd'\):null/);
});

test('TDA rule selection is a searchable keyboard-accessible policy picker',()=>{
  assert.match(source,/function tdaRulePickerMatches\(prefix,query=''/);
  assert.match(source,/filterTdaRecords\(tdaRulePickerRecords\(prefix\),query\)/);
  assert.match(source,/role="combobox" aria-autocomplete="list"/);
  assert.match(source,/function tdaRulePickerKeydown\(event,prefix\)/);
  assert.match(source,/event\.key==='Enter'/);
  assert.match(source,/data-tda-rule-id/);
  assert.match(styles,/\.tda-picker-options>button\.active/);
  assert.match(styles,/\.tda-picker-options\{position:static/);
});

test('TDA snapshots preserve the rule, occurrence, recommendation, and schedule',()=>{
  const snapshot=source.slice(source.indexOf('function tdaRuleSnapshot'),source.indexOf('function tdaRuleContext'));
  for(const field of ['catalogId','offenseNumber','offense','category','tdaType','levelIndex','offenseLevel','recommendedConsequence','consequences','scope','capturedAt']){
    assert.match(snapshot,new RegExp(`\\b${field}\\b`));
  }
  assert.match(source,/rec\.tdaRules\|\|\[\]/);
  assert.match(source,/const tdaRules=offenses\.map/);
});

test('HR cases link their governing TDA rule and inherit it into workflow records',()=>{
  assert.match(source,/async function syncCaseTdaRule\(caseId,rule\)/);
  assert.match(source,/module:'offenseCatalog'/);
  assert.match(source,/await syncCaseTdaRule\(id,tdaRule\)/);
  assert.match(source,/await syncCaseTdaRule\(data\.id,tdaRule\)/);
  assert.match(source,/loadCaseTdaRule\(caseId\)/);
  assert.match(source,/if\(caseRule\)[\s\S]{0,900}recommendedConsequence/);
  assert.match(source,/Governing TDA rule/);
});

test('TDA recommendation is presented as policy guidance, not an automatic decision',()=>{
  assert.match(source,/HR must still verify facts, due process, prior records, and applicable law before issuing a decision/);
  assert.match(styles,/\.tda-rule-card\{/);
  assert.match(styles,/\.case-tda-policy\{/);
  assert.match(styles,/@media\(max-width:720px\)\{\.tda-rule-controls,\.tda-rule-summary,\.case-tda-policy/);
});

test('case workspace tracks due-process readiness without auto-deciding liability',()=>{
  const tracker=source.slice(source.indexOf('function caseDueProcessHTML'),source.indexOf('function caseTransitionContext'));
  for(const label of ['Report / allegation','Governing TDA policy','First notice / NTE','Employee response','Findings','Approved decision','Finalized NOD'])assert.match(tracker,new RegExp(label.replace('/','\\/')));
  assert.doesNotMatch(tracker,/disciplinary/);
  assert.match(tracker,/Operational guidance only; HR remains responsible/);
  assert.match(source,/caseDueProcessHTML\(links\|\|\[\],allegations\|\|\[\],dueProcess,dueProcessReady\)/);
  assert.match(styles,/\.case-due-process-list\{/);
});
