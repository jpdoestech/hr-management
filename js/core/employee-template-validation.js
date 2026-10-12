const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
// SheetJS CE writes the workbook but not Excel data validation. Its bundled CFB
// ZIP API preserves the generated package while adding the worksheet element.
export function employeeTemplateBytes(XLSX,workbook,columns,positions,statusReasons){
  const lists=[],names=[],rules=[];
  const addList=(values,name)=>{
    const col=XLSX.utils.encode_col(lists.length),unique=[...new Set(values.filter(Boolean).map(String))];
    lists.push([name,...(unique.length?unique:[''])]);
    names.push({Name:name,Ref:`'_Validation'!$${col}$2:$${col}$${Math.max(2,unique.length+1)}`});
    return name;
  };
  addList([],'_Empty');
  columns.forEach((column,index)=>{
    if(column.key==='address'||!column.options)return;
    rules.push({column:index,formula:addList(column.options,`_Options${index}`)});
  });
  const dependency=(key,parent,groups,prefix)=>{
    const index=columns.findIndex(column=>column.key===key),parentIndex=columns.findIndex(column=>column.key===parent);
    if(index<0||parentIndex<0)return;
    const keys=[],refs=[];
    groups.forEach(([label,values],i)=>{keys.push(label);refs.push(addList(values,`_${prefix}${i}`));});
    const start=lists.length,col=XLSX.utils.encode_col(start),end=XLSX.utils.encode_col(start+1);
    lists.push([prefix,...keys],[`${prefix}Lists`,...refs]);
    names.push({Name:`_${prefix}Map`,Ref:`'_Validation'!$${col}$2:$${end}$${Math.max(2,keys.length+1)}`});
    rules.push({column:index,formula:`IFERROR(INDIRECT(VLOOKUP($${XLSX.utils.encode_col(parentIndex)}2,_${prefix}Map,2,FALSE)),_Empty)`});
  };
  dependency('position','department',(columns.find(column=>column.key==='department')?.options||[]).map(name=>[name,positions.filter(item=>item.department.toLowerCase()===name.toLowerCase()).map(item=>item.name)]),'Department');
  dependency('statusReason','status',Object.entries(statusReasons),'Status');
  const height=Math.max(...lists.map(list=>list.length)),matrix=Array.from({length:height},(_,row)=>lists.map(list=>list[row]??''));
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(matrix),'_Validation');
  workbook.Workbook={...workbook.Workbook,Names:[...(workbook.Workbook?.Names||[]),...names]};
  XLSX.utils.book_set_sheet_visibility(workbook,'_Validation',1);
  const zip=XLSX.CFB.read(XLSX.write(workbook,{type:'binary',bookType:'xlsx'}),{type:'binary'});
  const entry=XLSX.CFB.find(zip,'/xl/worksheets/sheet1.xml');
  if(!entry)throw new Error('Employee worksheet was not generated.');
  const content=new TextDecoder().decode(new Uint8Array(entry.content));
  const validations=`<dataValidations count="${rules.length}">${rules.map(rule=>`<dataValidation type="list" allowBlank="1" showErrorMessage="1" showInputMessage="1" errorStyle="stop" errorTitle="Invalid selection" error="Choose a value from the dropdown." promptTitle="Approved values" prompt="Select an approved value." sqref="${XLSX.utils.encode_col(rule.column)}2:${XLSX.utils.encode_col(rule.column)}10001"><formula1>${xml(rule.formula)}</formula1></dataValidation>`).join('')}</dataValidations>`;
  // OOXML requires validations before all following worksheet elements, including
  // ignoredErrors (which SheetJS emits even when pageMargins is absent).
  const following=/<(?:hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(content);
  const offset=following?.index??content.lastIndexOf('</worksheet>');
  if(offset<0)throw new Error('Employee worksheet XML is incomplete.');
  const updated=content.slice(0,offset)+validations+content.slice(offset);
  XLSX.CFB.utils.cfb_add(zip,'/xl/worksheets/sheet1.xml',new TextEncoder().encode(updated));
  return new Uint8Array(XLSX.CFB.write(zip,{type:'buffer',fileType:'zip'}));
}
