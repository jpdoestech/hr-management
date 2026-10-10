const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const WORKER_STATES=['Reserved','Scheduled','Deployed','Ended','Released','Reversed'];
export async function loadLineWorkers(client,request,line,{page=1,size=10,search='',state=''}={}){
  if(!request||!line||!Number.isSafeInteger(page)||page<1||![10,25,50].includes(size)||search.length>120||!['',...WORKER_STATES].includes(state))throw new Error('Invalid worker list filters');
  const {data,error}=await client.rpc('manpower_line_workers',{p_request:request,p_line:line,p_page:page,p_size:size,p_search:search.trim(),p_state:state});
  if(error)throw error;
  if(!data||!Number.isSafeInteger(data.count)||data.count<0||!Array.isArray(data.data)||data.data.length>size||data.data.length>data.count)throw new Error('Worker list could not be verified. Retry before relying on these records.');
  return data;
}
export function workerAge(created,now=Date.now()){
  const timestamp=new Date(created).getTime();
  return Number.isFinite(timestamp)&&timestamp<=now?Math.floor((now-timestamp)/86400000):null;
}
export function workerTableHTML(rows,formatDate,now=Date.now()){
  const headers=['Applicant / Employee','Hiring Category','Assignment State','Reservation Age','Scheduled','Actual Deployment','Ended'];
  const body=rows.map(row=>{
    const age=['Reserved','Scheduled'].includes(row.state)?workerAge(row.created_at,now):null;
    return `<tr><td><b>${escape(row.name||'Name unavailable')}</b><div class="small">Applicant: ${escape(row.candidate_id)}${row.employee_id?` / Employee: ${escape(row.employee_id)}`:''}</div></td><td>${escape(row.hiring_category)}</td><td>${escape(row.state)}</td><td>${age==null?'Not applicable':age+' days'}</td>${['scheduled_date','actual_date','ended_date'].map(key=>`<td>${escape(row[key]?formatDate(row[key]):'Not recorded')}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="tablewrap" tabindex="0" role="region" aria-label="Line worker records"><table class="data-table" data-server-paginated="true" data-table-tools="external"><caption class="sr-only">Permitted workers for selected requisition line</caption><thead><tr>${headers.map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${body||'<tr><td colspan="7"><div class="empty">No matching permitted workers.</div></td></tr>'}</tbody></table></div>`;
}
export function workerFiltersHTML(search='',state='',searchIcon='',lineLabel=''){
  return `${lineLabel?`<p class="small">${escape(lineLabel)} / Workers</p>`:''}<div class="data-toolbar"><button type="button" class="btn btn-ghost btn-sm" onclick="manpowerSubmittedSetTab('lines')">Back to Requisition Lines</button><div class="searchbox">${searchIcon}<input type="search" maxlength="120" value="${escape(search)}" aria-label="Search line workers by name or record ID" placeholder="Search workers..." oninput="manpowerWorkerSearch(this)"></div><select aria-label="Filter assignment state" onchange="manpowerWorkerState(this.value)"><option value="">All Assignment States</option>${WORKER_STATES.map(value=>`<option ${state===value?'selected':''}>${value}</option>`).join('')}</select></div>`;
}
