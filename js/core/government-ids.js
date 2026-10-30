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
const duplicateIssue=field=>({id:`f_${field.key}`,message:`${field.label} already belongs to another employee. Enter a unique value.`});

export function employeeGovernmentIdIssues(values,employees,excludeId=''){
  return GOVERNMENT_IDS.filter(field=>{
    const value=governmentIdKey(field.key,values[field.key]);
    return value&&employees.some(employee=>(!excludeId||String(employee.id)!==String(excludeId))&&governmentIdKey(field.key,employee[field.key])===value);
  }).map(duplicateIssue);
}

export function governmentIdConflictIssue(error){
  if(error?.code!=='23505')return null;
  const field=GOVERNMENT_IDS.find(field=>error.constraint===field.index||String(error.message||'').includes('"'+field.index+'"'));
  return field?duplicateIssue(field):null;
}
