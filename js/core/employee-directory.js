const FIELD_DEPENDENCIES={
  name:['name','lastName','firstName','middleName'],
  classification:['dateHired','classOverride'],
  address:['homeAddress','address'],
  presentAddress:['presentAddress','presentAddressText'],
  allowances:['allowances'],
};

export function employeeDirectoryProjection(columns=[]){
  const fields=new Set(['id']);
  columns.forEach(column=>{
    const key=typeof column==='string'?column:column?.key;
    if(!key)return;
    const dependencies=key.startsWith('allowance:')?FIELD_DEPENDENCIES.allowances:FIELD_DEPENDENCIES[key]||[key];
    dependencies.forEach(field=>fields.add(field));
  });
  return [...fields];
}
