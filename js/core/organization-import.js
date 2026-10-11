const clean=value=>String(value??'').trim().replace(/\s+/g,' ');
export function parseOrganizationImport(matrix){
  if(!Array.isArray(matrix)||!matrix.length)throw new Error('The worksheet is empty.');
  const headers=matrix[0].map(value=>clean(value).toLowerCase());
  const department=headers.indexOf('department'),position=headers.indexOf('position');
  if(department<0)throw new Error('A Department column is required. Position is optional.');
  const rows=[],errors=[];
  if(matrix.length>2001)throw new Error('Import at most 2,000 rows at a time.');
  matrix.slice(1).forEach((row,index)=>{
    if(!row.some(value=>clean(value)))return;
    const item={department:clean(row[department]),position:position<0?'':clean(row[position])};
    if(!item.department||item.department.length>60||item.position.length>80)errors.push(`Row ${index+2}: Department is required (maximum 60 characters); Position allows 80 characters.`);
    else rows.push(item);
  });
  if(errors.length)throw new Error(errors.slice(0,5).join('\n'));
  if(!rows.length)throw new Error('No departments or positions found.');
  return rows;
}
