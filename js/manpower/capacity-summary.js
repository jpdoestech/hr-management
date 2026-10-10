const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const CAPACITY_FIELDS={original_requested:'Original Requested',current_authorized:'Current Authorized',cancelled_unfilled:'Cancelled Unfilled',effective_capacity:'Effective Capacity',reserved:'Reserved',scheduled:'Scheduled',fulfilled:'Historically Fulfilled',active_deployed:'Active Deployed',available:'Available'};
export function capacityResultValid(data){
  if(!data||!Object.keys(CAPACITY_FIELDS).every(key=>Number.isSafeInteger(data[key])&&data[key]>=0))return false;
  return data.original_requested>0&&data.current_authorized>=data.cancelled_unfilled&&
    data.effective_capacity===data.current_authorized-data.cancelled_unfilled&&
    data.available===data.effective_capacity-data.reserved-data.fulfilled&&
    data.scheduled<=data.reserved&&data.active_deployed<=data.fulfilled;
}
export async function loadLineCapacity(client,id){
  const {data,error}=await client.rpc('manpower_line_capacity',{p_line:id});
  if(error)throw error;
  if(!capacityResultValid(data))throw new Error('Capacity could not be verified. Ask HR to reconcile this line before relying on its counts.');
  return data;
}
export function lineCapacityHTML(data){
  if(!capacityResultValid(data))throw new Error('Invalid capacity summary');
  const progress=data.effective_capacity===0?'No effective demand':data.fulfilled===data.effective_capacity?'Filled':data.fulfilled>0?'Partially Filled':'Open';
  return `<div class="manpower-line-capacity"><p><b>Fulfillment progress:</b> ${progress}</p><dl>${Object.entries(CAPACITY_FIELDS).map(([key,label])=>`<div><dt>${label}</dt><dd>${data[key].toLocaleString('en-US')}</dd></div>`).join('')}</dl><p class="small">Scheduled workers are included in Reserved, not Fulfilled. Genuine departures retain historical fulfillment; reversed credits are excluded.</p></div>`;
}
export function capacityErrorHTML(error){
  const message=['PGRST202','42883'].includes(error.code)?'Capacity accounting is not enabled in this database. Ask the System Administrator to complete the reviewed release setup.':error.code==='42501'?'Capacity unavailable or outside your access.':error.code==='23514'?'Capacity requires reconciliation. Review legacy assignments and commitments with HR.':'Capacity could not be verified. Retry or ask HR to reconcile this line.';
  return `<p role="alert">${escape(message)}</p>`;
}
