import {manpowerQuantity,normalizePrfNumber} from './manpower-demand.js';

export const DRAFT_HEADER_FIELDS=['prf_number','client_id','branch_reporting','requested_by','date_requested','target_date','priority','remarks'];
export const DRAFT_LINE_FIELDS=['id','department','position','current_authorized','demand_type','target_date','site','purpose'];
export function newManpowerDraft(id,newId){
  return {request:{id,revision:0,prf_number:'',client_id:'',branch_reporting:'',requested_by:'',date_requested:'',target_date:'',priority:'Normal',remarks:''},
    lines:[{id:newId,department:'',position:'',current_authorized:'',demand_type:'Expansion',target_date:'',site:'',purpose:''}]};
}
export function validateManpowerDraft(draft,{clients=[],departments=[],positions=[],branches=[]}={}){
  const errors=[];
  const header=Object.fromEntries(DRAFT_HEADER_FIELDS.map(key=>[key,String(draft.request[key]??'').trim()]));
  header.prf_number=header.prf_number.replace(/\s+/g,' ');
  const lines=draft.lines.map(row=>Object.fromEntries(DRAFT_LINE_FIELDS.map(key=>[key,String(row[key]??'').trim()])));
  if(header.prf_number.length>120)errors.push('PRF number cannot exceed 120 characters.');
  if(header.client_id&&!clients.some(row=>row.id===header.client_id&&(row.active||row.id===draft.originalClientId)))errors.push('Select a configured active Client Account.');
  if(header.branch_reporting&&!branches.includes(header.branch_reporting))errors.push('Select a configured reporting branch.');
  if(!['Low','Normal','High','Urgent'].includes(header.priority))errors.push('Select a valid priority.');
  function validDate(value){if(!value)return true;const date=new Date(value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
  if(!validDate(header.date_requested)||!validDate(header.target_date))errors.push('Enter valid request and target dates.');
  if(header.date_requested&&header.target_date&&header.target_date<header.date_requested)errors.push('Target cannot precede the request date.');
  if(new Set(lines.map(row=>row.id)).size!==lines.length||lines.some(row=>!row.id||row.id.length>100||!/^[A-Za-z0-9_-]+$/.test(row.id)))errors.push('Each line must have a distinct stable id.');
  lines.forEach((row,index)=>{
    const prefix=`Line ${index+1}: `;
    if(row.department&&!departments.some(item=>item.name===row.department&&item.active))errors.push(prefix+'select an active department.');
    if(row.position&&!positions.some(item=>item.name===row.position&&item.department===row.department&&item.active))errors.push(prefix+'position must belong to its department.');
    if(row.current_authorized){try{row.current_authorized=manpowerQuantity(row.current_authorized);}catch(error){errors.push(prefix+error.message);}}
    else row.current_authorized=null;
    if(!['Expansion','Replacement'].includes(row.demand_type))errors.push(prefix+'select Expansion or Replacement.');
    if(row.site&&!branches.includes(row.site))errors.push(prefix+'select a configured site.');
    if(!validDate(row.target_date))errors.push(prefix+'enter a valid target date.');
    if(header.date_requested&&row.target_date&&row.target_date<header.date_requested)errors.push(prefix+'target cannot precede the request date.');
  });
  return {header,lines,errors,normalizedPrf:normalizePrfNumber(header.prf_number)};
}
