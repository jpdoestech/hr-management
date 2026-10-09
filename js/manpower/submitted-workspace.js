const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function bounds(page,size){
  size=[10,25,50].includes(Number(size))?Number(size):10;
  page=Math.max(1,Math.floor(Number(page)||1));
  return [(page-1)*size,page*size-1];
}
function checked(result){if(result.error)throw result.error;return result;}
export async function loadSubmittedRequests(client,{page=1,size=10,search='',branch=''}={}){
  let query=client.from('hr_manpower_requests').select('id,prf_number,branch_reporting,date_requested,target_date,updated_at,state',{count:'exact'})
    .eq('state','Open').order('updated_at',{ascending:false}).order('id').range(...bounds(page,size));
  if(search.trim())query=query.ilike('prf_number',`%${search.trim().replace(/[\\%_]/g,'\\$&')}%`);
  if(branch)query=query.eq('branch_reporting',branch);
  return checked(await query);
}
export async function loadSubmittedRequest(client,id){
  const result=checked(await client.from('hr_manpower_requests')
    .select('id,prf_number,branch_reporting,requested_by,date_requested,target_date,priority,remarks,state,revision,submitted_at,hr_manpower_clients(name)')
    .eq('id',id).eq('state','Open').single());
  return result.data;
}
export async function loadSubmittedRows(client,id,kind,{page=1,size=10}={}){
  let query;
  if(kind==='history')query=client.from('hr_manpower_quantity_history')
    .select('line_id,event_type,original_requested,current_authorized,cancelled_unfilled,request_revision,hr_manpower_lines!inner(request_id,ordinal,department,position)',{count:'exact'})
    .eq('hr_manpower_lines.request_id',id).order('request_revision',{ascending:false}).order('line_id');
  else query=client.from('hr_manpower_lines')
    .select('id,ordinal,department,position,original_requested,current_authorized,cancelled_unfilled,demand_type,target_date,site,purpose',{count:'exact'})
    .eq('request_id',id).order('ordinal').order('id');
  return checked(await query.range(...bounds(page,size)));
}
export function submittedListRowsHTML(rows,formatDate){
  return rows.map(row=>`<tr><td><button type="button" class="btn btn-ghost btn-sm" onclick="openManpowerSubmitted(${escape(JSON.stringify(row.id))})">${escape(row.prf_number)}</button></td><td>${escape(row.branch_reporting)}</td><td>${escape(formatDate(row.date_requested))}</td><td>${escape(formatDate(row.target_date))}</td><td>${escape(row.state)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty">No matching submitted requests.</div></td></tr>';
}
export function submittedHeaderHTML(request,formatDate){
  const fields=[['Client',request.hr_manpower_clients?.name||'Unavailable'],['Reporting Branch',request.branch_reporting],['Requested By',request.requested_by],['Date Requested',formatDate(request.date_requested)],['Target Date',formatDate(request.target_date)],['Priority',request.priority],['State',request.state],['Revision',request.revision],['Submitted',formatDate(request.submitted_at?.slice(0,10))]];
  return `<section class="manpower-submitted-header" aria-label="Request summary"><dl>${fields.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value??'')}</dd></div>`).join('')}</dl>${request.remarks?`<p class="manpower-submitted-remarks">${escape(request.remarks)}</p>`:''}</section>`;
}
export function submittedTableHTML(rows,kind,formatDate,headerTarget=''){
  const history=kind==='history';
  const headers=history?['Department / Position','Event','Original','Authorized','Cancelled','Revision']:['Department','Position','Original','Authorized','Cancelled','Target','Details'];
  const body=rows.map(row=>history?`<tr><td>${escape(row.hr_manpower_lines?.ordinal==null?row.line_id:'Line '+(row.hr_manpower_lines.ordinal+1))}<div>${escape(row.hr_manpower_lines?.department)} / ${escape(row.hr_manpower_lines?.position)}</div></td><td>${escape(row.event_type)}</td><td>${escape(row.original_requested)}</td><td>${escape(row.current_authorized)}</td><td>${escape(row.cancelled_unfilled)}</td><td>${escape(row.request_revision)}</td></tr>`:
    `<tr><td>${escape(row.department)}</td><td>${escape(row.position)}</td><td>${escape(row.original_requested)}</td><td>${escape(row.current_authorized)}</td><td>${escape(row.cancelled_unfilled)}</td><td>${escape(formatDate(row.target_date||headerTarget))}</td><td><details><summary>Line ${escape(row.ordinal+1)} details</summary><dl><dt>Demand Type</dt><dd>${escape(row.demand_type)}</dd><dt>Site</dt><dd>${escape(row.site||'Not specified')}</dd><dt>Purpose / Remarks</dt><dd>${escape(row.purpose||'Not specified')}</dd></dl></details></td></tr>`).join('');
  return `<div class="tablewrap" tabindex="0" role="region" aria-label="${history?'Quantity history records':'Requisition line records'}"><table class="data-table" data-server-paginated="true" data-table-tools="external"><caption class="sr-only">${history?'Quantity history':'Submitted requisition lines'}</caption><thead><tr>${headers.map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${headers.length}"><div class="empty">No ${history?'quantity history':'requisition lines'} available.</div></td></tr>`}</tbody></table></div>`;
}
