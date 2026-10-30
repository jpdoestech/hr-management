export const GOVERNMENT_IDS=[
  {key:'sssNumber',label:'SSS Number',index:'hr_records_employee_sss_unique_idx'},
  {key:'philHealthNumber',label:'PhilHealth PIN',index:'hr_records_employee_philhealth_unique_idx'},
  {key:'pagIbigNumber',label:'Pag-IBIG MID',index:'hr_records_employee_pagibig_unique_idx'},
  {key:'tin',label:'BIR TIN',index:'hr_records_employee_tin_unique_idx'},
];

export function governmentIdKey(key,value){
  const digits=String(value??'').replace(/[^0-9]/g,'');
  return key==='tin'?digits.slice(0,9):digits;
}
export function governmentIdOwnerLabel(employee){
  const given=[employee.firstName,employee.middleName].filter(Boolean).join(' ');
  const name=employee.lastName&&given?`${employee.lastName}, ${given}`:employee.name;
  return [employee.clientName||'Client not assigned',employee.department||'Department not recorded',employee.position||'Position not recorded',name||'Name not recorded'].join(' | ');
}
const duplicateIssue=(field,owners=[])=>({id:`f_${field.key}`,message:`${field.label} already belongs to another employee.${owners.length?' Owner: '+[...new Set(owners.map(governmentIdOwnerLabel))].join('; ')+'.':''} Enter a unique value.`});

export function employeeGovernmentIdIssues(values,employees,excludeId='',showOwners=true){
  return GOVERNMENT_IDS.flatMap(field=>{
    const value=governmentIdKey(field.key,values[field.key]);
    const owners=value?employees.filter(employee=>(!excludeId||String(employee.id)!==String(excludeId))&&governmentIdKey(field.key,employee[field.key])===value):[];
    return owners.length?[duplicateIssue(field,showOwners?owners:[])]:[];
  });
}

export function governmentIdConflictIssue(error,owners=[]){
  if(error?.code!=='23505')return null;
  const field=GOVERNMENT_IDS.find(field=>error.constraint===field.index||String(error.message||'').includes('"'+field.index+'"'));
  return field?duplicateIssue(field,owners):null;
}

export async function governmentIdSaveIssue(client,error,rows){
  const fallback=governmentIdConflictIssue(error);
  if(!fallback)return null;
  const field=fallback.id.slice(2),entries=rows.filter(row=>row.module==='employees').map(row=>({record_id:row.record_id,value:row.data[field]||''}));
  if(!entries.length)return fallback;
  try{
    const {data,error:lookupError}=await client.rpc('employee_government_id_owners',{p_field:field,p_entries:entries});
    return !lookupError&&Array.isArray(data)?governmentIdConflictIssue(error,data):fallback;
  }catch{return fallback;}
}
