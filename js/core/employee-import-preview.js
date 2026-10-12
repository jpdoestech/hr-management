export function filterEmployeeImportRows(rows,filter='all'){
  return rows.filter(row=>filter==='ready'?!row.errors.length:filter==='errors'?row.errors.length>0:filter==='warnings'?row.warnings.length>0:true);
}
export function employeeImportCorrection(row,values,baseline){
  const source=structuredClone(row.sourceValues||row.values);
  for(const [key,value] of Object.entries(values)){
    if(key==='allowances'){
      for(const name of new Set([...Object.keys(value),...Object.keys(baseline.allowances||{})])){
        const amount=value[name]??'';
        if(String(amount)===String(baseline.allowances?.[name]??''))continue;
        source[`allowance:${name}`]=amount;
        if(source.allowances){if(amount==='')delete source.allowances[name];else source.allowances[name]=amount;}
      }
    }else if(['homeAddress','presentAddress','address','presentAddressText'].includes(key)||String(value)!==String(baseline[key]))source[key]=value;
  }
  return source;
}
export function revalidateEmployeeImport(preview,validate){
  const accepted=[];
  preview.rows=preview.rows.map(row=>{
    const sourceValues=structuredClone(row.sourceValues||row.values);
    // Allowance columns use workbook keys, while the employee form uses an object.
    for(const [name,amount] of Object.entries(sourceValues.allowances||{}))sourceValues[`allowance:${name}`]=amount;
    const next=validate(sourceValues,row.rowNumber,accepted);
    if(!sourceValues.employeeNo)sourceValues.employeeNo=next.values.employeeNo;
    for(const key of ['homeAddress','presentAddress','presentAddressText'])if(sourceValues[key]!==undefined)next.values[key]=sourceValues[key];
    if(!next.errors.length)accepted.push(next.values);
    return {...next,sourceValues};
  });
  return preview;
}
export function employeeImportPreviewHTML(preview,summary,esc){
  const filter=preview.filter||'all',rows=filterEmployeeImportRows(preview.rows,filter);
  const cards=[['ready','Ready',summary.valid,''],['errors','Errors',summary.errors,summary.errors?'has-error':''],['warnings','Warnings',summary.warnings,summary.warnings?'has-warning':'']];
  return `<div class="employee-import-summary">${cards.map(([key,label,count,style])=>`<button type="button" class="${style}" aria-pressed="${filter===key}" onclick="filterEmployeeImport('${key}')"><span>${label}</span><b>${count}</b></button>`).join('')}</div><div class="data-toolbar"><button type="button" class="btn btn-ghost btn-sm" aria-pressed="${filter==='all'}" onclick="filterEmployeeImport('all')">All rows</button><span class="small" role="status">${rows.length} of ${summary.total} rows shown</span></div>${preview.fileErrors.length?`<div class="employee-import-file-errors"><b>Workbook errors</b>${preview.fileErrors.map(issue=>`<span>${esc(issue)}</span>`).join('')}</div>`:''}<div class="tablewrap employee-import-preview"><table class="data-table"><thead><tr><th>Row</th><th>Employee No.</th><th>Employee</th><th>Department</th><th>Branch Reporting</th><th>Validation</th></tr></thead><tbody>${rows.map(row=>`<tr onclick="if(!event.target.closest('button'))openEmployeeImportRow(${row.rowNumber})"><td class="mono">${row.rowNumber}</td><td class="mono">${esc(row.values.employeeNo||'—')}</td><td><button type="button" class="employee-import-row-edit" aria-label="Edit import row ${row.rowNumber}: ${esc(row.values.name||'Incomplete name')}" onclick="openEmployeeImportRow(${row.rowNumber})">${esc(row.values.name||'Incomplete name')}</button><div class="small">${esc(row.values.position||'—')}</div></td><td>${esc(row.values.department||'—')}</td><td>${esc(row.values.branchReporting||'—')}</td><td>${row.errors.length?`<div class="import-issues error">${row.errors.map(issue=>`<span>${esc(issue)}</span>`).join('')}</div>`:''}${row.warnings.length?`<div class="import-issues warning">${row.warnings.map(issue=>`<span>${esc(issue)}</span>`).join('')}</div>`:''}${!row.errors.length&&!row.warnings.length?'<span class="badge b-green"><span class="dot"></span>Ready</span>':''}</td></tr>`).join('')||'<tr><td colspan="6"><div class="empty">No rows match this filter.</div></td></tr>'}</tbody></table></div>`;
}
