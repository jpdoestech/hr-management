import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {employeeTemplateBytes} from '../../js/core/employee-template-validation.js';
const context={};vm.createContext(context);vm.runInContext(readFileSync(new URL('../../js/vendor/xlsx.full.min.js',import.meta.url),'utf8'),context);
const XLSX=context.XLSX;
test('generated XLSX contains stop validations, dependent named ranges, hidden lists and no address dropdown',()=>{
  const columns=[{key:'department',options:['Production','HR']},{key:'position'},{key:'status',options:['Active','Separated']},{key:'statusReason'},{key:'gender',options:['Male','Female']},{key:'address'}];
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([columns.map(column=>column.key)]),'Employees');
  const bytes=employeeTemplateBytes(XLSX,workbook,columns,[{name:'Operator',department:'Production'}],{Active:['Active / Normal'],Separated:['Resigned']});
  const zip=XLSX.CFB.read(bytes,{type:'buffer'}),get=path=>new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(zip,'/'+path).content));
  const sheet=get('xl/worksheets/sheet1.xml'),meta=get('xl/workbook.xml');
  assert.match(sheet,/<dataValidations count="5">/);assert.match(sheet,/errorStyle="stop"/);
  assert.ok(sheet.indexOf('<dataValidations')<sheet.indexOf('<ignoredErrors'),'validation must precede ignoredErrors even without page margins');
  assert.match(sheet,/VLOOKUP\(\$A2,_DepartmentMap/);assert.match(sheet,/VLOOKUP\(\$C2,_StatusMap/);
  assert.match(sheet,/sqref="B2:B10001"/);assert.doesNotMatch(sheet,/sqref="F2:/);
  assert.match(meta,/name="_Validation"[^>]*state="hidden"/);assert.match(meta,/definedName name="_DepartmentMap"/);
  const reopened=XLSX.read(bytes,{type:'buffer'});assert.equal(reopened.SheetNames[0],'Employees');
  assert.ok(get('xl/worksheets/sheet2.xml').includes('Operator'));
});
test('employee template preserves OOXML order with autofilter and optional page margins',()=>{
  for(const margins of [false,true]){
    const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['Gender']]);
    sheet['!autofilter']={ref:'A1:A1'};
    if(margins)sheet['!margins']={left:0.7,right:0.7,top:0.75,bottom:0.75,header:0.3,footer:0.3};
    XLSX.utils.book_append_sheet(workbook,sheet,'Employees');
    const bytes=employeeTemplateBytes(XLSX,workbook,[{key:'gender',options:['Male','Female']}],[],{});
    const zip=XLSX.CFB.read(bytes,{type:'buffer'}),xml=new TextDecoder().decode(new Uint8Array(XLSX.CFB.find(zip,'/xl/worksheets/sheet1.xml').content));
    const validation=xml.indexOf('<dataValidations');
    assert.ok(xml.indexOf('<autoFilter')<validation);
    assert.ok(validation<xml.indexOf('<ignoredErrors'));
    if(margins)assert.ok(validation<xml.indexOf('<pageMargins'));
    assert.equal((xml.match(/<dataValidations\b/g)||[]).length,1);
  }
});
