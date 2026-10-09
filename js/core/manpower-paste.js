import {newManpowerDraft,validateManpowerDraft} from './manpower-draft.js';

export const MANPOWER_PASTE_FIELDS=[
  {key:'department',label:'Department',aliases:['department','dept']},
  {key:'position',label:'Position',aliases:['position','job title']},
  {key:'current_authorized',label:'Headcount',aliases:['headcount','quantity','requested headcount','authorized headcount']},
  {key:'demand_type',label:'Demand Type',aliases:['demand type','request type','type']},
  {key:'target_date',label:'Target Date',aliases:['target date','target deployment date']},
  {key:'site',label:'Site',aliases:['site','location','branch','reporting branch']},
  {key:'purpose',label:'Purpose / Remarks',aliases:['purpose','remarks','purpose remarks','notes']},
];
const normalized=value=>String(value??'').trim().replace(/[_/\s]+/g,' ').toLowerCase();

export function readManpowerPaste(text,xlsx){
  if(!text.trim())throw new Error('Paste requisition rows before previewing.');
  if(text.length>2000000)throw new Error('Paste is too large. Split the spreadsheet into smaller batches.');
  const workbook=xlsx.read(text,{type:'string',raw:true});
  return xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true,defval:'',blankrows:true});
}
export function detectManpowerPasteMapping(matrix,hasHeader=true){
  const width=matrix.reduce((max,row)=>Math.max(max,row.length),0);
  if(width>64)throw new Error('Paste only the requisition columns (maximum 64 source columns).');
  return Array.from({length:width},(_,index)=>hasHeader?
    MANPOWER_PASTE_FIELDS.find(field=>field.aliases.includes(normalized(matrix[0]?.[index])))?.key||'':MANPOWER_PASTE_FIELDS[index]?.key||'');
}
function catalogName(value,values){
  if(!value)return '';
  const matches=values.filter(name=>normalized(name)===normalized(value));
  return matches.length===1?matches[0]:value;
}
export function previewManpowerPaste(matrix,mapping,catalogs,{hasHeader=true,requestDate=''}={}){
  const errors=[];
  const keys=new Set(MANPOWER_PASTE_FIELDS.map(field=>field.key));
  const selected=mapping.filter(Boolean);
  if(selected.some(key=>!keys.has(key)))errors.push('Select a valid destination for each mapped column.');
  if(new Set(selected).size!==selected.length)errors.push('Map each destination field only once.');
  for(const key of ['department','position','current_authorized'])if(!selected.includes(key))errors.push(`Map ${MANPOWER_PASTE_FIELDS.find(field=>field.key===key).label}.`);
  const rows=[];
  matrix.forEach((values,index)=>{
    if(hasHeader&&index===0||values.every(value=>!String(value??'').trim()))return;
    const line={department:'',position:'',current_authorized:'',demand_type:'Expansion',target_date:'',site:'',purpose:''};
    mapping.forEach((key,column)=>{if(keys.has(key))line[key]=String(values[column]??'').trim();});
    line.department=catalogName(line.department,catalogs.departments.filter(row=>row.active).map(row=>row.name));
    line.position=catalogName(line.position,catalogs.positions.filter(row=>row.active&&row.department===line.department).map(row=>row.name));
    line.site=catalogName(line.site,catalogs.branches);
    line.demand_type=catalogName(line.demand_type,['Expansion','Replacement']);
    const draft=newManpowerDraft('paste',`paste-${index}`);
    draft.request.date_requested=requestDate;draft.lines=[{id:`paste-${index}`,...line}];
    const rowErrors=validateManpowerDraft(draft,catalogs).errors.map(error=>error.replace(/^Line 1: /,''));
    for(const key of ['department','position','current_authorized'])if(!line[key])rowErrors.push(`${MANPOWER_PASTE_FIELDS.find(field=>field.key===key).label} is required for pasted rows.`);
    if(line.purpose.length>10000)rowErrors.push('Purpose / Remarks cannot exceed 10000 characters.');
    if(values.slice(mapping.length).some(value=>String(value??'').trim()))rowErrors.push('Unmapped extra cells found. Preview the column mapping again.');
    rows.push({sourceRow:index+1,line,errors:rowErrors});
  });
  if(!rows.length)errors.push('No requisition rows found.');
  return {rows,errors,valid:!errors.length&&rows.length>0&&rows.every(row=>!row.errors.length)};
}
