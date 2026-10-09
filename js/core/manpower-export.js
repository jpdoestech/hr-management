function csvCell(value){
  let text=value==null?'':String(value);
  // Quoting alone does not stop spreadsheet formula execution on imported text.
  if(typeof value!=='number'&&(/^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}

export function manpowerCSV(rows,columns){
  const header=columns.map(column=>csvCell(column.label)).join(',');
  const body=rows.map(row=>columns.map(column=>csvCell(typeof column.get==='function'?column.get(row):row[column.key])).join(',')).join('\n');
  return header+'\n'+body;
}
